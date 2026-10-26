-- Agente do Drive: o usuário pergunta e o agente responde com base nos
-- arquivos (PDF, PowerPoint, Word, Excel) de uma pasta pública do Google
-- Drive, citando a fonte; quando a resposta não está nos arquivos, responde
-- com a IA e deixa isso explícito no rodapé.
--
-- Fluxo da base: o admin clica "Atualizar base" no painel, a edge function
-- `drive-sincronizar` lista a pasta e enfileira os arquivos na sincronização;
-- `drive-processar` (chamada pela anterior e por ela mesma, em cadeia) baixa,
-- extrai o texto, divide em trechos, gera os embeddings (OpenAI) e grava em
-- drive_trechos. A busca é híbrida (texto em português + vetor, RRF) na
-- função drive_buscar, usada pela edge function `drive-perguntar`.
--
-- Acesso: o projeto tem cadastro aberto por causa de outros apps, então estar
-- logado não basta. Só e-mails presentes em drive_acessos usam o agente; quem
-- tem admin = true também atualiza a base.

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Português sem acento: "contratacao" encontra "contratação".
create text search configuration public.drive_pt (copy = pg_catalog.portuguese);
alter text search configuration public.drive_pt
  alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;

-- ---------- configuração privada ----------

create table public.drive_config (
  chave text primary key,
  valor text not null
);
alter table public.drive_config enable row level security;

