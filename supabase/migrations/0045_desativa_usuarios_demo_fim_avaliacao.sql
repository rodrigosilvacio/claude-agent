-- Fim do período de avaliação pública do appvendas (demo.html deixou de
-- aceitar novos cadastros — ver commit desta mesma mudança). Os ~40
-- usuários criados via criar-acesso-demo (rastreados por leads_demo) são
-- desativados agora — não excluídos, para preservar o histórico de quem
-- testou a ferramenta — e o login deixa de funcionar (signIn() em auth.js
-- já barra qualquer usuário com ativo=false).
--
-- 'rodrigosilvapmp' é o admin central da ferramenta (empresa_id nulo, fora
-- de leads_demo) — a condição abaixo já não o alcança, o filtro extra de
-- login é só uma segunda trava explícita.
update public.usuarios
set ativo = false
where id in (select usuario_id from public.leads_demo)
  and login <> 'rodrigosilvapmp';
