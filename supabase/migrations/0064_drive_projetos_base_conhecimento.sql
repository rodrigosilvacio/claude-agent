-- Agente do Drive: projetos, conversas e base de conhecimento.
--
-- Projetos (como os do Claude): cada usuário cria os seus, com instruções
-- próprias, e guarda as conversas dentro deles. Conversas sem projeto também
-- ficam salvas. Tudo é privado do dono (RLS).
--
-- Base de conhecimento: toda pergunta respondida (fonte Drive, IA ou misto)
-- vira consulta para as próximas. Antes de cada resposta, drive-perguntar
-- busca em drive_buscar_base as perguntas mais parecidas, de qualquer usuário,
-- e o agente as usa como ponto de partida, conferindo nos documentos. A base é
-- compartilhada, mas a função não devolve quem perguntou. Excluir a conversa
-- tira as perguntas dela da base.

-- ---------- projetos ----------

create table public.drive_projetos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  instrucoes text not null default '' check (char_length(instrucoes) <= 4000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index drive_projetos_dono_idx on public.drive_projetos (user_id, nome);

-- ---------- conversas ----------

-- Criadas por drive-perguntar na primeira pergunta (service role).
create table public.drive_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  projeto_id uuid references public.drive_projetos (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 120),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index drive_conversas_dono_idx on public.drive_conversas (user_id, atualizado_em desc);
create index drive_conversas_projeto_idx on public.drive_conversas (projeto_id, atualizado_em desc);

-- ---------- perguntas: conversa e base de conhecimento ----------

alter table public.drive_perguntas
  add column conversa_id uuid references public.drive_conversas (id) on delete cascade,
  -- Fontes no formato da tela ({nome, link, locais}), para reabrir a conversa.
  add column fontes_tela jsonb not null default '[]'::jsonb,
  -- Respostas anteriores da base que o agente aproveitou: [{id, pergunta, data}].
  add column base_usada jsonb not null default '[]'::jsonb,
  -- Vetor da pergunta (OpenAI), para achar perguntas parecidas.
  add column embedding extensions.vector(1536),
  add column fts tsvector generated always as (
    setweight(to_tsvector('public.drive_pt'::regconfig, pergunta), 'A')
    || setweight(to_tsvector('public.drive_pt'::regconfig, coalesce(resposta, '')), 'B')
  ) stored;

create index drive_perguntas_conversa_idx on public.drive_perguntas (conversa_id, criado_em);
create index drive_perguntas_fts_idx on public.drive_perguntas using gin (fts);
create index drive_perguntas_embedding_idx on public.drive_perguntas
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------- RLS ----------

alter table public.drive_projetos enable row level security;
alter table public.drive_conversas enable row level security;

create policy "drive_projetos dono le"
  on public.drive_projetos for select to authenticated
  using (user_id = (select auth.uid()) and (select public.drive_tem_acesso()));
create policy "drive_projetos dono cria"
  on public.drive_projetos for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.drive_tem_acesso()));
create policy "drive_projetos dono altera"
  on public.drive_projetos for update to authenticated
  using (user_id = (select auth.uid()) and (select public.drive_tem_acesso()))
  with check (user_id = (select auth.uid()));
create policy "drive_projetos dono exclui"
  on public.drive_projetos for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.drive_tem_acesso()));

create policy "drive_conversas dono le"
  on public.drive_conversas for select to authenticated
  using (user_id = (select auth.uid()) and (select public.drive_tem_acesso()));
create policy "drive_conversas dono exclui"
  on public.drive_conversas for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.drive_tem_acesso()));

-- O dono relê as próprias perguntas (histórico das conversas).
create policy "drive_perguntas dono le"
  on public.drive_perguntas for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.drive_projetos, public.drive_conversas from anon;
revoke truncate on public.drive_projetos from authenticated;
revoke insert, update, truncate on public.drive_conversas from authenticated;

create or replace function public.drive_projetos_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger drive_projetos_atualizado_em
  before update on public.drive_projetos
  for each row execute function public.drive_projetos_atualizado_em();

-- ---------- busca na base de conhecimento ----------

-- Perguntas já respondidas mais parecidas com a nova (texto + vetor, RRF),
-- sem identificar quem perguntou. `similaridade` é o cosseno entre as
-- perguntas (nulo quando só bateu por texto); drive-perguntar usa como corte.
create or replace function public.drive_buscar_base(
  p_consulta text,
  p_embedding extensions.vector(1536),
  p_excluir_conversa uuid default null,
  p_limite integer default 3
)
returns table (
  id bigint,
  pergunta text,
  resposta text,
  tipo_fonte text,
  fontes jsonb,
  criado_em timestamptz,
  similaridade double precision,
  pontuacao double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with consulta as (
    select (
      select string_agg(quote_literal(l), ' | ')
        from unnest(tsvector_to_array(to_tsvector('public.drive_pt'::regconfig, p_consulta))) l
    )::tsquery as q
  ),
  respondidas as (
    select p.* from public.drive_perguntas p
     where p.resposta is not null and p.erro is null
       and (p_excluir_conversa is null or p.conversa_id is distinct from p_excluir_conversa)
  ),
  texto as (
    select r.id, row_number() over (order by ts_rank_cd(r.fts, c.q) desc) as pos
      from respondidas r, consulta c
     where c.q is not null and r.fts @@ c.q
     order by ts_rank_cd(r.fts, c.q) desc
     limit 20
  ),
  vetor as (
    select r.id,
           row_number() over (order by r.embedding operator(extensions.<=>) p_embedding) as pos,
           1 - (r.embedding operator(extensions.<=>) p_embedding) as similaridade
      from respondidas r
     where p_embedding is not null and r.embedding is not null
     order by r.embedding operator(extensions.<=>) p_embedding
     limit 20
  ),
  fusao as (
    select coalesce(a.id, b.id) as id,
           b.similaridade,
           coalesce(1.0 / (60 + a.pos), 0) + coalesce(1.0 / (60 + b.pos), 0) as pontuacao
      from texto a
      full outer join vetor b on a.id = b.id
  )
  select p.id, p.pergunta, p.resposta, p.tipo_fonte, p.fontes, p.criado_em,
         f.similaridade::double precision, f.pontuacao::double precision
    from fusao f
    join public.drive_perguntas p on p.id = f.id
   order by f.pontuacao desc
   limit greatest(1, least(p_limite, 10));
$$;

revoke all on function public.drive_buscar_base(text, extensions.vector, uuid, integer) from public, anon, authenticated;
