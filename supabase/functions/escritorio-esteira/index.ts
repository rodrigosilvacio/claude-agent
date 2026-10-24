// Esteira do Escritório de Agentes na nuvem: executa UMA etapa de uma demanda
// (Tiago escreve, Roberto revisa ou Eloah cria a arte) e avança a demanda. Quem
// chama é o próprio banco (trigger/cron via pg_net, migration 0062), com o
// header x-escritorio-interno; a próxima etapa é disparada pelo trigger quando
// `etapa`/`rodada` mudam. Cada etapa cabe no teto de ~150s de uma invocação.
// Cada passo vira um evento em escritorio_eventos (painel ao vivo).
// Deploy com --no-verify-jwt (a autenticação é o segredo interno).
import Anthropic from "npm:@anthropic-ai/sdk@0.137.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { ELOAH, FORMATO_ELOAH, FORMATO_ROBERTO, FORMATO_TIAGO, ROBERTO, TIAGO } from "./prompts.ts";
import {
  type Bloqueante,
  type Checagem,
  checarPost,
  decidirVeredito,
  formatarMedia,
  montarPostFinal,
  normalizarHashtags,
  type Post,
  sanitizarArte,
  validarArte,
} from "./regras.ts";

// Global do runtime de edge functions do Supabase (background tasks).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// Timeout e uma só nova tentativa: a etapa inteira precisa caber em ~150s.
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 110_000, maxRetries: 1 });
const MODELO = "claude-opus-5-5";

type Agente = "tiago" | "roberto" | "eloah";
interface Demanda {
  id: string;
  tema: string;
  descricao: string;
  objetivo: string | null;
  publico: string | null;
  cta: string | null;
  observacoes: string | null;
  etapa: "escrita" | "revisao" | "arte";
  rodada: number;
  post_final: string | null;
  frase_arte: string | null;
}
interface Versao extends Post {
  n: number;
  notas_autor: string | null;
  checagem: Checagem;
  revisao: { bloqueantes: Bloqueante[]; sugestoes: { trecho: string; sugestao: string }[]; parecer: string } | null;
}

// ---------- utilidades ----------

let segredoCache: string | null = null;
async function segredoInterno(): Promise<string> {
  if (segredoCache) return segredoCache;
  const { data, error } = await supabase.from("escritorio_config").select("valor").eq("chave", "segredo_interno").single();
  if (error) throw error;
  return (segredoCache = data.valor as string);
}

function iguais(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function emitir(demanda: string, tipo: string, agente: Agente | null, texto: string) {
  const { error } = await supabase.from("escritorio_eventos").insert({ demanda, tipo, agente, texto: texto.slice(0, 200) });
  if (error) console.error("evento não gravado:", error.message);
}

async function atualizar(id: string, campos: Record<string, unknown>) {
  const { error } = await supabase.from("escritorio_demandas").update(campos).eq("id", id);
  if (error) throw error;
}

// Chamada ao Claude com saída estruturada. `fallbacks: "default"` reenvia no
// servidor um pedido recusado pelos classificadores de segurança para o modelo
// recomendado, em vez de devolver a recusa.
async function perguntar<T>(system: string, conteudo: string, formato: object, effort: "low" | "medium", maxTokens: number): Promise<T> {
  const resposta = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: conteudo }],
    output_config: { effort, format: { type: "json_schema", schema: formato } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // deno-lint-ignore no-explicit-any
  } as any);
  if (resposta.stop_reason === "refusal") throw new Error("O modelo recusou este pedido. Revise o briefing e tente de novo.");
  if (resposta.stop_reason === "max_tokens") throw new Error("A resposta do modelo veio cortada (limite de tokens).");
  const texto = resposta.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(texto) as T;
}

function briefing(d: Demanda): string {
  return [
    "<briefing>",
    `Tema: ${d.tema}`,
    `Descrição do post:\n${d.descricao}`,
    `Objetivo: ${d.objetivo || "não informado (decida o melhor)"}`,
    `Público: ${d.publico || "executivos, CIOs, CTOs e líderes de tecnologia"}`,
    `Chamada para ação: ${d.cta || "não informada (feche com reflexão ou pergunta)"}`,
    `Observações: ${d.observacoes || "nenhuma"}`,
    "</briefing>",
  ].join("\n");
}

function postEmTexto(v: Post): string {
  return `<post>\nTÍTULO: ${v.titulo}\n\nTEXTO:\n${v.texto}\n\nHASHTAGS: ${v.hashtags.join(" ")}\n\nFRASE PARA A ARTE: ${v.frase_arte}\n</post>`;
}

