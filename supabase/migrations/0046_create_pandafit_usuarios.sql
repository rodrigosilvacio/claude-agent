-- pandafit_usuarios: escopo de quem pertence ao PandaFit neste projeto
-- Supabase compartilhado entre vários apps (mesmo padrão já usado por
-- sucesu_usuarios) — auth.users tem contas de outros apps também, então
-- nunca decidimos quem tem acesso ao PandaFit olhando auth.users direto.
create table public.pandafit_usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nome text,
  role text not null check (role in ('admin', 'usuario', 'medico')),
  criado_em timestamptz not null default now()
);

comment on table public.pandafit_usuarios is
  'Escopo de contas com acesso ao PandaFit (id = auth.users.id). Só é escrita pela edge function pandafit-admin-users (service role) — nunca diretamente pelo cliente.';

-- security definer: lê o papel do usuário logado sem disparar recursão de
-- RLS na própria pandafit_usuarios (que tem RLS habilitado logo abaixo).
create or replace function public.pandafit_current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.pandafit_usuarios where id = auth.uid();
$$;

alter table public.pandafit_usuarios enable row level security;

-- Qualquer pessoa com acesso ao PandaFit enxerga a própria linha (usada
-- pelo app pra descobrir o próprio papel após o login); admin e médico
-- também enxergam todo mundo (admin pra gerenciar contas, médico pra
-- listar pacientes).
create policy "pandafit_usuarios_select"
  on public.pandafit_usuarios for select
  to authenticated
  using (
    id = auth.uid()
    or public.pandafit_current_role() in ('admin', 'medico')
  );

-- Sem políticas de insert/update/delete: essas operações só acontecem via
-- edge function com a service role key, que ignora RLS. Deixar sem
-- política aqui é intencional (nega por padrão).
