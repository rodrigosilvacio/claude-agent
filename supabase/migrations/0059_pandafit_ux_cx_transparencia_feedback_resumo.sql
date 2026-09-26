-- Onda de melhorias de UX/CX do PandaFit (ver pandafit/MELHORIAS-UX-CX.md):
--
-- 1. "Quem vê meus dados" (LGPD): o paciente passa a enxergar quais médicos
--    estão vinculados a ele e pode revogar esse acesso sozinho, sem depender
--    do admin. pandafit_medico_pacientes continua sem política nenhuma pro
--    cliente; o acesso é só por estas duas funções security definer, que
--    sempre filtram por usuario_id = auth.uid().
-- 2. Canal de feedback dentro do app (pandafit_feedback): qualquer conta do
--    PandaFit grava a própria sugestão; só admin lê.
-- 3. Resumo semanal por e-mail: opt-in em pandafit_settings e um registro
--    de envios por (usuário, semana) pra function pandafit-resumo-semanal ser
--    idempotente (um disparo repetido do cron não manda e-mail duplicado).

-- ── 1. transparência: médicos vinculados ao próprio usuário ──
create or replace function public.pandafit_meus_medicos()
returns table (medico_id uuid, nome text, email text, vinculado_em timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.nome, u.email, v.created_at
  from public.pandafit_medico_pacientes v
  join public.pandafit_usuarios u on u.id = v.medico_id
  where v.usuario_id = auth.uid()
    and public.pandafit_current_role() is not null
  order by v.created_at;
$$;

revoke execute on function public.pandafit_meus_medicos() from public, anon;
grant execute on function public.pandafit_meus_medicos() to authenticated;

create or replace function public.pandafit_revogar_medico(p_medico_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removidos integer;
begin
  if auth.uid() is null or public.pandafit_current_role() is null then
    raise exception 'Sem acesso ao PandaFit';
  end if;
  delete from public.pandafit_medico_pacientes
  where usuario_id = auth.uid() and medico_id = p_medico_id;
  get diagnostics removidos = row_count;
  return removidos > 0;
end;
$$;

revoke execute on function public.pandafit_revogar_medico(uuid) from public, anon;
grant execute on function public.pandafit_revogar_medico(uuid) to authenticated;

-- ── 2. feedback ──
create table if not exists public.pandafit_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id),
  message text not null check (char_length(message) between 3 and 2000),
  created_at timestamptz not null default now()
);

alter table public.pandafit_feedback enable row level security;

drop policy if exists "pandafit_feedback_insert" on public.pandafit_feedback;
create policy "pandafit_feedback_insert" on public.pandafit_feedback for insert
  to authenticated
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

drop policy if exists "pandafit_feedback_select" on public.pandafit_feedback;
create policy "pandafit_feedback_select" on public.pandafit_feedback for select
  to authenticated
  using (public.pandafit_current_role() = 'admin' or user_id = auth.uid());

-- ── 3. resumo semanal por e-mail ──
alter table public.pandafit_settings
  add column if not exists weekly_summary_email boolean not null default false;

-- Escrita e leitura só pela edge function (service role): sem políticas.
create table if not exists public.pandafit_resumo_semanal_envios (
  user_id uuid not null references auth.users(id) on delete cascade,
  semana date not null,
  enviado_em timestamptz not null default now(),
  primary key (user_id, semana)
);

alter table public.pandafit_resumo_semanal_envios enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('pandafit-resumo-semanal');
exception when others then
  null;
end $$;

-- Toda segunda às 08:00 em Brasília (11:00 UTC). Autentica só com a
-- publishable key (já pública no front-end); a function é idempotente por
-- (usuário, semana), então um disparo externo não gera e-mail duplicado.
select cron.schedule(
  'pandafit-resumo-semanal',
  '0 11 * * 1',
  $cron$
  select net.http_post(
    url := 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/pandafit-resumo-semanal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_JmhdMN8S7lSpCeaJANw_lQ_RRwZ2_OT'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
