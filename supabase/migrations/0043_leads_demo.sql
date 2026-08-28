-- Página pública de captura de leads para demonstração do ERPConnect
-- (appvendas/demo.html). Quem se cadastra ali ganha na hora um usuário real
-- (role 'caixa', nunca admin) dentro da Empresa Matriz de demonstração — a
-- criação da conta acontece na edge function criar-acesso-demo, que roda
-- com a service role (bypassa RLS). Esta tabela guarda só o contexto do
-- lead que não cabe em `usuarios` (cargo, empresa onde trabalha, telefone),
-- ligado 1:1 ao usuário criado, para o admin ver quem pediu acesso e por quê
-- direto na tela Administração > Usuários — não é só um registro solto
-- consultável apenas via SQL.

create table public.leads_demo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios(id) on delete cascade,
  nome text not null,
  email text not null unique,
  telefone text,
  cargo text,
  empresa_lead text,
  created_at timestamptz not null default now()
);

comment on table public.leads_demo is 'Leads capturados em appvendas/demo.html — contexto de quem pediu acesso de demonstração (cargo/empresa/telefone), ligado 1:1 ao usuário real criado para ele. Escrito só pela edge function criar-acesso-demo (service role); e-mail é a chave de idempotência (resubmissão = mesma conta, senha é redefinida).';

create index idx_leads_demo_email on public.leads_demo(email);

alter table public.leads_demo enable row level security;

-- Mesmo critério de erp_audit_log: só admin (da própria empresa, ou global)
-- enxerga quem são os leads de demonstração.
create policy leads_demo_select on public.leads_demo
  for select
  using (
    is_usuario_ativo() and is_admin()
    and (is_global_admin() or exists (
      select 1 from public.usuarios u
      where u.id = leads_demo.usuario_id and u.empresa_id = current_empresa_id()
    ))
  );

-- Sem policy de insert/update/delete para authenticated/anon: a única
-- escrita é a edge function criar-acesso-demo, que usa a service role
-- (bypassa RLS por privilégio, não por policy) — a rota é pública e não
-- deve depender de ninguém estar logado.
revoke all on public.leads_demo from authenticated, anon;
grant select on public.leads_demo to authenticated;
