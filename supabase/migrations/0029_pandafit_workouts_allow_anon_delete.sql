-- Painel ganhou um botão de excluir por registro; a tabela só tinha
-- select/insert para o role anon até aqui (ver 0028).
create policy "pandafit_workouts_anon_delete"
  on public.pandafit_workouts
  for delete
  to anon
  using (true);
