-- Até aqui QUALQUER médico enxergava TODOS os pacientes (usuario) do
-- sistema — sem vínculo nenhum. Isso só fazia sentido enquanto só existia
-- um médico. Agora um paciente só é visível para os médicos explicitamente
-- conectados a ele pelo admin (gestão de cadastros); um paciente pode ter
-- vários médicos, e um médico vários pacientes (N:N).
--
-- A tabela de vínculo, assim como pandafit_usuarios, só é escrita pela edge
-- function pandafit-admin-users (service role) — nunca diretamente pelo
-- cliente, por isso não tem política alguma de insert/update/delete (nega
-- por padrão) nem de select (o admin lê os vínculos através da própria
-- function, não da tabela).
create table public.pandafit_medico_pacientes (
  medico_id uuid not null references auth.users(id),
  usuario_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (medico_id, usuario_id)
);

alter table public.pandafit_medico_pacientes enable row level security;

-- security definer: usada dentro das políticas de médico-lê-paciente em
-- todas as tabelas abaixo, sem cada uma precisar de uma subquery própria
-- (e sem disparar RLS recursiva na própria pandafit_medico_pacientes, que
-- não tem política de select pra ninguém).
create or replace function public.pandafit_is_medico_de(paciente_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.pandafit_medico_pacientes
    where medico_id = auth.uid() and usuario_id = paciente_id
  );
$$;

-- ── pandafit_usuarios: médico só enxerga os pacientes vinculados a ele
-- (admin continua enxergando todo mundo, pra gerenciar contas) ──
drop policy if exists "pandafit_usuarios_select" on public.pandafit_usuarios;

create policy "pandafit_usuarios_select"
  on public.pandafit_usuarios for select
  to authenticated
  using (
    id = auth.uid()
    or public.pandafit_current_role() = 'admin'
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(id))
  );

-- ── pandafit_workouts ──
drop policy if exists "pandafit_workouts_select" on public.pandafit_workouts;

create policy "pandafit_workouts_select" on public.pandafit_workouts for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

-- ── pandafit_weights ──
drop policy if exists "pandafit_weights_select" on public.pandafit_weights;

create policy "pandafit_weights_select" on public.pandafit_weights for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

-- ── pandafit_body_measurements ──
drop policy if exists "pandafit_body_measurements_select" on public.pandafit_body_measurements;

create policy "pandafit_body_measurements_select" on public.pandafit_body_measurements for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

-- ── pandafit_workout_sets ──
drop policy if exists "pandafit_workout_sets_select" on public.pandafit_workout_sets;

create policy "pandafit_workout_sets_select" on public.pandafit_workout_sets for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

-- ── pandafit_documents (select + delete — médico podia excluir doc de
-- qualquer paciente; agora só do paciente vinculado) ──
drop policy if exists "pandafit_documents_select" on public.pandafit_documents;

create policy "pandafit_documents_select" on public.pandafit_documents for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

drop policy if exists "pandafit_documents_delete" on public.pandafit_documents;

create policy "pandafit_documents_delete" on public.pandafit_documents for delete
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

drop policy if exists "pandafit_documents_storage_select" on storage.objects;

create policy "pandafit_documents_storage_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pandafit-documents'
    and (
      (storage.foldername(name)) [1] = auth.uid()::text
      or (
        public.pandafit_current_role() = 'medico'
        and public.pandafit_is_medico_de(((storage.foldername(name)) [1])::uuid)
      )
    )
    and public.pandafit_current_role() is not null
  );

drop policy if exists "pandafit_documents_storage_delete" on storage.objects;

create policy "pandafit_documents_storage_delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pandafit-documents'
    and (
      (storage.foldername(name)) [1] = auth.uid()::text
      or (
        public.pandafit_current_role() = 'medico'
        and public.pandafit_is_medico_de(((storage.foldername(name)) [1])::uuid)
      )
    )
    and public.pandafit_current_role() is not null
  );

-- ── pandafit_progress_photos (select só — médico já era read-only aqui) ──
drop policy if exists "pandafit_progress_photos_select" on public.pandafit_progress_photos;

create policy "pandafit_progress_photos_select" on public.pandafit_progress_photos for select
  to authenticated
  using (
    (user_id = auth.uid() and public.pandafit_current_role() is not null)
    or (public.pandafit_current_role() = 'medico' and public.pandafit_is_medico_de(user_id))
  );

drop policy if exists "pandafit_progress_photos_storage_select" on storage.objects;

create policy "pandafit_progress_photos_storage_select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pandafit-progress-photos'
    and (
      (storage.foldername(name)) [1] = auth.uid()::text
      or (
        public.pandafit_current_role() = 'medico'
        and public.pandafit_is_medico_de(((storage.foldername(name)) [1])::uuid)
      )
    )
    and public.pandafit_current_role() is not null
  );
