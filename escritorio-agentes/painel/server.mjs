#!/usr/bin/env node
// Painel de demandas do escritório (pixel art). Sem dependências.
// Recebe uma demanda, grava o briefing em entregas/<id>/ e dispara
// `claude -p "/post <id>"` nesta pasta. Os agentes trabalham em fila (um por vez)
// e aparecem no escritório do pixel-agents. O status de cada demanda é lido
// dos arquivos da pasta, então sobrevive a reinícios do painel.
//
// Uso: node painel/server.mjs [--port 4000] [--host 127.0.0.1] [--office http://127.0.0.1:3100]

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsClaude, criarBriefing, detalhe, idsDemandas, statusDe } from '../scripts/demanda-lib.mjs';

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

const estado = (id) => ({ rodando: emExecucao === id, naFila: fila.includes(id) });
const listar = () => idsDemandas(ENTREGAS).map((id) => statusDe(ENTREGAS, id, estado(id)));

// ---------- fila e execução ----------

function proximo() {
  if (emExecucao || !fila.length) return;
  const id = fila.shift();
  emExecucao = id;
  const log = createWriteStream(join(ENTREGAS, id, 'execucao.log'), { flags: 'a' });
  log.write(`\n[${new Date().toISOString()}] Iniciando /post ${id}\n`);
  const proc = spawn(CLAUDE, argsClaude(id), { cwd: RAIZ, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

function criarDemanda(dados) {
  const id = criarBriefing(ENTREGAS, dados);
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

const idValido = (id) => /^[a-z0-9-]+$/.test(id) && existsSync(join(ENTREGAS, id, 'briefing.json'));

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
    if (req.method === 'GET' && m) return idValido(m[1]) ? json(res, 200, detalhe(ENTREGAS, m[1], estado(m[1]))) : json(res, 404, { erro: 'demanda não encontrada' });
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
