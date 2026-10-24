#!/usr/bin/env node
// Roda a esteira (/post <id>) com o Claude Code e transmite ao vivo o que cada
// agente está fazendo. Lê o stream-json do Claude: cada chamada da ferramenta
// Agent abre uma etapa (Tiago, Roberto ou Eloah) e as ferramentas usadas
// dentro dela (parent_tool_use_id) viram ações ("Roberto roda a checagem").
// Os eventos vão para a edge function `escritorio-evento` (Supabase), que o
// painel assina via Realtime. Sem ESCRITORIO_TOKEN, só imprime no terminal.
// Usado pelo painel local (painel/server.mjs).
// Uso: node scripts/rodar-esteira.mjs <id>

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { argsClaude, statusDe } from './demanda-lib.mjs';

const URL_EVENTOS = process.env.ESCRITORIO_EVENTOS_URL || 'https://xtrvojnauvkkterogrst.supabase.co/functions/v1/escritorio-evento';
const TOKEN = process.env.ESCRITORIO_TOKEN || '';
const ENTREGAS = resolve('entregas');
const AGENTE_DO_SUBAGENTE = { 'tiago-escritor': 'tiago', 'roberto-revisor': 'roberto', 'eloah-artista': 'eloah' };
const NOME = { tiago: 'Tiago', roberto: 'Roberto', eloah: 'Eloah' };

const id = process.argv[2];
const pasta = join(ENTREGAS, id || '');
if (!id || !existsSync(join(pasta, 'briefing.md'))) {
  console.error(`Demanda não encontrada: ${pasta}`);
  process.exit(2);
}

// Numa reexecução, o erro anterior sai do caminho (fica guardado com data).
if (existsSync(join(pasta, 'erro.txt'))) renameSync(join(pasta, 'erro.txt'), join(pasta, `erro-${Date.now()}.txt`));

// ---------- envio dos eventos (em ordem, sem nunca derrubar a esteira) ----------

