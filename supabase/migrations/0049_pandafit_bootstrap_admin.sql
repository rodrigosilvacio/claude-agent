-- Bootstrap do primeiro admin do PandaFit. rodrigosilvapmp@hotmail.com já
-- tem conta neste projeto Supabase compartilhado (criada por outro app) —
-- só concedemos acesso ao PandaFit como admin, sem mexer na senha
-- existente (a mesma conta loga em qualquer app deste projeto).
insert into public.pandafit_usuarios (id, email, nome, role)
select id, email, null, 'admin'
from auth.users
where lower(email) = lower('rodrigosilvapmp@hotmail.com')
on conflict (id) do update set role = 'admin';

-- Todo o histórico registrado antes de existir autenticação (quando a app
-- era anônima) passa a pertencer a essa mesma conta.
update public.pandafit_workouts
  set user_id = (select id from auth.users where lower(email) = lower('rodrigosilvapmp@hotmail.com'))
  where user_id is null;
update public.pandafit_weights
  set user_id = (select id from auth.users where lower(email) = lower('rodrigosilvapmp@hotmail.com'))
  where user_id is null;
update public.pandafit_documents
  set user_id = (select id from auth.users where lower(email) = lower('rodrigosilvapmp@hotmail.com'))
  where user_id is null;
update public.pandafit_settings
  set user_id = (select id from auth.users where lower(email) = lower('rodrigosilvapmp@hotmail.com'))
  where user_id is null;

-- Com todo mundo já com dono, user_id passa a ser obrigatório daqui pra frente.
alter table public.pandafit_workouts alter column user_id set not null;
alter table public.pandafit_weights alter column user_id set not null;
alter table public.pandafit_documents alter column user_id set not null;
alter table public.pandafit_settings alter column user_id set not null;
