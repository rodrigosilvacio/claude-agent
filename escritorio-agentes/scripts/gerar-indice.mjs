#!/usr/bin/env node
// Modo GitHub: gera entregas/index.json com todas as demandas (status, versões,
// pareceres e post final). É o que o painel lê quando está no GitHub Pages,
// onde não existe servidor.
// Uso: node scripts/gerar-indice.mjs

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detalhe, idsDemandas } from './demanda-lib.mjs';

const ENTREGAS = resolve('entregas');
const demandas = idsDemandas(ENTREGAS).map((id) => {
  const { log, ...d } = detalhe(ENTREGAS, id);
  return d;
});
writeFileSync(join(ENTREGAS, 'index.json'), JSON.stringify({ geradoEm: new Date().toISOString(), demandas }, null, 2));
console.log(`entregas/index.json com ${demandas.length} demanda(s).`);
