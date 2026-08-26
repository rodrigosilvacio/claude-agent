-- Meta mensal de treinos (1 a 30), editável na aba "Meta" do app. Singleton
-- row: uma linha fixa (id=1) que o front-end só lê e atualiza, nunca insere
-- ou apaga.
create table public.pandafit_settings (
  id integer primary key,
  monthly_goal integer not null default 12 check (monthly_goal between 1 and 30),
  updated_at timestamptz not null default now()
);

insert into public.pandafit_settings (id, monthly_goal) values (1, 12);

alter table public.pandafit_settings enable row level security;

create policy "pandafit_settings_anon_select"
  on public.pandafit_settings
  for select
  to anon
  using (true);

create policy "pandafit_settings_anon_update"
  on public.pandafit_settings
  for update
  to anon
  using (true)
  with check (monthly_goal between 1 and 30);
