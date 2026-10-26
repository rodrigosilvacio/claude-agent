// Processamento da base do Agente do Drive: cada invocação pega UM arquivo da
// fila da sincronização, baixa do Drive público, extrai o texto, divide em
// trechos, gera os embeddings (OpenAI text-embedding-3-small) e grava em
// drive_trechos. Depois chama a si mesma para o próximo arquivo, até a fila
// esvaziar. Um arquivo por invocação mantém cada uma dentro dos limites de
// CPU e tempo das edge functions.
//
// Quem chama é `drive-sincronizar` (e esta própria function), com o header
// x-drive-interno. Deploy com --no-verify-jwt (a autenticação é o segredo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { detectarFormato, dividir, extrair } from "./extracao.ts";

// Global do runtime de edge functions do Supabase (background tasks).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MODELO_EMBEDDING = "text-embedding-3-small";
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_TENTATIVAS = 3;

interface Documento {
  id: string;
  drive_id: string;
  nome: string;
  tipo_drive: "arquivo" | "doc" | "slides" | "planilha";
  status: "pendente" | "ok" | "erro" | "ignorado";
  hash: string | null;
  tentativas: number;
}

// ---------- utilidades ----------

let cfgCache: Record<string, string> | null = null;
async function config(): Promise<Record<string, string>> {
  if (cfgCache) return cfgCache;
  const { data, error } = await supabase.from("drive_config").select("chave, valor");
  if (error) throw error;
  return (cfgCache = Object.fromEntries(data.map((l) => [l.chave, l.valor])));
}

