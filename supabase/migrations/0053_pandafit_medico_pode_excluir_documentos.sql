-- Até aqui o médico só tinha SELECT em pandafit_documents/storage.objects
-- (somente leitura). Agora ele também pode excluir um documento do
-- paciente (mesmo poder que o próprio paciente tem sobre o que ele
-- enviou) — pedido explícito para permitir limpar exames enviados por
-- engano ou já obsoletos.
drop policy if exists "pandafit_documents_delete" on public.pandafit_documents;

create policy "pandafit_documents_delete" on public.pandafit_documents for delete
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or public.pandafit_current_role() = 'medico'
  );

drop policy if exists "pandafit_documents_storage_delete" on storage.objects;

create policy "pandafit_documents_storage_delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pandafit-documents'
    and (
      (storage.foldername(name)) [1] = auth.uid()::text
      or public.pandafit_current_role() = 'medico'
    )
    and public.pandafit_current_role() is not null
  );
