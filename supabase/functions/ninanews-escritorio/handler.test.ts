import assert from "node:assert/strict";
import { test } from "node:test";
import { tratar } from "./handler.ts";
import type { Ctx } from "./agentes.ts";
import { acharTravessoes, checarPost } from "./regras.ts";

type Rota = (url: string, body: any) => Response | Promise<Response>;

function ctxCom(rota: Rota): Ctx {
  return {
    anthropicKey: "k",
    firecrawlKey: "f",
    agora: () => new Date("2026-10-25T12:00:00Z"),
    fetch: (async (url: any, init: any) => rota(String(url), init?.body ? JSON.parse(init.body) : {})) as typeof fetch,
  };
}
const ok = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
const msg = (o: unknown) => ok({ content: [{ type: "text", text: JSON.stringify(o) }] });
const post = (corpo: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(corpo) });

const firecrawl = (tema: string) =>
  ok({ data: [1, 2, 3].map((i) => ({ title: `${tema} ${i}`, url: `https://site${i}.com.br/${tema}`, description: `desc ${tema} ${i}` })) });

test("nina: uma notícia por tema, ids inválidos caem no primeiro candidato", async () => {
  const ctx = ctxCom((url, body) => {
    if (url.includes("firecrawl")) return firecrawl(body.query.slice(0, 6));
    return msg({
      escolhidas: [{ tema: "ia", id: 2, titulo: "IA — manchete", resumo: "Resumo — IA" }, { tema: "dados", id: 999, titulo: "x", resumo: "y" }],
      fala: "Luana — trouxe as pautas",
    });
  });
  const r = await tratar(post({ etapa: "nina" }), ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.noticias.length, 3);
  assert.deepEqual(j.noticias.map((n: any) => n.tema), ["ia", "dados", "vazamentos"]);
  for (const n of j.noticias) assert.equal(acharTravessoes(n.titulo + n.resumo).length, 0);
  assert.equal(acharTravessoes(j.fala).length, 0);
});

test("nina: sem resultados vira 502", async () => {
  const r = await tratar(post({ etapa: "nina" }), ctxCom(() => ok({ data: [] })));
  assert.equal(r.status, 502);
});

const NOT = { tema: "ia", titulo: "T", resumo: "R", fonte: "g1.com", url: "https://g1.com/a" };

test("luana: valida índice", async () => {
  const bom = await tratar(post({ etapa: "luana", noticias: [NOT, { ...NOT, tema: "dados" }] }), ctxCom(() => msg({ indice: 1, motivo: "m", fala: "f" })));
  assert.equal((await bom.json()).indice, 1);
  const ruim = await tratar(post({ etapa: "luana", noticias: [NOT, { ...NOT, tema: "dados" }] }), ctxCom(() => msg({ indice: 7, motivo: "m", fala: "f" })));
  assert.equal(ruim.status, 502);
});

test("zaia: corrige travessão no código quando o modelo insiste", async () => {
  let chamadas = 0;
  const ctx = ctxCom(() => {
    chamadas++;
    return msg({ titulo: "Título — forte", texto: "Corpo — com travessão.\n\nFonte: g1.com", hashtags: ["#IA", "CIO"], fala: "Pronto" });
  });
  const r = await tratar(post({ etapa: "zaia", noticia: NOT, motivo: "m" }), ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(chamadas, 2);
  assert.equal(j.revisoes, 2);
  assert.equal(checarPost({ titulo: j.titulo, texto: j.post.split("\n\n").slice(1, -1).join("\n\n"), hashtags: ["#IA", "#CIO"] }).erros.filter((e) => /travess/i.test(e)).length, 0);
  assert.equal(acharTravessoes(j.post).length, 0);
});

test("entrega: reprova travessão e aceita post limpo", async () => {
  const ctx = ctxCom(() => ok({}));
  const ruim = await tratar(post({ etapa: "entrega", titulo: "T", post: "T\n\ncorpo — x" }), ctx);
  assert.equal(ruim.status, 422);
  const bom = await tratar(post({ etapa: "entrega", titulo: "T", post: "T\n\ncorpo, x\n\n#IA #CIO" }), ctx);
  assert.equal(bom.status, 200);
});

test("entradas inválidas e método", async () => {
  const ctx = ctxCom(() => ok({}));
  assert.equal((await tratar(post({ etapa: "xyz" }), ctx)).status, 400);
  assert.equal((await tratar(new Request("http://x", { method: "POST", body: "{{" }), ctx)).status, 400);
  assert.equal((await tratar(post({ etapa: "luana", noticias: [] }), ctx)).status, 400);
  assert.equal((await tratar(post({ etapa: "luana", noticias: [{ ...NOT, url: "javascript:alert(1)" }] }), ctx)).status, 400);
  assert.equal((await tratar(new Request("http://x", { method: "GET" }), ctx)).status, 405);
  assert.equal((await tratar(post({ etapa: "nina" }), null)).status, 500);
  assert.equal((await tratar(new Request("http://x", { method: "POST", body: "x".repeat(30000) }), ctx)).status, 400);
});
