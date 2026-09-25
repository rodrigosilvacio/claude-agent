-- O linter de segurança do Supabase aponta que pandafit_current_role()
-- (security definer) pode ser chamada via RPC por anon/authenticated. Não é
-- um vazamento (ela só devolve o papel do PRÓPRIO chamador, via auth.uid(),
-- que é null para anon), mas não há motivo pra deixar anon chamá-la — nega
-- por padrão.
revoke execute on function public.pandafit_current_role() from public;
revoke execute on function public.pandafit_current_role() from anon;
grant execute on function public.pandafit_current_role() to authenticated;
