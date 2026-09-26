-- Nome do usuário passou a ser o principal identificador na tela do
-- médico (antes aparecia só o e-mail quando o nome estava vazio, e o
-- médico não conseguia achar o paciente). pandafit_usuarios continua sem
-- política de update para o cliente — escrita só pela edge function
-- pandafit-admin-users (admin edita qualquer nome) ou por esta função, que
-- deixa cada pessoa editar só o PRÓPRIO nome (nunca e-mail ou papel).
create or replace function public.pandafit_atualizar_meu_nome(p_nome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  limpo text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if auth.uid() is null or public.pandafit_current_role() is null then
    raise exception 'Sem acesso ao PandaFit';
  end if;
  if limpo is not null and char_length(limpo) > 120 then
    raise exception 'Nome muito longo (máx. 120 caracteres)';
  end if;
  update public.pandafit_usuarios set nome = limpo where id = auth.uid();
  return limpo;
end;
$$;

revoke execute on function public.pandafit_atualizar_meu_nome(text) from public, anon;
grant execute on function public.pandafit_atualizar_meu_nome(text) to authenticated;
