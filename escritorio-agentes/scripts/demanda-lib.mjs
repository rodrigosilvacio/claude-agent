// Regras do modo local (painel/server.mjs e scripts/rodar-esteira.mjs):
// criação do briefing, status derivado dos arquivos de cada demanda e a
// chamada do Claude Code que roda a esteira.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// As permissões vão explícitas na chamada (além de .claude/settings.json) para a
// esteira rodar sem prompts mesmo antes de a pasta ser marcada como confiável.
export const FERRAMENTAS_PERMITIDAS = [
  'Read', 'Glob', 'Agent', 'Write(./entregas/**)', 'Edit(./entregas/**)',
  'Bash(node scripts/checar-texto.mjs:*)', 'Bash(node scripts/finalizar-post.mjs:*)', 'Bash(node scripts/renderizar-arte.mjs:*)',
];

export function argsClaude(id) {
  return ['-p', `/post ${id}`, '--permission-mode', 'acceptEdits', '--allowedTools', FERRAMENTAS_PERMITIDAS.join(',')];
}

// ---------- criação ----------

function slug(t) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';
}

// Cria entregas/<id>/briefing.json e briefing.md. `extra` guarda metadados de
// origem. Devolve o id.
export function criarBriefing(entregas, dados, extra = {}) {
  const limpar = (v, max) => String(v || '').trim().slice(0, max);
  const d = {
    tema: limpar(dados.tema, 200),
    descricao: limpar(dados.descricao, 4000),
    objetivo: limpar(dados.objetivo, 300),
    publico: limpar(dados.publico, 300),
    cta: limpar(dados.cta, 300),
    observacoes: limpar(dados.observacoes, 1500),
  };
  if (!d.tema || !d.descricao) throw new Error('Tema e descrição são obrigatórios.');
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const id = `${carimbo}-${slug(d.tema)}`;
  const pasta = join(entregas, id);
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, 'briefing.json'), JSON.stringify({ ...d, ...extra, criadoEm: agora.toISOString() }, null, 2));
  writeFileSync(
    join(pasta, 'briefing.md'),
    [
      `# Briefing: ${d.tema}`,
      '',
      `**Descrição do post:**\n${d.descricao}`,
      `**Objetivo:** ${d.objetivo || 'não informado (Tiago decide)'}`,
      `**Público:** ${d.publico || 'executivos, CIOs, CTOs e líderes de tecnologia'}`,
      `**Chamada para ação:** ${d.cta || 'não informada (fechar com reflexão ou pergunta)'}`,
      `**Observações:** ${d.observacoes || 'nenhuma'}`,
      '',
    ].join('\n\n'),
  );
  return id;
}

// ---------- status derivado dos arquivos ----------

function versoes(arquivos, prefixo) {
  return arquivos
    .map((f) => f.match(new RegExp(`^${prefixo}-v(\\d+)\\.md$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

// `rodando` e `naFila` vêm de quem executa (o painel local sabe).
export function statusDe(entregas, id, { rodando = false, naFila = false } = {}) {
  const pasta = join(entregas, id);
  const arquivos = readdirSync(pasta);
  const tem = (f) => arquivos.includes(f);
  const posts = versoes(arquivos, 'post');
  const revisoes = versoes(arquivos, 'revisao').map((n) => ({
    n,
    aprovado: readFileSync(join(pasta, `revisao-v${n}.md`), 'utf8').startsWith('VEREDITO: APROVADO'),
  }));
  const ultimoPost = posts.at(-1) || 0;
  const ultimaRev = revisoes.at(-1);

  let etapa, agente;
  if (tem('erro.txt')) [etapa, agente] = ['erro', null];
  else if (tem('arte.png') && tem('post-final.md')) [etapa, agente] = ['concluido', null];
  else if (tem('pendencias.md')) [etapa, agente] = ['escalado', null];
  else if (tem('post-final.md')) [etapa, agente] = ['arte', 'eloah'];
  else if (ultimaRev && ultimaRev.n === ultimoPost) [etapa, agente] = ultimaRev.aprovado ? ['finalizando', null] : ['ajuste', 'tiago'];
  else if (ultimoPost) [etapa, agente] = ['revisao', 'roberto'];
  else if (rodando) [etapa, agente] = ['escrita', 'tiago'];
  else [etapa, agente] = [naFila ? 'fila' : 'parado', null];

  if (!rodando && ['escrita', 'revisao', 'ajuste', 'arte', 'finalizando'].includes(etapa)) [etapa, agente] = ['interrompido', null];

  const briefing = JSON.parse(readFileSync(join(pasta, 'briefing.json'), 'utf8'));
  return {
    id, tema: briefing.tema, criadoEm: briefing.criadoEm,
    etapa, agente, rodando, posts, revisoes, temArte: tem('arte.png'),
  };
}

export function idsDemandas(entregas) {
  return readdirSync(entregas, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(entregas, d.name, 'briefing.json')))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));
}

export function detalhe(entregas, id, estado) {
  const pasta = join(entregas, id);
  const ler = (f) => (existsSync(join(pasta, f)) ? readFileSync(join(pasta, f), 'utf8') : null);
  const s = statusDe(entregas, id, estado);
  return {
    ...s,
    briefing: ler('briefing.md'),
    historico: s.posts.map((n) => ({ n, post: ler(`post-v${n}.md`), revisao: ler(`revisao-v${n}.md`) })),
    postFinal: ler('post-final.md'),
    pendencias: ler('pendencias.md'),
    erro: ler('erro.txt'),
    log: (ler('execucao.log') || '').slice(-4000),
  };
}
