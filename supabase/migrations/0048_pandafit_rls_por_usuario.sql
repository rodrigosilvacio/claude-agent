-- Substitui as políticas anon-abertas por políticas baseadas em auth.uid()
-- + pandafit_current_role(): cada usuario (e o admin, que também usa o app
-- como usuario) só enxerga/mexe nas próprias linhas; medico tem SELECT em
-- tudo (somente leitura, sem insert/update/delete). O `pandafit_current_role()
-- is not null` em toda política garante que só contas com linha em
-- pandafit_usuarios (ou seja, com acesso ao PandaFit) conseguem ler/escrever
-- aqui — outra conta autenticada deste mesmo projeto Supabase compartilhado,
-- mas de outro app, nunca passa em nenhuma política.

-- ── pandafit_workouts ──
drop policy if exists "pandafit_workouts_anon_select" on public.pandafit_workouts;
drop policy if exists "pandafit_workouts_anon_insert" on public.pandafit_workouts;
drop policy if exists "pandafit_workouts_anon_delete" on public.pandafit_workouts;

create policy "pandafit_workouts_select" on public.pandafit_workouts for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or public.pandafit_current_role() = 'medico'
  );

create policy "pandafit_workouts_insert" on public.pandafit_workouts for insert
  to authenticated
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_workouts_update" on public.pandafit_workouts for update
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null)
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_workouts_delete" on public.pandafit_workouts for delete
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null);

-- ── pandafit_weights ──
drop policy if exists "pandafit_weights_anon_select" on public.pandafit_weights;
drop policy if exists "pandafit_weights_anon_insert" on public.pandafit_weights;
drop policy if exists "pandafit_weights_anon_update" on public.pandafit_weights;
drop policy if exists "pandafit_weights_anon_delete" on public.pandafit_weights;

create policy "pandafit_weights_select" on public.pandafit_weights for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or public.pandafit_current_role() = 'medico'
  );

create policy "pandafit_weights_insert" on public.pandafit_weights for insert
  to authenticated
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_weights_update" on public.pandafit_weights for update
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null)
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_weights_delete" on public.pandafit_weights for delete
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null);

-- ── pandafit_documents ──
drop policy if exists "pandafit_documents_anon_select" on public.pandafit_documents;
drop policy if exists "pandafit_documents_anon_insert" on public.pandafit_documents;
drop policy if exists "pandafit_documents_anon_delete" on public.pandafit_documents;

create policy "pandafit_documents_select" on public.pandafit_documents for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or public.pandafit_current_role() = 'medico'
  );

create policy "pandafit_documents_insert" on public.pandafit_documents for insert
  to authenticated
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_documents_delete" on public.pandafit_documents for delete
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null);

-- ── pandafit_settings ──
-- Só o próprio dono (meta mensal / peso-alvo são config pessoal, o médico
-- não precisa disso pra acompanhar o paciente).
drop policy if exists "pandafit_settings_anon_select" on public.pandafit_settings;
drop policy if exists "pandafit_settings_anon_update" on public.pandafit_settings;

create policy "pandafit_settings_select" on public.pandafit_settings for select
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_settings_insert" on public.pandafit_settings for insert
  to authenticated
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

create policy "pandafit_settings_update" on public.pandafit_settings for update
  to authenticated
  using (user_id = auth.uid() and public.pandafit_current_role() is not null)
  with check (user_id = auth.uid() and public.pandafit_current_role() is not null);

-- ── Storage: pandafit-documents deixa de ser público ──
-- Agora guarda exame médico de verdade escopado por usuário — um bucket
-- público serviria o arquivo pra qualquer um com a URL, RLS ou não. Os
-- arquivos passam a viver em "<user_id>/<arquivo>" (ver app.js) e o "Ver"
-- do app usa createSignedUrl (link temporário) em vez de getPublicUrl.
update storage.buckets set public = false where id = 'pandafit-documents';

drop policy if exists "pandafit_documents_storage_anon_select" on storage.objects;
drop policy if exists "pandafit_documents_storage_anon_insert" on storage.objects;
drop policy if exists "pandafit_documents_storage_anon_delete" on storage.objects;

create policy "pandafit_documents_storage_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pandafit-documents'
    and (
      (storage.foldername(name)) [1] = auth.uid()::text
      or public.pandafit_current_role() = 'medico'
    )
    and public.pandafit_current_role() is not null
  );

create policy "pandafit_documents_storage_insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pandafit-documents'
    and (storage.foldername(name)) [1] = auth.uid()::text
    and public.pandafit_current_role() is not null
  );

create policy "pandafit_documents_storage_delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pandafit-documents'
    and (storage.foldername(name)) [1] = auth.uid()::text
    and public.pandafit_current_role() is not null
  );
