-- Cada linha passa a pertencer a um usuário. Nullable por enquanto — o
-- backfill dos dados legados (hoje sem dono) e o NOT NULL final acontecem
-- na migration seguinte, depois que o primeiro admin existir.
alter table public.pandafit_workouts add column user_id uuid references auth.users (id);
alter table public.pandafit_weights add column user_id uuid references auth.users (id);
alter table public.pandafit_documents add column user_id uuid references auth.users (id);

create index pandafit_workouts_user_id_idx on public.pandafit_workouts (user_id);
create index pandafit_weights_user_id_idx on public.pandafit_weights (user_id);
create index pandafit_documents_user_id_idx on public.pandafit_documents (user_id);

-- pandafit_weights era único por date globalmente (upsert onConflict:'date');
-- agora precisa ser único por (user_id, date), já que duas pessoas podem
-- registrar peso no mesmo dia.
alter table public.pandafit_weights drop constraint if exists pandafit_weights_date_key;
alter table public.pandafit_weights add constraint pandafit_weights_user_date_key unique (user_id, date);

-- pandafit_settings deixa de ser uma única linha global (id=1) e passa a
-- ter uma linha por usuário.
alter table public.pandafit_settings add column user_id uuid references auth.users (id);
alter table public.pandafit_settings add constraint pandafit_settings_user_id_key unique (user_id);
