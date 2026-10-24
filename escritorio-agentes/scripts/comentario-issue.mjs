#!/usr/bin/env node
// Modo GitHub: monta o comentário de entrega da issue (post revisado + arte,
// ou as pendências/erro) a partir de entregas/<id>/.
// Uso: node scripts/comentario-issue.mjs <id> https://github.com/<dono>/<repo>/raw/main/escritorio-agentes/entregas/<id>

import { resolve } from 'node:path';
import { detalhe } from './demanda-lib.mjs';

const [id, base] = process.argv.slice(2);
const d = detalhe(resolve('entregas'), id);
const rodadas = d.revisoes.length;
const nota = (t) => (t.match(/\*\*Média\*\*\s*\|\s*\*\*([\d,]+)\*\*/) || [])[1];
const linhas = [];

if (d.etapa === 'concluido') {
  const media = nota(d.historico.at(-1).revisao || '');
  linhas.push(
    `## ✅ Entregue pelo escritório`,
    `Tiago escreveu, Roberto aprovou${media ? ` com média **${media}**` : ''} em **${rodadas} rodada(s)** e Eloah criou a arte.`,
    '',
    '### Post revisado (pronto para copiar)',
    '```text', d.postFinal.trim(), '```',
    '',
    '### Arte',
    `![Arte do post](${base}/arte.png)`,
    '',
    `[Baixar arte](${base}/arte.png) · [Histórico completo](${base.replace('/raw/', '/tree/')})`,
  );
} else if (d.etapa === 'escalado') {
  linhas.push('## ⚠️ Precisa de você', `O Roberto não aprovou em ${rodadas} rodadas. Pendências:`, '', d.pendencias || '');
} else {
  linhas.push('## ❌ A esteira não terminou', `Etapa: \`${d.etapa}\`.`, '', d.erro || 'Veja o log do workflow.', '', 'Para tentar de novo, adicione o label `refazer` nesta issue.');
}
linhas.push('', '_Nada foi publicado. A decisão de postar é sua._');
console.log(linhas.join('\n'));
