-- Reforça a resiliência do e-mail diário "Notícias de IA" com um retry
-- entre execuções (não dentro da mesma execução) e um registro do que já
-- foi enviado.
--
-- Por que não um retry dentro da própria function: os resumos por notícia
-- agora chegam a ~700 palavras, e uma execução normal de ninanews-buscar já
-- leva ~100-120s. Tentar de novo *dentro* da mesma invocação de
-- noticias-ia-email-diario (2 tentativas sequenciais) facilmente estoura o
-- teto de ~150s de execução de uma Edge Function no Supabase — a function
-- seria derrubada por WORKER_RESOURCE_LIMIT antes de conseguir a segunda
-- tentativa. Por isso o retry acontece como uma SEGUNDA invocação
-- independente (com seu próprio teto de 150s), disparada por um segundo
-- cron ~35min depois do horário normal.
--
-- A tabela abaixo registra o envio do dia (data em America/Sao_Paulo) para
-- a function conseguir pular o trabalho se já tiver enviado com sucesso
-- hoje — assim o cron de segurança não manda e-mail duplicado quando o
-- primeiro disparo já deu certo.
create table if not exists public.noticias_ia_email_envios (
  data_brasilia date primary key,
  enviado_em timestamptz not null default now()
);

-- RLS sem policies: bloqueia anon/authenticated via PostgREST; a Edge
-- Function usa a service role key, que ignora RLS por padrão no Supabase.
alter table public.noticias_ia_email_envios enable row level security;

do $$
begin
  perform cron.unschedule('noticias-ia-email-diario');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('noticias-ia-email-diario-retry');
exception when others then
  null;
end $$;

select cron.schedule(
  'noticias-ia-email-diario',
  '0 8 * * *',
  $cron$
  select net.http_post(
    url := 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/noticias-ia-email-diario',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_JmhdMN8S7lSpCeaJANw_lQ_RRwZ2_OT'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $cron$
);

-- 05:35 America/Sao_Paulo (08:35 UTC) — 35min depois do disparo principal.
-- A própria function verifica se o e-mail de hoje já foi enviado antes de
-- refazer todo o trabalho, então isso só reenvia se o disparo das 05:00
-- realmente falhou.
select cron.schedule(
  'noticias-ia-email-diario-retry',
  '35 8 * * *',
  $cron$
  select net.http_post(
    url := 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/noticias-ia-email-diario',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_JmhdMN8S7lSpCeaJANw_lQ_RRwZ2_OT'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $cron$
);
