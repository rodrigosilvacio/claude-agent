-- Resumo/insights gerado por IA (Claude, via edge function
-- pandafit-analyze-document) sobre um documento (exame) — o médico pede
-- uma leitura de apoio de um PDF/JPG/PNG enviado pelo paciente. O
-- resultado fica salvo por documento (chave primária = document_id) pra
-- não gerar de novo — nem gastar de novo na API da Anthropic — toda vez
-- que o médico reabrir o mesmo exame.
create table public.pandafit_document_ai_summaries (
  document_id bigint primary key references public.pandafit_documents(id) on delete cascade,
  summary text not null,
  model text not null,
  generated_by uuid not null references auth.users(id),
  generated_at timestamptz not null default now()
);

alter table public.pandafit_document_ai_summaries enable row level security;

-- Leitura direta pro cliente segue a mesma regra de pandafit_documents:
-- dono do documento ou médico vinculado a ele. Escrita só pela edge
-- function (service role), que já valida essa mesma permissão antes de
-- chamar a API da Anthropic — por isso não há política de insert/update.
create policy "pandafit_document_ai_summaries_select" on public.pandafit_document_ai_summaries for select
  to authenticated
  using (
    exists (
      select 1 from public.pandafit_documents d
      where d.id = pandafit_document_ai_summaries.document_id
        and (
          (d.user_id = auth.uid() and public.pandafit_current_role() is not null)
          or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(d.user_id))
        )
    )
  );
