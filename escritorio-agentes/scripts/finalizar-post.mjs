#!/usr/bin/env node
// Gera post-final.md (pronto para colar no LinkedIn) a partir da versão aprovada.
// Uso: node scripts/finalizar-post.mjs entregas/<id> <N>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acharTravessoes, lerSecoes, montarPostFinal } from './post-lib.mjs';

const [pasta, n] = process.argv.slice(2);
if (!pasta || !n) {
  console.error('Uso: node scripts/finalizar-post.mjs entregas/<id> <N>');
  process.exit(2);
}

const revisao = join(pasta, `revisao-v${n}.md`);
if (!existsSync(revisao) || !readFileSync(revisao, 'utf8').startsWith('VEREDITO: APROVADO')) {
  console.error(`A versão ${n} não está aprovada pelo Roberto (${revisao}).`);
  process.exit(1);
}

const final = montarPostFinal(lerSecoes(readFileSync(join(pasta, `post-v${n}.md`), 'utf8')));
const travessoes = acharTravessoes(final);
if (travessoes.length) {
  console.error(`Post aprovado ainda contém travessão: "${travessoes[0].trecho}"`);
  process.exit(1);
}

writeFileSync(join(pasta, 'post-final.md'), final);
console.log(`post-final.md gerado a partir da v${n} (${final.length} caracteres).`);
