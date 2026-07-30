-- Agente Theo: consulta um catálogo/tabela de preços (Google Sheets ao vivo)
-- via WhatsApp (Z-API), com busca na web como fallback quando a planilha não
-- tem a resposta, e consulta de CEP via o servidor MCP `mcp-cep` já existente
-- neste repositório. Histórico de conversa persistido por telefone, mesmo
-- padrão do Oráculo (migration 0010).
--
-- Estas tabelas só são tocadas pela edge function `theo-webhook`
-- (service role) — quem chama o webhook é o Z-API, não um usuário logado no
-- Supabase Auth. Por isso RLS fica habilitada sem nenhuma policy: nem
-- `anon` nem `authenticated` enxergam essas tabelas, só a service role
-- (que ignora RLS).

create table public.theo_conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null unique,
  nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.theo_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.theo_conversas(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  conteudo text not null,
  -- id da mensagem no Z-API, usado para dedup quando o webhook reentrega a
  -- mesma mensagem (retry). Nulo para mensagens do assistente.
  zapi_message_id text,
  criado_em timestamptz not null default now()
);

create index theo_mensagens_conversa_id_idx on public.theo_mensagens (conversa_id, criado_em);

create unique index theo_mensagens_zapi_message_id_idx
  on public.theo_mensagens (zapi_message_id)
  where zapi_message_id is not null;

alter table public.theo_conversas enable row level security;
alter table public.theo_mensagens enable row level security;
