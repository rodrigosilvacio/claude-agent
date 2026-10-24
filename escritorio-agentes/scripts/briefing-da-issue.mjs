#!/usr/bin/env node
// Modo GitHub: transforma a issue "[Post] ..." (aberta pelo formulário
// .github/ISSUE_TEMPLATE/demanda-post.yml) em entregas/<id>/briefing.*.
// Lê o evento do GITHUB_EVENT_PATH e escreve `id=<id>` no GITHUB_OUTPUT.
// Se a issue já tiver uma demanda (reexecução), reaproveita a pasta existente.

import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { criarBriefing, idsDemandas } from './demanda-lib.mjs';

const ENTREGAS = resolve('entregas');
const CAMPOS = {
  'Tema do post': 'tema',
  'Descrição do post': 'descricao',
  Objetivo: 'objetivo',
  Público: 'publico',
  'Chamada para ação': 'cta',
  Observações: 'observacoes',
};

const { issue } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

// O corpo de um issue form vem como "### Rótulo\n\nvalor\n\n### Rótulo...".
const dados = {};
for (const bloco of (issue.body || '').split(/^###\s+/m).slice(1)) {
  const [rotulo, ...resto] = bloco.split('\n');
  const chave = CAMPOS[rotulo.trim()];
  const valor = resto.join('\n').trim();
  if (chave && valor !== '_No response_') dados[chave] = valor;
}
if (!dados.tema) dados.tema = issue.title.replace(/^\[Post\]\s*/i, '');

const existente = idsDemandas(ENTREGAS).find(
  (id) => JSON.parse(readFileSync(join(ENTREGAS, id, 'briefing.json'), 'utf8')).issue === issue.number,
);
const id = existente || criarBriefing(ENTREGAS, dados, { issue: issue.number });

console.log(`${existente ? 'Retomando' : 'Nova'} demanda ${id} (issue #${issue.number})`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `id=${id}\n`);
