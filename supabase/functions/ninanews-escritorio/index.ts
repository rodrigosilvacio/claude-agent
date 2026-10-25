// Nina News (escritório): quatro agentes em etapas independentes.
//   POST {etapa:"nina"}                          -> 1 notícia por tema (IA, Dados, Vazamentos)
//   POST {etapa:"luana", noticias:[...]}         -> escolhe a mais relevante para CTO, CIO e CFO
//   POST {etapa:"zaia", noticia:{...}, motivo?}  -> revisa e formata para o LinkedIn, sem travessões
//   POST {etapa:"entrega", titulo, post}         -> conferência final e entrega
// Cada resposta traz uma "fala": o que o agente diz em voz alta para o próximo.
// Nada é salvo no banco. Requer as secrets FIRECRAWL_API_KEY e ANTHROPIC_API_KEY,
// as mesmas já usadas por `ninanews-buscar`.
import { tratar } from "./handler.ts";

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

Deno.serve((req: Request) =>
  tratar(
    req,
    anthropicKey && firecrawlKey ? { anthropicKey, firecrawlKey, fetch, agora: () => new Date() } : null,
  )
);