function iguais(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function urlDownload(doc: Documento): string {
  const id = encodeURIComponent(doc.drive_id);
  if (doc.tipo_drive === "doc") return `https://docs.google.com/document/d/${id}/export?format=docx`;
  if (doc.tipo_drive === "slides") return `https://docs.google.com/presentation/d/${id}/export/pptx`;
  if (doc.tipo_drive === "planilha") return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

async function baixar(doc: Documento): Promise<Uint8Array> {
  const resp = await fetch(urlDownload(doc), { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (drive-agente)" } });
  if (!resp.ok) throw new Error(`O download falhou (HTTP ${resp.status}). Confira se o arquivo está compartilhado como público.`);
  if ((resp.headers.get("content-type") ?? "").includes("text/html")) {
    await resp.body?.cancel();
    throw new Error("O Drive devolveu uma página em vez do arquivo. Confira se o arquivo está compartilhado como público.");
  }
  const tamanho = Number(resp.headers.get("content-length") ?? 0);
  if (tamanho > MAX_BYTES) {
    await resp.body?.cancel();
    throw new Error(`Arquivo grande demais (${Math.round(tamanho / 1048576)} MB). O limite é ${MAX_BYTES / 1048576} MB.`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`Arquivo grande demais. O limite é ${MAX_BYTES / 1048576} MB.`);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gerarEmbeddings(textos: string[]): Promise<number[][]> {
  const chave = Deno.env.get("OPENAI_API_KEY");
  if (!chave) throw new Error("Falta o secret OPENAI_API_KEY nas Edge Functions do Supabase.");
  const vetores: number[][] = [];
  for (let i = 0; i < textos.length; i += 96) {
    const lote = textos.slice(i, i + 96);
    for (let tentativa = 1; ; tentativa++) {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELO_EMBEDDING, input: lote }),
      });
      if (resp.ok) {
        const { data } = await resp.json() as { data: { index: number; embedding: number[] }[] };
        vetores.push(...data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
        break;
      }
      const corpo = await resp.text();
      // Falta de crédito também vem como 429, mas não adianta repetir.
      if ((resp.status === 429 || resp.status >= 500) && !corpo.includes("insufficient_quota") && tentativa < 3) {
        await espera(2000 * tentativa);
        continue;
      }
      throw new Error(`A OpenAI recusou os embeddings (HTTP ${resp.status}): ${corpo.slice(0, 200)}`);
    }
  }
  return vetores;
}

// ---------- processamento de um arquivo ----------

async function processar(doc: Documento) {
  const bytes = await baixar(doc);
  const hash = await sha256(bytes);
  // Arquivo igual só é pulado se já tiver todos os vetores; senão é refeito
  // para completar a busca semântica que ficou faltando.
  const { count: semVetor } = await supabase.from("drive_trechos")
    .select("id", { count: "exact", head: true })
    .eq("documento_id", doc.id)
    .is("embedding", null);
  if (doc.status === "ok" && doc.hash === hash && !semVetor) {
    await supabase.from("drive_documentos")
      .update({ fila_sinc: null, passo_em: null, resultado_sinc: "sem_alteracao", erro: null })
      .eq("id", doc.id);
    return;
  }

  const formato = detectarFormato(bytes);
  const trechos = dividir(await extrair(formato, bytes));
  if (!trechos.length) {
    throw new Error(formato === "pdf"
      ? "Não encontrei texto neste PDF. Se ele for escaneado (imagem), precisa de OCR antes."
      : "Não encontrei texto neste arquivo.");
  }

  const titulos = trechos.map((t) => `${doc.nome} · ${t.local}`);
  // Sem embeddings (OpenAI fora ou sem crédito), os trechos entram assim mesmo
  // e a busca segue só por palavras até a próxima atualização da base.
  let vetores: number[][] | null = null;
  let aviso: string | null = null;
  try {
    vetores = await gerarEmbeddings(trechos.map((t, i) => `${titulos[i]}\n${t.texto}`.slice(0, 20_000)));
  } catch (e) {
    aviso = `Busca por significado indisponível para este arquivo (só por palavras): ${e instanceof Error ? e.message : e}`.slice(0, 500);
    console.error(`embeddings de ${doc.nome} falharam:`, aviso);
  }

  // Grava os trechos novos e só então apaga os antigos: o arquivo continua
  // pesquisável durante a troca. Se algo falhar no meio, desfaz os novos.
  const { data: antigos, error: errAntigos } = await supabase.from("drive_trechos").select("id").eq("documento_id", doc.id);
  if (errAntigos) throw errAntigos;
  const novos: number[] = [];
  try {
    for (let i = 0; i < trechos.length; i += 200) {
      const { data, error } = await supabase.from("drive_trechos").insert(
        trechos.slice(i, i + 200).map((t, k) => ({
          documento_id: doc.id,
          ordem: i + k,
          local: t.local,
          titulo: titulos[i + k],
          conteudo: t.texto,
          embedding: vetores ? JSON.stringify(vetores[i + k]) : null,
          modelo_embedding: vetores ? MODELO_EMBEDDING : null,
        })),
      ).select("id");
      if (error) throw error;
      novos.push(...data.map((d) => d.id));
    }
  } catch (e) {
    for (let i = 0; i < novos.length; i += 500) await supabase.from("drive_trechos").delete().in("id", novos.slice(i, i + 500));
    throw e;
  }
  const idsAntigos = antigos.map((a) => a.id);
  for (let i = 0; i < idsAntigos.length; i += 500) {
    await supabase.from("drive_trechos").delete().in("id", idsAntigos.slice(i, i + 500));
  }

  const { error } = await supabase.from("drive_documentos").update({
    status: "ok",
    formato,
    hash,
    total_trechos: trechos.length,
    erro: aviso,
    fila_sinc: null,
    passo_em: null,
    resultado_sinc: doc.hash ? "alterado" : "novo",
    processado_em: new Date().toISOString(),
  }).eq("id", doc.id);
  if (error) throw error;
}

async function registrarErro(doc: Documento, mensagem: string) {
  // Arquivo que já estava na base continua pesquisável com a versão anterior;
  // o aviso fica visível para o admin.
  await supabase.from("drive_documentos").update({
    status: doc.status === "ok" ? "ok" : "erro",
    erro: doc.status === "ok" ? `A última atualização falhou: ${mensagem}`.slice(0, 500) : mensagem.slice(0, 500),
    fila_sinc: null,
    passo_em: null,
    resultado_sinc: "erro",
  }).eq("id", doc.id);
}

// ---------- cadeia ----------

async function seguir(sinc: string) {
  const cfg = await config();
  const resp = await fetch(cfg.url_processar, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-drive-interno": cfg.segredo_interno },
    body: JSON.stringify({ sinc }),
  });
  if (!resp.ok) console.error(`não consegui encadear o próximo arquivo: HTTP ${resp.status}`);
}

async function executar(sinc: string) {
  const { data, error } = await supabase.rpc("drive_proximo_documento", { p_sinc: sinc });
  if (error) throw error;
  const doc = (data as Documento[])[0];
  if (!doc) {
    // Fila vazia (ou o último arquivo está com outra invocação): fecha a contagem.
    await supabase.rpc("drive_registrar_progresso", { p_sinc: sinc });
    return;
  }
  try {
    if (doc.tentativas > MAX_TENTATIVAS) {
      throw new Error("O processamento deste arquivo foi interrompido várias vezes. Ele pode ser grande ou complexo demais; tente dividi-lo.");
    }
    await processar(doc);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`arquivo ${doc.nome} falhou:`, msg);
    await registrarErro(doc, msg);
  }
  const { data: prog } = await supabase.rpc("drive_registrar_progresso", { p_sinc: sinc });
  if ((prog as { status?: string } | null)?.status === "processando") await seguir(sinc);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("use POST", { status: 405 });
  const cfg = await config();
  if (!iguais(req.headers.get("x-drive-interno") ?? "", cfg.segredo_interno)) {
    return new Response("não autorizado", { status: 401 });
  }
  const { sinc } = await req.json().catch(() => ({}));
  if (typeof sinc !== "string" || !/^[0-9a-f-]{36}$/.test(sinc)) return new Response("sinc inválida", { status: 400 });
  // Responde na hora e trabalha em segundo plano.
  EdgeRuntime.waitUntil(executar(sinc).catch((e) => console.error("falha no processamento:", e)));
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { "Content-Type": "application/json" } });
});
