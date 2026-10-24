#!/usr/bin/env node
// Checagem automática de uma versão do post (usada pelo Roberto).
// Uso: node scripts/checar-texto.mjs entregas/<id>/post-vN.md
// Sai com código 1 se houver algum ERRO (bloqueante).

import { readFileSync } from 'node:fs';
import { acharTravessoes, lerSecoes, montarPostFinal, SECOES } from './post-lib.mjs';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: node scripts/checar-texto.mjs <arquivo post-vN.md>');
  process.exit(2);
}

const secoes = lerSecoes(readFileSync(arquivo, 'utf8'));
const erros = [];
const avisos = [];

for (const s of SECOES) {
  if (!secoes[s]) erros.push(`Seção "## ${s}" ausente ou vazia.`);
}

const titulo = secoes['Título'] || '';
const texto = secoes['Texto'] || '';
const hashtags = secoes['Hashtags'] || '';
const frase = secoes['Frase para a arte'] || '';

if (titulo.includes('\n')) erros.push('O título deve ter uma linha só.');
if (titulo.length > 90) erros.push(`Título com ${titulo.length} caracteres (máximo 90).`);

const final = montarPostFinal(secoes);
if (final.length > 3000) erros.push(`Post com ${final.length} caracteres (máximo 3000 no LinkedIn).`);
else if (final.length > 1800) avisos.push(`Post com ${final.length} caracteres (ideal até 1800).`);
else if (final.length < 600) avisos.push(`Post com ${final.length} caracteres (curto, ideal a partir de 900).`);

const tags = hashtags.match(/#[\p{L}\p{N}_]+/gu) || [];
if (tags.length < 2 || tags.length > 3) erros.push(`${tags.length} hashtags (esperado de 2 a 3).`);

const palavrasFrase = frase.split(/\s+/).filter(Boolean).length;
if (palavrasFrase > 12) erros.push(`Frase para a arte com ${palavrasFrase} palavras (máximo 12).`);

for (const [nome, conteudo] of [['Título', titulo], ['Texto', texto], ['Hashtags', hashtags], ['Frase para a arte', frase]]) {
  for (const t of acharTravessoes(conteudo)) erros.push(`${nome}: ${t.nome} em "...${t.trecho}..."`);
}

const emojis = final.match(/\p{Extended_Pictographic}/gu) || [];
if (emojis.length > 2) avisos.push(`${emojis.length} emojis (máximo recomendado 2).`);

const paragrafoLongo = texto.split(/\n\s*\n/).find((p) => p.length > 320);
if (paragrafoLongo) avisos.push(`Parágrafo longo para LinkedIn: "${paragrafoLongo.slice(0, 60)}..."`);

console.log(`Arquivo: ${arquivo}`);
console.log(`Caracteres do post final: ${final.length} | Título: ${titulo.length} | Hashtags: ${tags.length}`);
for (const e of erros) console.log(`ERRO: ${e}`);
for (const a of avisos) console.log(`AVISO: ${a}`);
console.log(erros.length ? `RESULTADO: ${erros.length} erro(s) bloqueante(s)` : 'RESULTADO: nenhum erro automático');
process.exit(erros.length ? 1 : 0);
