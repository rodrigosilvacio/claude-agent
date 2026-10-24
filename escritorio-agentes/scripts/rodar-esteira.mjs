#!/usr/bin/env node
// Roda a esteira (/post <id>) com o Claude Code em modo não interativo.
// Usado pelo workflow do GitHub; o painel local chama o Claude direto.
// Uso: node scripts/rodar-esteira.mjs <id>

import { spawnSync } from 'node:child_process';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argsClaude } from './demanda-lib.mjs';

const id = process.argv[2];
const pasta = join('entregas', id || '');
if (!id || !existsSync(join(pasta, 'briefing.md'))) {
  console.error(`Demanda não encontrada: ${pasta}`);
  process.exit(2);
}

// Numa reexecução, o erro anterior sai do caminho (fica guardado com data).
if (existsSync(join(pasta, 'erro.txt'))) renameSync(join(pasta, 'erro.txt'), join(pasta, `erro-${Date.now()}.txt`));

if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  writeFileSync(join(pasta, 'erro.txt'), 'Faltou configurar a secret ANTHROPIC_API_KEY (ou CLAUDE_CODE_OAUTH_TOKEN) no repositório.\n');
  console.error('Sem credencial do Claude: configure ANTHROPIC_API_KEY ou CLAUDE_CODE_OAUTH_TOKEN.');
  process.exit(1);
}

const r = spawnSync(process.env.CLAUDE_BIN || 'claude', argsClaude(id), { stdio: 'inherit' });
if (r.error) {
  writeFileSync(join(pasta, 'erro.txt'), `Não consegui iniciar o Claude Code: ${r.error.message}\n`);
  process.exit(1);
}
process.exit(r.status ?? 1);