function parecerEmTexto(v: Versao): string {
  if (!v.revisao) return "";
  const b = v.revisao.bloqueantes.map((x, i) => `${i + 1}. Trecho: "${x.trecho}" | Problema: ${x.problema} | Correção: ${x.correcao}`).join("\n");
  const s = v.revisao.sugestoes.map((x, i) => `${i + 1}. Trecho: "${x.trecho}" | Sugestão: ${x.sugestao}`).join("\n");
  return `PARECER DO ROBERTO SOBRE A v${v.n}:\nBloqueantes:\n${b || "nenhum"}\nSugestões:\n${s || "nenhuma"}\nParecer: ${v.revisao.parecer}`;
}

async function versao(id: string, n: number): Promise<Versao | null> {
  const { data, error } = await supabase.from("escritorio_versoes").select("*").eq("demanda_id", id).eq("n", n).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, hashtags: String(data.hashtags).split(/\s+/).filter(Boolean) } as Versao;
}

// ---------- etapas ----------

async function escrever(d: Demanda) {
  const n = d.rodada;
  await emitir(d.id, "etapa", "tiago", n === 1 ? "Tiago escreve a v1" : `Tiago reescreve a v${n}`);
  await emitir(d.id, "acao", "tiago", "Tiago lê o briefing");
  let pedido = `${briefing(d)}\n\nEscreva a versão ${n} do post.`;
  if (n > 1) {
    const anterior = await versao(d.id, n - 1);
    if (!anterior) throw new Error(`Versão ${n - 1} não encontrada.`);
    await emitir(d.id, "acao", "tiago", `Tiago lê o parecer da v${n - 1}`);
    pedido += `\n\nVERSÃO ANTERIOR (v${n - 1}):\n${postEmTexto(anterior)}\n\n${parecerEmTexto(anterior)}`;
  }
  await emitir(d.id, "acao", "tiago", `Tiago escreve a v${n}`);
  const r = await perguntar<Post & { notas: string }>(TIAGO, pedido, FORMATO_TIAGO, "low", 8000);
  const post: Post = { titulo: r.titulo.trim(), texto: r.texto.trim(), hashtags: normalizarHashtags(r.hashtags), frase_arte: r.frase_arte.trim() };
  const checagem = checarPost(post);
  const { error } = await supabase.from("escritorio_versoes").upsert({
    demanda_id: d.id,
    n,
    titulo: post.titulo,
    texto: post.texto,
    hashtags: post.hashtags.join(" "),
    frase_arte: post.frase_arte,
    notas_autor: r.notas,
    checagem,
    revisao: null,
    media: null,
    aprovado: null,
  }, { onConflict: "demanda_id,n" });
  if (error) throw error;
  await emitir(d.id, "acao", "tiago", `Tiago entrega a v${n} para o Roberto`);
  await atualizar(d.id, { etapa: "revisao", passo_em: null, tentativas: 0 });
}

async function revisar(d: Demanda) {
  const n = d.rodada;
  const v = await versao(d.id, n);
  if (!v) throw new Error(`Versão ${n} não encontrada.`);
  await emitir(d.id, "etapa", "roberto", `Roberto revisa a v${n}`);
  await emitir(d.id, "acao", "roberto", "Roberto roda a checagem automática");
  await emitir(d.id, "acao", "roberto", v.checagem.erros.length ? `checagem: ${v.checagem.erros.length} erro(s) bloqueante(s)` : "checagem: nenhum erro automático");
  await emitir(d.id, "acao", "roberto", `Roberto lê a v${n} com lupa`);

  const auto = v.checagem.erros.length ? v.checagem.erros.map((e) => `- ERRO: ${e}`).join("\n") : "nenhum erro";
  const avisos = v.checagem.avisos.length ? v.checagem.avisos.map((a) => `- AVISO: ${a}`).join("\n") : "nenhum";
  let pedido = `${briefing(d)}\n\nVERSÃO ${n}:\n${postEmTexto(v)}\n\nCHECAGEM AUTOMÁTICA:\n${auto}\nAvisos:\n${avisos}`;
  if (n > 1) {
    const anterior = await versao(d.id, n - 1);
    if (anterior) pedido += `\n\n${parecerEmTexto(anterior)}`;
  }
  const r = await perguntar<{ notas: Record<string, number>; bloqueantes: Bloqueante[]; sugestoes: { trecho: string; sugestao: string }[]; parecer: string }>(
    ROBERTO, pedido, FORMATO_ROBERTO, "medium", 8000,
  );
  const veredito = decidirVeredito(r.notas, r.bloqueantes, v.checagem);
  const { error } = await supabase.from("escritorio_versoes").update({
    revisao: { notas: veredito.notas, bloqueantes: veredito.bloqueantes, sugestoes: r.sugestoes, parecer: r.parecer },
    media: veredito.media,
    aprovado: veredito.aprovado,
  }).eq("demanda_id", d.id).eq("n", n);
  if (error) throw error;
  await emitir(d.id, "acao", "roberto", `Roberto registra o parecer da v${n}`);
  await emitir(d.id, "veredito", "roberto", `Roberto ${veredito.aprovado ? "APROVOU" : "REPROVOU"} a v${n} (média ${formatarMedia(veredito.media)})`);

  if (veredito.aprovado) {
    await atualizar(d.id, { etapa: "arte", post_final: montarPostFinal(v), frase_arte: v.frase_arte, passo_em: null, tentativas: 0 });
  } else if (n < 3) {
    await atualizar(d.id, { etapa: "escrita", rodada: n + 1, passo_em: null, tentativas: 0 });
  } else {
    const pendencias = veredito.bloqueantes.map((b, i) => `${i + 1}. ${b.problema} (trecho: "${b.trecho}"). Sugestão: ${b.correcao}`).join("\n");
    await atualizar(d.id, {
      etapa: "escalado",
      passo_em: null,
      pendencias: `O Roberto não aprovou em 3 rodadas. Pendências da v3:\n${pendencias}\n\nRecomendação: ajuste esses pontos à mão ou abra uma nova demanda com o briefing mais específico.`,
    });
    await emitir(d.id, "fim", null, "Roberto não aprovou em 3 rodadas: precisa de você");
  }
}