let fila = Promise.resolve();
let avisouFalha = false;
function emitir(tipo, agente, texto) {
  console.log(`[${agente ? NOME[agente] : 'Escritório'}] ${texto}`);
  if (!TOKEN) return;
  const corpo = JSON.stringify({ demanda: id, tipo, agente, texto });
  fila = fila.then(() =>
    fetch(URL_EVENTOS, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-escritorio-token': TOKEN }, body: corpo, signal: AbortSignal.timeout(8000) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
      .catch((e) => {
        if (!avisouFalha) console.error(`Aviso: eventos ao vivo indisponíveis (${e.message}). A esteira segue normalmente.`);
        avisouFalha = true;
      }),
  );
}

// ---------- tradução das ferramentas em ações legíveis ----------

function rotular(ferramenta, entrada = {}) {
  const arq = basename(String(entrada.file_path || ''));
  const v = (arq.match(/-v(\d+)\.md$/) || [])[1];
  const cmd = String(entrada.command || '');
  if (ferramenta === 'Read') {
    if (arq === 'briefing.md') return 'lê o briefing';
    if (arq.startsWith('post-v')) return `lê a v${v}`;
    if (arq.startsWith('revisao-v')) return `lê o parecer da v${v}`;
    if (arq === 'post-final.md') return 'lê o post aprovado';
    if (arq === 'arte.png') return 'confere a arte renderizada';
    return `lê ${arq || 'um arquivo'}`;
  }
  if (ferramenta === 'Write' || ferramenta === 'Edit') {
    if (arq.startsWith('post-v')) return ferramenta === 'Write' ? `escreve a v${v}` : `ajusta a v${v}`;
    if (arq.startsWith('revisao-v')) return `registra o parecer da v${v}`;
    if (arq === 'arte.html') return ferramenta === 'Write' ? 'desenha a arte' : 'ajusta a arte';
    if (arq === 'pendencias.md') return 'registra as pendências';
    return `${ferramenta === 'Write' ? 'escreve' : 'edita'} ${arq || 'um arquivo'}`;
  }
  if (ferramenta === 'Bash') {
    // Só conta como script da esteira quando o comando realmente chama o script
    // (um heredoc com HTML que cita o nome do script não é renderização).
    const script = (cmd.match(/(?:^|&&\s*|;\s*)node\s+\S*scripts\/([a-z-]+)\.mjs/) || [])[1];
    if (script === 'checar-texto') return 'roda a checagem automática';
    if (script === 'renderizar-arte') return 'renderiza o PNG';
    if (script === 'finalizar-post') return 'gera o post final';
    return 'tenta um comando fora da esteira';
  }
  if (ferramenta === 'Glob') return 'procura arquivos';
  return `usa ${ferramenta}`;
}

// Última linha útil da saída de um script (RESULTADO/OK/ERRO).
function resumoSaida(conteudo) {
  const texto = Array.isArray(conteudo) ? conteudo.map((c) => c.text || '').join('\n') : String(conteudo || '');
  const linhas = texto.split('\n').map((l) => l.trim());
  return linhas.find((l) => l.startsWith('RESULTADO:')) || linhas.find((l) => l.startsWith('OK:')) || linhas.find((l) => l.startsWith('ERRO:'));
}

function veredito(etapaDescricao) {
  const v = (etapaDescricao.match(/v(\d+)/) || [])[1];
  const arquivo = v && join(pasta, `revisao-v${v}.md`);
  if (!arquivo || !existsSync(arquivo)) return null;
  const t = readFileSync(arquivo, 'utf8');
  const media = (t.match(/\*\*Média\*\*\s*\|\s*\*\*([\d,]+)\*\*/) || [])[1];
  const aprovado = t.startsWith('VEREDITO: APROVADO');
  return `${aprovado ? 'APROVOU' : 'REPROVOU'} a v${v}${media ? ` (média ${media})` : ''}`;
}

// ---------- execução ----------

const etapas = new Map(); // id da chamada Agent -> { agente, descricao }
const scripts = new Map(); // id da chamada Bash -> agente (para ler o resultado)
const encerradas = new Set(); // etapas cujo fim já foi tratado

// Fim de uma etapa: chega como tool_result do Agent (em primeiro plano) ou como
// system/task_notification (quando o Claude roda o agente em segundo plano).
function etapaTerminou(toolUseId) {
  const etapa = etapas.get(toolUseId);
  if (!etapa || encerradas.has(toolUseId)) return;
  encerradas.add(toolUseId);
  if (etapa.agente === 'roberto') {
    const v = veredito(etapa.descricao);
    if (v) emitir('veredito', 'roberto', `Roberto ${v}`);
  }
}

emitir('inicio', null, 'demanda chegou na mesa do Tiago');
const proc = spawn(process.env.CLAUDE_BIN || 'claude', [...argsClaude(id), '--output-format', 'stream-json', '--verbose'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});

createInterface({ input: proc.stdout }).on('line', (linha) => {
  let e;
  try { e = JSON.parse(linha); } catch { return; }
  const blocos = Array.isArray(e.message?.content) ? e.message.content : [];
  const dono = e.parent_tool_use_id ? etapas.get(e.parent_tool_use_id) : null;

  if (e.type === 'assistant') {
    for (const b of blocos.filter((x) => x.type === 'tool_use')) {
      if (!dono && b.name === 'Agent') {
        const agente = AGENTE_DO_SUBAGENTE[b.input?.subagent_type] || null;
        const descricao = String(b.input?.description || 'trabalha');
        etapas.set(b.id, { agente, descricao });
        emitir('etapa', agente, descricao);
      } else {
        const agente = dono?.agente || null;
        const acao = rotular(b.name, b.input);
        if (b.name === 'Bash') scripts.set(b.id, agente);
        emitir('acao', agente, agente ? `${NOME[agente]} ${acao}` : acao);
      }
    }
  }

  if (e.type === 'user') {
    for (const b of blocos.filter((x) => x.type === 'tool_result')) {
      if (scripts.has(b.tool_use_id)) {
        const agente = scripts.get(b.tool_use_id);
        const resumo = resumoSaida(b.content);
        if (resumo) emitir('acao', agente, resumo.slice(0, 180));
      }
      const texto = JSON.stringify(b.content || '');
      if (etapas.has(b.tool_use_id) && !texto.includes('agent launched')) etapaTerminou(b.tool_use_id);
    }
  }

  if (e.type === 'system' && e.subtype === 'task_notification' && e.status === 'completed') etapaTerminou(e.tool_use_id);
});

proc.on('error', (err) => {
  writeFileSync(join(pasta, 'erro.txt'), `Não consegui iniciar o Claude Code: ${err.message}\n`);
});

proc.on('close', async (codigo) => {
  const { etapa } = statusDe(ENTREGAS, id);
  const finais = {
    concluido: 'post revisado e arte entregues',
    escalado: 'Roberto não aprovou em 3 rodadas: precisa de você',
    erro: 'a esteira parou com erro',
    interrompido: 'a esteira foi interrompida antes do fim',
  };
  emitir('fim', null, finais[etapa] || `a esteira terminou na etapa ${etapa}`);
  await fila;
  process.exit(codigo ?? 1);
});
