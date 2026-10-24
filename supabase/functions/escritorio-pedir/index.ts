// Pedidos ao Escritório de Agentes, feitos pelo painel (usuário logado no
// Supabase Auth; deploy com verify_jwt ligado).
//  - { acao: "criar", tema, descricao, objetivo?, publico?, cta?, observacoes? }
//    valida, aplica o limite diário (por pessoa e geral, em escritorio_config)
//    e grava a demanda. O trigger da tabela dispara o Tiago.
//  - { acao: "retomar", id } reabre uma demanda própria que parou com erro ou
//    ficou travada, e reenvia a etapa atual para a esteira.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

const URL_SUPABASE = Deno.env.get("SUPABASE_URL")!;
const servico = createClient(URL_SUPABASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function config(): Promise<Record<string, string>> {
  const { data, error } = await servico.from("escritorio_config").select("chave, valor");
  if (error) throw error;
  return Object.fromEntries(data.map((l) => [l.chave, l.valor]));
}

const LIMITES = { tema: [3, 200], descricao: [10, 4000], objetivo: [0, 300], publico: [0, 300], cta: [0, 300], observacoes: [0, 1500] } as const;

async function criar(userId: string, corpo: Record<string, unknown>) {
  const campos: Record<string, string | null> = {};
  for (const [campo, [min, max]] of Object.entries(LIMITES)) {
    const valor = String(corpo[campo] ?? "").trim();
    if (valor.length < min) return json({ erro: campo === "tema" ? "Informe o tema do post." : "Descreva o post com pelo menos 10 caracteres." }, 400);
    if (valor.length > max) return json({ erro: `O campo ${campo} passou de ${max} caracteres.` }, 400);
    campos[campo] = valor || null;
  }

  const cfg = await config();
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: daPessoa } = await servico.from("escritorio_demandas").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("criado_em", desde);
  if ((daPessoa ?? 0) >= Number(cfg.limite_usuario_dia)) {
    return json({ erro: `Você já fez ${cfg.limite_usuario_dia} pedidos nas últimas 24 horas. Volte amanhã.` }, 429);
  }
  const { count: geral } = await servico.from("escritorio_demandas").select("id", { count: "exact", head: true }).gte("criado_em", desde);
  if ((geral ?? 0) >= Number(cfg.limite_global_dia)) {
    return json({ erro: "O escritório atingiu o limite de pedidos de hoje. Tente amanhã." }, 429);
  }

  const { data, error } = await servico.from("escritorio_demandas").insert({ ...campos, user_id: userId }).select("id").single();
  if (error) return json({ erro: error.message }, 400);
  await servico.from("escritorio_eventos").insert({ demanda: data.id, tipo: "inicio", texto: "demanda chegou na mesa do Tiago" });
  return json({ id: data.id }, 201);
}

async function retomar(userId: string, id: string) {
  const { data: d } = await servico.from("escritorio_demandas").select("id, user_id, etapa, erro, passo_em, atualizado_em").eq("id", id).maybeSingle();
  if (!d || d.user_id !== userId) return json({ erro: "Demanda não encontrada." }, 404);
  if (!["escrita", "revisao", "arte"].includes(d.etapa)) return json({ erro: "Esta demanda já terminou." }, 409);
  const parada = Date.now() - new Date(d.passo_em ?? d.atualizado_em).getTime() > 3 * 60_000;
  if (!d.erro && !parada) return json({ erro: "A demanda ainda está em andamento." }, 409);

  const { error } = await servico.from("escritorio_demandas").update({ erro: null, passo_em: null, tentativas: 0 }).eq("id", id);
  if (error) return json({ erro: error.message }, 400);
  const cfg = await config();
  await fetch(cfg.url_esteira, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-escritorio-interno": cfg.segredo_interno },
    body: JSON.stringify({ id }),
  });
  await servico.from("escritorio_eventos").insert({ demanda: id, tipo: "inicio", texto: "esteira retomada" });
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servico.auth.getUser(token);
  if (!auth?.user) return json({ erro: "Entre na sua conta para pedir um post." }, 401);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  try {
    if (corpo.acao === "criar") return await criar(auth.user.id, corpo);
    if (corpo.acao === "retomar" && typeof corpo.id === "string") return await retomar(auth.user.id, corpo.id);
    return json({ erro: "ação desconhecida" }, 400);
  } catch (e) {
    console.error("escritorio-pedir:", e);
    return json({ erro: "Falha ao registrar o pedido. Tente de novo." }, 500);
  }
});
