-- Escritório de agentes (escritorio-agentes/): eventos ao vivo da esteira
-- Tiago (escritor), Roberto (revisor) e Eloah (artista), para o painel pixel
-- art mostrar em tempo real o que cada agente está fazendo.
--
-- Escrita: só a edge function `escritorio-evento` (service role), chamada pelo
-- runner da esteira (GitHub Actions ou máquina local) com um token próprio.
-- Ninguém escreve direto pela API pública.
-- Leitura: pública (anon), porque o painel roda no GitHub Pages sem login. Os
-- eventos guardam só etapa, agente e um rótulo curto da ação ("Tiago escreve
-- a v1"), nunca o conteúdo do briefing ou do post.

create table public.escritorio_eventos (
  id bigint generated always as identity primary key,
  demanda text not null check (char_length(demanda) between 1 and 120),
  issue integer,
  tipo text not null check (tipo in ('inicio', 'etapa', 'acao', 'veredito', 'fim')),
  agente text check (agente in ('tiago', 'roberto', 'eloah')),
  texto text not null check (char_length(texto) between 1 and 200),
  criado_em timestamptz not null default now()
);

create index escritorio_eventos_demanda_idx on public.escritorio_eventos (demanda, id);
create index escritorio_eventos_criado_em_idx on public.escritorio_eventos (criado_em desc);

alter table public.escritorio_eventos enable row level security;

create policy "escritorio_eventos leitura publica"
  on public.escritorio_eventos for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.escritorio_eventos from anon, authenticated;

-- Realtime: o painel assina os INSERTs desta tabela.
alter publication supabase_realtime add table public.escritorio_eventos;
