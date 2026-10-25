// Roteador da Edge Function ninanews-escritorio. Separado do Deno.serve para
// poder ser testado de ponta a ponta com fetch simulado.

import { type Ctx, ErroExterno, etapaEntrega, etapaLuana, etapaNina, etapaZaia } from "./agentes.ts";
import { EntradaInvalida, texto, validarNoticia, validarNoticias } from "./regras.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_CORPO = 20_000;

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function tratar(req: Request, ctx: Ctx | null): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ctx) return json({ error: "Serviço não configurado." }, 500);

  try {
    const bruto = await req.text();
    if (bruto.length > MAX_CORPO) throw new EntradaInvalida("Corpo da requisição grande demais.");
    let corpo: Record<string, unknown>;
    try {
      corpo = JSON.parse(bruto || "{}");
    } catch {
      throw new EntradaInvalida("JSON inválido.");
    }
    if (!corpo || typeof corpo !== "object") throw new EntradaInvalida("JSON inválido.");

    switch (corpo.etapa) {
      case "nina":
        return json({ etapa: "nina", ...(await etapaNina(ctx)), buscado_em: ctx.agora().toISOString() });
      case "luana": {
        const noticias = validarNoticias(corpo.noticias);
        return json({ etapa: "luana", ...(await etapaLuana(ctx, noticias)) });
      }
      case "zaia": {
        const noticia = validarNoticia(corpo.noticia);
        const motivo = corpo.motivo === undefined ? "" : texto(corpo.motivo, "motivo", 600);
        return json({ etapa: "zaia", ...(await etapaZaia(ctx, noticia, motivo)) });
      }
      case "entrega": {
        const r = etapaEntrega(ctx, texto(corpo.titulo, "titulo", 200), texto(corpo.post, "post", 3200));
        return json({ etapa: "entrega", ...r });
      }
      default:
        throw new EntradaInvalida('Campo "etapa" deve ser nina, luana, zaia ou entrega.');
    }
  } catch (err) {
    if (err instanceof EntradaInvalida) return json({ error: err.message }, err.message.startsWith("Post reprovado") ? 422 : 400);
    if (err instanceof ErroExterno) return json({ error: err.message }, 502);
    console.error(err);
    return json({ error: "Falha inesperada. Tente novamente em instantes." }, 502);
  }
}
