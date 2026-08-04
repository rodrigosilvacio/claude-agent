-- Agenda o envio diário do e-mail "Notícias de IA" (5 notícias de IA +
-- post pronto pro LinkedIn) para rodrigosilvapmp@hotmail.com, todo dia às
-- 05:00 (America/Sao_Paulo = 08:00 UTC — sem horário de verão no Brasil
-- desde 2019, então o horário UTC fixo abaixo é sempre 05:00 em Brasília).
--
-- pg_cron dispara o job; pg_net faz a chamada HTTP assíncrona pra Edge
-- Function noticias-ia-email-diario (que por sua vez chama ninanews-buscar
-- e envia o e-mail via Resend). Autenticação via publishable key do
-- projeto (a mesma já exposta publicamente no front-end de /ninanews) —
-- não expõe nenhuma secret sensível nesta migration.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: remove um agendamento anterior com o mesmo nome antes de
-- recriar, para a migration poder ser reaplicada sem erro de duplicidade.
do $$
begin
  perform cron.unschedule('noticias-ia-email-diario');
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
    timeout_milliseconds := 120000
  );
  $cron$
);
