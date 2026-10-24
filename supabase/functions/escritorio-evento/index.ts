// Recebe eventos ao vivo da esteira do Escritório de Agentes
// (escritorio-agentes/scripts/rodar-esteira.mjs) e grava em
// public.escritorio_eventos, que o painel pixel art assina via Realtime.
//
// Autenticação própria: header `x-escritorio-token` igual à secret
// ESCRITORIO_TOKEN (deploy com --no-verify-jwt). O token só permite inserir
// eventos validados nesta tabela; ninguém recebe a service role.
// Aceita um evento ou um lote ({ eventos: [...] }, até 50).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

const TOKEN = Deno.env.get("ESCRITORIO_TOKEN") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const TIPOS = new Set(["inicio", "etapa", "acao", "veredito", "fim"]);
const AGENTES = new Set(["tiago", "roberto", "eloah"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Comparação em tempo constante para não vazar o token por timing.
function tokenValido(recebido: string): boolean {
  if (!TOKEN || recebido.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= TOKEN.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diff === 0;
}

interface Evento {
  demanda: string;
  issue: number | null;
  tipo: string;
  agente: string | null;
  texto: string;
}

function validar(e: Record<string, unknown>): Evento | string {
  const demanda = String(e.demanda ?? "");
  const texto = String(e.texto ?? "").trim();
  const tipo = String(e.tipo ?? "");
  const agente = e.agente == null ? null : String(e.agente);
  const issue = e.issue == null ? null : Number(e.issue);
  if (!/^[a-z0-9-]{1,120}$/.test(demanda)) return "demanda inválida";
  if (!TIPOS.has(tipo)) return "tipo inválido";
  if (agente !== null && !AGENTES.has(agente)) return "agente inválido";
  if (issue !== null && !Number.isInteger(issue)) return "issue inválida";
  if (!texto) return "texto vazio";
  return { demanda, issue, tipo, agente, texto: texto.slice(0, 200) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  if (!tokenValido(req.headers.get("x-escritorio-token") ?? "")) return json({ erro: "não autorizado" }, 401);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  const brutos = Array.isArray(corpo.eventos) ? corpo.eventos : [corpo];
  if (!brutos.length || brutos.length > 50) return json({ erro: "envie de 1 a 50 eventos" }, 400);

  const eventos: Evento[] = [];
  for (const b of brutos) {
    const v = validar(b as Record<string, unknown>);
    if (typeof v === "string") return json({ erro: v }, 400);
    eventos.push(v);
  }

  const { error } = await supabase.from("escritorio_eventos").insert(eventos);
  if (error) return json({ erro: error.message }, 500);
  return json({ ok: true, gravados: eventos.length });
});
