#!/usr/bin/env node
// Painel de demandas do escritório (pixel art). Sem dependências.
// Recebe uma demanda, grava o briefing em entregas/<id>/ e dispara
// `claude -p "/post <id>"` nesta pasta. Os agentes trabalham em fila (um por vez)
// e aparecem no escritório do pixel-agents. O status de cada demanda é lido
// dos arquivos da pasta, então sobrevive a reinícios do painel.
//
// Uso: node painel/server.mjs [--port 4000] [--host 127.0.0.1] [--office http://127.0.0.1:3100]

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTREGAS = join(RAIZ, 'entregas');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PORTA = Number(args.port || process.env.PORT || 4000);
const HOST = args.host || '127.0.0.1';
const ESCRITORIO = args.office || process.env.PIXEL_AGENTS_URL || 'http://127.0.0.1:3100';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';

mkdirSync(ENTREGAS, { recursive: true });

const fila = [];
let emExecucao = null;

// ---------- status derivado dos arquivos ----------

function versoes(arquivos, prefixo) {
  return arquivos
    .map((f) => f.match(new RegExp(`^${prefixo}-v(\\d+)\\.md$`)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

function statusDe(id) {
  const pasta = join(ENTREGAS, id);
  const arquivos = readdirSync(pasta);
  const tem = (f) => arquivos.includes(f);
  const posts = versoes(arquivos, 'post');
  const revisoes = versoes(arquivos, 'revisao').map((n) => ({
    n,
    aprovado: readFileSync(join(pasta, `revisao-v${n}.md`), 'utf8').startsWith('VEREDITO: APROVADO'),
  }));
  const ultimoPost = posts.at(-1) || 0;
  const ultimaRev = revisoes.at(-1);
  const rodando = emExecucao === id;

  let etapa, agente;
  if (tem('erro.txt')) [etapa, agente] = ['erro', null];
  else if (tem('arte.png') && tem('post-final.md')) [etapa, agente] = ['concluido', null];
  else if (tem('pendencias.md')) [etapa, agente] = ['escalado', null];
  else if (tem('post-final.md')) [etapa, agente] = ['arte', 'rodrigo'];
  else if (ultimaRev && ultimaRev.n === ultimoPost) [etapa, agente] = ultimaRev.aprovado ? ['finalizando', null] : ['ajuste', 'tiago'];
  else if (ultimoPost) [etapa, agente] = ['revisao', 'roberto'];
  else if (rodando) [etapa, agente] = ['escrita', 'tiago'];
  else [etapa, agente] = [fila.includes(id) ? 'fila' : 'parado', null];

  if (!rodando && ['escrita', 'revisao', 'ajuste', 'arte', 'finalizando'].includes(etapa)) [etapa, agente] = ['interrompido', null];

  const briefing = JSON.parse(readFileSync(join(pasta, 'briefing.json'), 'utf8'));
  return { id, tema: briefing.tema, criadoEm: briefing.criadoEm, etapa, agente, rodando, posts, revisoes, temArte: tem('arte.png') };
}

function listar() {
  return readdirSync(ENTREGAS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ENTREGAS, d.name, 'briefing.json')))
    .map((d) => statusDe(d.name))
    .sort((a, b) => b.id.localeCompare(a.id));
}

function detalhe(id) {
  const pasta = join(ENTREGAS, id);
  const ler = (f) => (existsSync(join(pasta, f)) ? readFileSync(join(pasta, f), 'utf8') : null);
  const s = statusDe(id);
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

// ---------- fila e execução ----------

function proximo() {
  if (emExecucao || !fila.length) return;
  const id = fila.shift();
  emExecucao = id;
  const log = createWriteStream(join(ENTREGAS, id, 'execucao.log'), { flags: 'a' });
  log.write(`\n[${new Date().toISOString()}] Iniciando /post ${id}\n`);
  // As permissões vão explícitas na chamada (além de .claude/settings.json) para a
  // esteira rodar sem prompts mesmo antes de a pasta ser marcada como confiável.
  const permitidas = [
    'Read', 'Glob', 'Agent', 'Write', 'Edit',
    'Bash(node scripts/checar-texto.mjs:*)', 'Bash(node scripts/finalizar-post.mjs:*)', 'Bash(node scripts/renderizar-arte.mjs:*)',
  ];
  const proc = spawn(CLAUDE, ['-p', `/post ${id}`, '--permission-mode', 'acceptEdits', '--allowedTools', permitidas.join(',')], {
    cwd: RAIZ,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(log, { end: false });
  proc.stderr.pipe(log, { end: false });
  const fim = (msg) => {
    log.end(`\n[${new Date().toISOString()}] ${msg}\n`);
    emExecucao = null;
    proximo();
  };
  proc.on('error', (e) => {
    writeFileSync(join(ENTREGAS, id, 'erro.txt'), `Não consegui iniciar o Claude Code (${CLAUDE}): ${e.message}\n`);
    fim('Falha ao iniciar');
  });
  proc.on('close', (code) => fim(`Encerrado com código ${code}`));
}

function slug(t) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';
}

function criarDemanda(dados) {
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
  const pasta = join(ENTREGAS, id);
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, 'briefing.json'), JSON.stringify({ ...d, criadoEm: agora.toISOString() }, null, 2));
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
  fila.push(id);
  proximo();
  return id;
}

// ---------- HTTP ----------

const TIPOS = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };

