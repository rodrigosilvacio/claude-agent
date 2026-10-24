-- Escritório de agentes na nuvem: qualquer pessoa cria conta no painel
-- (Supabase Auth), pede um post e acompanha Tiago, Roberto e Eloah
-- trabalhando. Os agentes rodam na edge function `escritorio-esteira`, com a
-- ANTHROPIC_API_KEY que já está nas secrets do projeto.
--
-- Como a esteira anda: cada etapa é uma invocação separada da function (o teto
-- de ~150s por invocação não comporta a esteira inteira). O próprio banco
-- conduz: quando `etapa` ou `rodada` muda para uma etapa ativa, o trigger
-- dispara a function via pg_net. Um cron a cada 2 minutos reenvia etapas que
-- ficaram paradas (function derrubada no meio) e, depois de 3 tentativas,
-- marca erro.
--
-- Escrita só pela service role (edge functions). O usuário logado lê apenas as
-- próprias demandas e versões (RLS). Os eventos ao vivo continuam em
-- escritorio_eventos (0061), públicos e sem conteúdo do post.

-- ---------- configuração privada ----------

-- Segredo que autentica as chamadas internas banco -> function, e limites de
-- uso. RLS sem policies: só service role e o próprio banco leem.
create table public.escritorio_config (
  chave text primary key,
  valor text not null
);
alter table public.escritorio_config enable row level security;

insert into public.escritorio_config (chave, valor) values
  ('segredo_interno', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('url_esteira', 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/escritorio-esteira'),
  ('limite_usuario_dia', '3'),
  ('limite_global_dia', '40');

-- ---------- demandas e versões ----------

create table public.escritorio_demandas (
  id uuid primary key default gen_random_uuid(),
  -- Nulo só em demandas de teste criadas direto no banco.
  user_id uuid references auth.users (id) on delete cascade,
  tema text not null check (char_length(tema) between 3 and 200),
  descricao text not null check (char_length(descricao) between 10 and 4000),
  objetivo text check (char_length(objetivo) <= 300),
  publico text check (char_length(publico) <= 300),
  cta text check (char_length(cta) <= 300),
  observacoes text check (char_length(observacoes) <= 1500),
  etapa text not null default 'escrita'
    check (etapa in ('escrita', 'revisao', 'arte', 'concluido', 'escalado')),
  rodada integer not null default 1 check (rodada between 1 and 3),
  post_final text,
  frase_arte text,
  arte_html text,
  pendencias text,
  erro text,
  -- Trava da etapa em execução (evita duas invocações na mesma etapa).
  passo_em timestamptz,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index escritorio_demandas_user_idx on public.escritorio_demandas (user_id, criado_em desc);
create index escritorio_demandas_ativas_idx on public.escritorio_demandas (etapa, atualizado_em)
  where etapa in ('escrita', 'revisao', 'arte');

create table public.escritorio_versoes (
  id bigint generated always as identity primary key,
  demanda_id uuid not null references public.escritorio_demandas (id) on delete cascade,
  n integer not null check (n between 1 and 3),
  titulo text not null,
  texto text not null,
  hashtags text not null,
  frase_arte text not null,
  notas_autor text,
  checagem jsonb not null default '{}'::jsonb,
  revisao jsonb,
  media numeric(4, 2),
  aprovado boolean,
  criado_em timestamptz not null default now(),
  unique (demanda_id, n)
);

alter table public.escritorio_demandas enable row level security;
alter table public.escritorio_versoes enable row level security;

create policy "escritorio_demandas dono le"
  on public.escritorio_demandas for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "escritorio_versoes dono le"
  on public.escritorio_versoes for select
  to authenticated
  using (exists (
    select 1 from public.escritorio_demandas d
    where d.id = demanda_id and d.user_id = (select auth.uid())
  ));

revoke insert, update, delete, truncate on public.escritorio_demandas from anon, authenticated;
revoke insert, update, delete, truncate on public.escritorio_versoes from anon, authenticated;
revoke all on public.escritorio_demandas from anon;
revoke all on public.escritorio_versoes from anon;

-- ---------- condução da esteira ----------

create or replace function public.escritorio_disparar_etapa(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_segredo text;
begin
  select valor into v_url from public.escritorio_config where chave = 'url_esteira';
  select valor into v_segredo from public.escritorio_config where chave = 'segredo_interno';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-escritorio-interno', v_segredo),
    body := jsonb_build_object('id', p_id),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function public.escritorio_disparar_etapa(uuid) from public, anon, authenticated;

create or replace function public.escritorio_ao_mudar_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger escritorio_demandas_atualizado_em
  before update on public.escritorio_demandas
  for each row execute function public.escritorio_ao_mudar_etapa();

create or replace function public.escritorio_seguir_esteira()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.etapa in ('escrita', 'revisao', 'arte') and new.erro is null then
    perform public.escritorio_disparar_etapa(new.id);
  end if;
  return null;
end;
$$;

create trigger escritorio_demandas_nova
  after insert on public.escritorio_demandas
  for each row execute function public.escritorio_seguir_esteira();

create trigger escritorio_demandas_proxima_etapa
  after update of etapa, rodada on public.escritorio_demandas
  for each row
  when (old.etapa is distinct from new.etapa or old.rodada is distinct from new.rodada)
  execute function public.escritorio_seguir_esteira();

revoke all on function public.escritorio_ao_mudar_etapa() from public, anon, authenticated;
revoke all on function public.escritorio_seguir_esteira() from public, anon, authenticated;

-- Rede de segurança: etapa parada há mais de 4 min (function derrubada no
-- meio, pg_net perdido) é reenviada; na 3ª tentativa vira erro visível no
-- painel, com botão de retomar.
create or replace function public.escritorio_reenviar_paradas()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  for d in
    select id, tentativas from public.escritorio_demandas
    where etapa in ('escrita', 'revisao', 'arte')
      and erro is null
      and coalesce(passo_em, atualizado_em) < now() - interval '4 minutes'
  loop
    if d.tentativas >= 3 then
      update public.escritorio_demandas
        set erro = 'A esteira parou 3 vezes nesta etapa. Tente retomar mais tarde.', passo_em = null
        where id = d.id;
      insert into public.escritorio_eventos (demanda, tipo, texto)
        values (d.id::text, 'fim', 'a esteira parou com erro');
    else
      update public.escritorio_demandas
        set tentativas = tentativas + 1, passo_em = null
        where id = d.id;
      perform public.escritorio_disparar_etapa(d.id);
    end if;
  end loop;
end;
$$;

revoke all on function public.escritorio_reenviar_paradas() from public, anon, authenticated;

select cron.schedule('escritorio-reenviar-paradas', '*/2 * * * *', $cron$ select public.escritorio_reenviar_paradas(); $cron$);
