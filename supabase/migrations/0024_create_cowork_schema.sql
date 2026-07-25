-- Cowork: clone do Claude Cowork. Projetos com instruções de agente +
-- arquivos de referência, e documentos gerados (planilha/documento/apresentação)
-- via API da Anthropic. Diferente do Reports Panel (visível ao time todo), aqui
-- tudo é privado por dono: RLS usa auth.uid() = owner_id em vez de "authenticated".

create table public.cowork_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cowork_projects_owner_id_idx on public.cowork_projects (owner_id);

create table public.cowork_reference_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cowork_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint not null,
  extracted_text text,
  created_at timestamptz not null default now()
);

create index cowork_reference_files_project_id_idx on public.cowork_reference_files (project_id);

create table public.cowork_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.cowork_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  doc_type text not null check (doc_type in ('spreadsheet', 'document', 'presentation')),
  title text not null,
  prompt text not null,
  status text not null default 'generating' check (status in ('generating', 'ready', 'error')),
  error_message text,
  file_path text,
  file_name text,
  spec jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cowork_documents_project_id_idx on public.cowork_documents (project_id, created_at desc);

-- updated_at automático em projects/documents (evita esquecer de setar no client)
create or replace function public.cowork_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cowork_projects_set_updated_at
  before update on public.cowork_projects
  for each row execute function public.cowork_set_updated_at();

create trigger cowork_documents_set_updated_at
  before update on public.cowork_documents
  for each row execute function public.cowork_set_updated_at();

alter table public.cowork_projects enable row level security;
alter table public.cowork_reference_files enable row level security;
alter table public.cowork_documents enable row level security;

create policy "Owner can manage own projects"
  on public.cowork_projects for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owner can manage own reference files"
  on public.cowork_reference_files for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owner can manage own documents"
  on public.cowork_documents for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Storage: buckets privados, um para os anexos de referência do usuário, outro
-- para os arquivos Office gerados. Acesso restrito à própria pasta (primeiro
-- segmento do path = auth.uid()), mesmo padrão de "reports".
insert into storage.buckets (id, name, public)
values
  ('cowork-references', 'cowork-references', false),
  ('cowork-documents', 'cowork-documents', false)
on conflict (id) do nothing;

create policy "Owner can read own reference files in storage"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'cowork-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner can upload own reference files in storage"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cowork-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner can delete own reference files in storage"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cowork-references' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner can read own generated documents in storage"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'cowork-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner can upload own generated documents in storage"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cowork-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Owner can delete own generated documents in storage"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cowork-documents' and (storage.foldername(name))[1] = auth.uid()::text);
