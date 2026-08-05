-- Ajusta o agendamento do e-mail diário "Notícias de IA" depois de dois
-- problemas identificados em 2026-08-04:
--
-- 1) Resumos por notícia agora podem chegar a ~700 palavras (antes eram só
--    2-4 frases), então a geração fica mais lenta e o timeout do
--    net.http_post (120s) ficou curto demais para o pior caso, que já
--    inclui a nova tentativa extra adicionada em noticias-ia-email-diario.
-- 2) O disparo automático das 05:00 daquele dia falhou com 502 (falha
--    transitória da geração) e não havia retry nenhum no nível do
--    agendamento — a function noticias-ia-email-diario passou a tentar
--    gerar a edição 2x antes de desistir, e este timeout precisa acomodar
--    esse novo pior caso (2 tentativas de até ~150s cada + envio do e-mail).
--
-- Mesmo agendamento (05:00 America/Sao_Paulo = 08:00 UTC), só o timeout do
-- net.http_post muda.
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
    timeout_milliseconds := 350000
  );
  $cron$
);