async function desenhar(d: Demanda) {
  await emitir(d.id, "etapa", "eloah", "Eloah cria a arte");
  await emitir(d.id, "acao", "eloah", "Eloah lê o post aprovado");
  const base = `<post>\n${d.post_final}\n</post>\n\nFRASE PARA A ARTE: ${d.frase_arte}`;
  await emitir(d.id, "acao", "eloah", "Eloah desenha a arte");
  const inicio = Date.now();
  let r = await perguntar<{ html: string; descricao: string }>(ELOAH, base, FORMATO_ELOAH, "low", 12000);
  let html = sanitizarArte(r.html);
  let erros = validarArte(html);
  // Segunda tentativa só se ainda couber no teto de tempo da invocação.
  if (erros.length && Date.now() - inicio < 55_000) {
    await emitir(d.id, "acao", "eloah", "Eloah ajusta a arte");
    r = await perguntar(ELOAH, `${base}\n\nSua arte anterior foi reprovada pela validação:\n${erros.map((e) => `- ${e}`).join("\n")}\nEntregue a arte corrigida.`, FORMATO_ELOAH, "low", 12000);
    html = sanitizarArte(r.html);
    erros = validarArte(html);
  }
  if (erros.length) throw new Error(`A arte não passou na validação: ${erros.join(" ")}`);
  await emitir(d.id, "acao", "eloah", "Eloah valida o logo e o texto da arte");
  await atualizar(d.id, { etapa: "concluido", arte_html: html, passo_em: null, tentativas: 0 });
  await emitir(d.id, "fim", null, "post revisado e arte entregues");
}

// ---------- execução ----------

async function executar(id: string) {
  // Trava a etapa: só uma invocação por vez (a trava expira em 4 min, igual ao cron).
  const limite = new Date(Date.now() - 4 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("escritorio_demandas")
    .update({ passo_em: new Date().toISOString() })
    .eq("id", id)
    .in("etapa", ["escrita", "revisao", "arte"])
    .is("erro", null)
    .or(`passo_em.is.null,passo_em.lt.${limite}`)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) return;
  const d = data as Demanda;
  try {
    if (d.etapa === "escrita") await escrever(d);
    else if (d.etapa === "revisao") await revisar(d);
    else await desenhar(d);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`etapa ${d.etapa} da demanda ${d.id} falhou:`, msg);
    await atualizar(d.id, { erro: msg.slice(0, 500), passo_em: null });
    await emitir(d.id, "fim", null, "a esteira parou com erro");
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("use POST", { status: 405 });
  if (!iguais(req.headers.get("x-escritorio-interno") ?? "", await segredoInterno())) {
    return new Response("não autorizado", { status: 401 });
  }
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return new Response("id inválido", { status: 400 });
  // Responde na hora (o pg_net não espera) e trabalha em segundo plano.
  EdgeRuntime.waitUntil(executar(id).catch((e) => console.error("falha na esteira:", e)));
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { "Content-Type": "application/json" } });
});