insert into public.drive_config (chave, valor) values
  ('pasta_id', '1rQTxdoWlV9_zyVfdfEDu2VhsKhNepmvJ'),
  ('segredo_interno', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('url_processar', 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/drive-processar');

-- ---------- quem pode usar ----------

create table public.drive_acessos (
  email text primary key check (email = lower(email)),
  admin boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table public.drive_acessos enable row level security;

insert into public.drive_acessos (email, admin) values ('rodrigosilvapmp@hotmail.com', true);

create or replace function public.drive_meu_acesso()
returns table (permitido boolean, admin boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.email is not null, coalesce(a.admin, false)
  from (select 1) _
  left join public.drive_acessos a on a.email = lower(auth.jwt() ->> 'email');
$$;

create or replace function public.drive_tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.drive_acessos where email = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.drive_e_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.drive_acessos where email = lower(auth.jwt() ->> 'email') and admin);
$$;

revoke all on function public.drive_meu_acesso() from public, anon;
revoke all on function public.drive_tem_acesso() from public, anon;
revoke all on function public.drive_e_admin() from public, anon;
grant execute on function public.drive_meu_acesso() to authenticated;
grant execute on function public.drive_tem_acesso() to authenticated;
grant execute on function public.drive_e_admin() to authenticated;

-- ---------- sincronizações ----------

create table public.drive_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  iniciada_por text,
  status text not null default 'listando'
    check (status in ('listando', 'processando', 'concluida', 'erro')),
  total integer not null default 0,
  processados integer not null default 0,
  novos integer not null default 0,
  alterados integer not null default 0,
  sem_alteracao integer not null default 0,
  removidos integer not null default 0,
  ignorados integer not null default 0,
  erros integer not null default 0,
  mensagem text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluida_em timestamptz
);

create index drive_sincronizacoes_recentes_idx on public.drive_sincronizacoes (criado_em desc);

-- ---------- documentos e trechos ----------

create table public.drive_documentos (
  id uuid primary key default gen_random_uuid(),
  drive_id text not null unique,
  nome text not null,
  -- arquivo (PDF/Office enviado) ou doc/slides/planilha (nativos do Google).
  tipo_drive text not null check (tipo_drive in ('arquivo', 'doc', 'slides', 'planilha')),
  -- pdf, docx, pptx, xlsx; descoberto pelo conteúdo ao processar.
  formato text,
  link text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'ok', 'erro', 'ignorado')),
  erro text,
  hash text,
  total_trechos integer not null default 0,
  -- Fila: sincronização em que o arquivo aguarda processamento (nulo = fora da fila).
  fila_sinc uuid references public.drive_sincronizacoes (id) on delete set null,
  ultima_sinc uuid references public.drive_sincronizacoes (id) on delete set null,
  resultado_sinc text check (resultado_sinc in ('novo', 'alterado', 'sem_alteracao', 'ignorado', 'erro')),
  passo_em timestamptz,
  tentativas integer not null default 0,
  processado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index drive_documentos_fila_idx on public.drive_documentos (fila_sinc, nome) where fila_sinc is not null;

create table public.drive_trechos (
  id bigint generated always as identity primary key,
  documento_id uuid not null references public.drive_documentos (id) on delete cascade,
  ordem integer not null,
  -- "página 4", "slide 7", "aba Vendas, linhas 2 a 40"...
  local text not null,
  -- Nome do arquivo + local: entra na busca textual e no embedding.
  titulo text not null,
  conteudo text not null,
  fts tsvector generated always as (to_tsvector('public.drive_pt'::regconfig, titulo || ' ' || conteudo)) stored,
  embedding extensions.vector(1536),
  modelo_embedding text,
  criado_em timestamptz not null default now()
);

create index drive_trechos_documento_idx on public.drive_trechos (documento_id, ordem);
create index drive_trechos_fts_idx on public.drive_trechos using gin (fts);
create index drive_trechos_embedding_idx on public.drive_trechos
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------- registro das perguntas ----------

create table public.drive_perguntas (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  email text,
  pergunta text not null,
  resposta text,
  tipo_fonte text check (tipo_fonte in ('drive', 'ia', 'misto')),
  -- Trechos citados e validados: [{id, nome, local}].
  fontes jsonb not null default '[]'::jsonb,
  -- Consultas que o agente fez: [{consulta, encontrados}].
  buscas jsonb not null default '[]'::jsonb,
  -- O código rebaixou a fonte declarada pelo modelo (citação sem trecho real).
  fonte_corrigida boolean not null default false,
  erro text,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);

create index drive_perguntas_recentes_idx on public.drive_perguntas (criado_em desc);

-- ---------- RLS ----------
-- Escrita só pela service role (edge functions). Leitura: quem tem acesso vê
-- os documentos; admin vê sincronizações e o registro de perguntas.

alter table public.drive_sincronizacoes enable row level security;
alter table public.drive_documentos enable row level security;
alter table public.drive_trechos enable row level security;
alter table public.drive_perguntas enable row level security;

create policy "drive_documentos quem tem acesso le"
  on public.drive_documentos for select
  to authenticated
  using ((select public.drive_tem_acesso()));

create policy "drive_sincronizacoes admin le"
  on public.drive_sincronizacoes for select
  to authenticated
  using ((select public.drive_e_admin()));

create policy "drive_perguntas admin le"
  on public.drive_perguntas for select
  to authenticated
  using ((select public.drive_e_admin()));

revoke all on public.drive_config, public.drive_acessos, public.drive_trechos from anon, authenticated;
revoke all on public.drive_sincronizacoes, public.drive_documentos, public.drive_perguntas from anon;
revoke insert, update, delete, truncate
  on public.drive_sincronizacoes, public.drive_documentos, public.drive_perguntas from authenticated;

-- Painel do admin acompanha o progresso ao vivo.
alter publication supabase_realtime add table public.drive_sincronizacoes, public.drive_documentos;

-- ---------- fila de processamento ----------

-- Pega o próximo arquivo da fila (ou um que travou há mais de 4 min) e marca
-- como em processamento. skip locked: duas invocações nunca pegam o mesmo.
create or replace function public.drive_proximo_documento(p_sinc uuid)
returns setof public.drive_documentos
language sql
security definer
set search_path = ''
as $$
  update public.drive_documentos d
     set passo_em = now(), tentativas = d.tentativas + 1
   where d.id = (
     select id from public.drive_documentos
      where fila_sinc = p_sinc
        and (passo_em is null or passo_em < now() - interval '4 minutes')
      order by nome
      limit 1
      for update skip locked
   )
  returning d.*;
$$;

-- Recalcula os contadores da sincronização a partir dos documentos e, quando
-- a fila esvazia, marca como concluída. Cada update notifica o painel.
create or replace function public.drive_registrar_progresso(p_sinc uuid)
returns public.drive_sincronizacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restantes integer;
  v public.drive_sincronizacoes;
begin
  select count(*) into v_restantes from public.drive_documentos where fila_sinc = p_sinc;
  update public.drive_sincronizacoes s set
    processados = s.total - v_restantes,
    novos = c.novos,
    alterados = c.alterados,
    sem_alteracao = c.sem_alteracao,
    erros = c.erros,
    status = case when v_restantes = 0 and s.status = 'processando' then 'concluida' else s.status end,
    concluida_em = case when v_restantes = 0 and s.status = 'processando' then now() else s.concluida_em end,
    atualizado_em = now()
  from (
    select count(*) filter (where resultado_sinc = 'novo') as novos,
           count(*) filter (where resultado_sinc = 'alterado') as alterados,
           count(*) filter (where resultado_sinc = 'sem_alteracao') as sem_alteracao,
           count(*) filter (where resultado_sinc = 'erro') as erros
      from public.drive_documentos
     where ultima_sinc = p_sinc and fila_sinc is null
  ) c
  where s.id = p_sinc
  returning s.* into v;
  return v;
end;
$$;

-- ---------- busca híbrida ----------

-- Une a busca textual (qualquer termo da consulta, com stemming e sem acento)
-- e a busca vetorial (similaridade de cosseno) por Reciprocal Rank Fusion:
-- trecho bem colocado nas duas sobe para o topo. Só documentos com status ok.
create or replace function public.drive_buscar(
  p_consulta text,
  p_embedding extensions.vector(1536),
  p_limite integer default 12
)
returns table (
  trecho_id bigint,
  documento_id uuid,
  nome text,
  link text,
  local text,
  conteudo text,
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
  texto as (
    select t.id, row_number() over (order by ts_rank_cd(t.fts, c.q) desc) as pos
      from public.drive_trechos t, consulta c
     where c.q is not null and t.fts @@ c.q
     order by ts_rank_cd(t.fts, c.q) desc
     limit 40
  ),
  vetor as (
    select t.id, row_number() over (order by t.embedding operator(extensions.<=>) p_embedding) as pos
      from public.drive_trechos t
     where p_embedding is not null and t.embedding is not null
     order by t.embedding operator(extensions.<=>) p_embedding
     limit 40
  ),
  fusao as (
    select coalesce(a.id, b.id) as id,
           coalesce(1.0 / (60 + a.pos), 0) + coalesce(1.0 / (60 + b.pos), 0) as pontuacao
      from texto a
      full outer join vetor b on a.id = b.id
  )
  select t.id, d.id, d.nome, d.link, t.local, t.conteudo, f.pontuacao::double precision
    from fusao f
    join public.drive_trechos t on t.id = f.id
    join public.drive_documentos d on d.id = t.documento_id
   where d.status = 'ok'
   order by f.pontuacao desc
   limit greatest(1, least(p_limite, 30));
$$;

revoke all on function public.drive_proximo_documento(uuid) from public, anon, authenticated;
revoke all on function public.drive_registrar_progresso(uuid) from public, anon, authenticated;
revoke all on function public.drive_buscar(text, extensions.vector, integer) from public, anon, authenticated;