function json(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function arquivo(res, base, relativo) {
  const alvo = normalize(join(base, relativo));
  if (!alvo.startsWith(base + sep) || !existsSync(alvo)) return json(res, 404, { erro: 'não encontrado' });
  res.writeHead(200, { 'Content-Type': TIPOS[extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(alvo));
}

const idValido = (id) => /^[0-9]{8}-[0-9]{6}-[a-z0-9-]+$/.test(id) && existsSync(join(ENTREGAS, id, 'briefing.json'));

createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && p === '/') return arquivo(res, join(RAIZ, 'painel'), 'index.html');
    if (req.method === 'GET' && p === '/api/config') return json(res, 200, { escritorio: ESCRITORIO });
    if (req.method === 'GET' && p === '/api/demandas') return json(res, 200, { emExecucao, fila, demandas: listar() });
    if (req.method === 'POST' && p === '/api/demandas') {
      let corpo = '';
      req.on('data', (c) => {
        corpo += c;
        if (corpo.length > 20000) req.destroy();
      });
      req.on('end', () => {
        try {
          json(res, 201, { id: criarDemanda(JSON.parse(corpo || '{}')) });
        } catch (e) {
          json(res, 400, { erro: e.message });
        }
      });
      return;
    }
    let m = p.match(/^\/api\/demandas\/([^/]+)$/);
    if (req.method === 'GET' && m) return idValido(m[1]) ? json(res, 200, detalhe(m[1])) : json(res, 404, { erro: 'demanda não encontrada' });
    m = p.match(/^\/api\/demandas\/([^/]+)\/reprocessar$/);
    if (req.method === 'POST' && m && idValido(m[1])) {
      if (emExecucao === m[1] || fila.includes(m[1])) return json(res, 409, { erro: 'demanda já está em andamento' });
      const erro = join(ENTREGAS, m[1], 'erro.txt');
      if (existsSync(erro)) renameSync(erro, join(ENTREGAS, m[1], `erro-${Date.now()}.txt`));
      fila.push(m[1]);
      proximo();
      return json(res, 202, { ok: true });
    }
    if (req.method === 'GET' && p.startsWith('/entregas/')) return arquivo(res, ENTREGAS, p.slice('/entregas/'.length));
    if (req.method === 'GET' && p.startsWith('/assets/')) return arquivo(res, join(RAIZ, 'assets'), p.slice('/assets/'.length));
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
}).listen(PORTA, HOST, () => {
  console.log(`Painel de demandas: http://${HOST}:${PORTA}`);
  console.log(`Escritório pixel-agents esperado em: ${ESCRITORIO}`);
});
