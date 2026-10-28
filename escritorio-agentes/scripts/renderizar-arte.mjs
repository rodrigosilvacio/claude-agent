#!/usr/bin/env node
// Renderiza entregas/<id>/arte.html em arte.png (1080x1350) com Playwright
// e valida as regras da marca: logo presente e visível, nada transbordando e
// nenhum travessão no texto da arte.
// Uso: node scripts/renderizar-arte.mjs entregas/<id>

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acharTravessoes } from './post-lib.mjs';

const LARGURA = 1080;
const ALTURA = 1350;

const pasta = process.argv[2];
if (!pasta) {
  console.error('Uso: node scripts/renderizar-arte.mjs entregas/<id>');
  process.exit(2);
}
const html = resolve(pasta, 'arte.html');
if (!existsSync(html)) {
  console.error(`Não encontrei ${html}`);
  process.exit(1);
}

let chromium;
try {
  // createRequire respeita NODE_PATH, então funciona com o Playwright local ou global.
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright não encontrado. Rode "npm install" e "npx playwright install chromium" na pasta escritorio-agentes.');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: LARGURA, height: ALTURA } });
  await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const r = await page.evaluate(({ W, H }) => {
    const logos = [...document.querySelectorAll('img[data-logo]')];
    const logo = logos.map((img) => {
      const b = img.getBoundingClientRect();
      const st = getComputedStyle(img);
      return {
        carregado: img.complete && img.naturalWidth > 0,
        visivel: st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.5,
        dentro: b.left >= 0 && b.top >= 0 && b.right <= W && b.bottom <= H && b.width >= 200,
        largura: Math.round(b.width),
      };
    });
    const transbordando = [...document.body.querySelectorAll('*')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible' && el.textContent.trim())
      .map((el) => el.textContent.trim().slice(0, 40));
    return {
      logo,
      texto: document.body.innerText,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      transbordando,
    };
  }, { W: LARGURA, H: ALTURA });

  const erros = [];
  if (!r.logo.length) erros.push('Logo ausente: inclua <img data-logo src="../../assets/logo-rodrigo-silva.png">.');
  else if (!r.logo.some((l) => l.carregado)) erros.push('Logo não carregou: confira o caminho ../../assets/logo-rodrigo-silva.png.');
  else if (!r.logo.some((l) => l.carregado && l.visivel && l.dentro)) erros.push(`Logo fora da área visível, oculto ou pequeno demais (largura ${r.logo[0].largura}px, mínimo 200px).`);
  if (r.docW > LARGURA || r.docH > ALTURA) erros.push(`Conteúdo maior que ${LARGURA}x${ALTURA} (${r.docW}x${r.docH}).`);
  for (const t of r.transbordando) erros.push(`Texto transbordando: "${t}"`);
  for (const t of acharTravessoes(r.texto)) erros.push(`Travessão na arte: "${t.trecho}"`);

  if (erros.length) {
    for (const e of erros) console.log(`ERRO: ${e}`);
    process.exit(1);
  }

  const png = join(pasta, 'arte.png');
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: LARGURA, height: ALTURA } });
  console.log(`OK: ${png} gerado (${LARGURA}x${ALTURA}), logo validado (${r.logo[0].largura}px).`);
} finally {
  await browser.close();
}
