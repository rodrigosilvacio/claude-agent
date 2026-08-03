// Busca as 5 notícias mais relevantes sobre inteligência artificial do dia
// (priorizando sites brasileiros) via Firecrawl, e usa a API da Anthropic
// para selecionar, resumir em formato executivo e montar um post único
// pronto para o LinkedIn (limite rígido de 3000 caracteres). Sem histórico:
// cada chamada busca e gera tudo de novo, nada é salvo no banco.
// Requer as secrets FIRECRAWL_API_KEY e ANTHROPIC_API_KEY configuradas no
// projeto Supabase (`supabase secrets set FIRECRAWL_API_KEY=fc-...` e
// `ANTHROPIC_API_KEY=sk-ant-...`).
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Candidato {
  id: number;
  titulo: string;
  url: string;
  fonte: string;
  conteudo: string;
}

interface FirecrawlResult {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
}

async function firecrawlSearch(query: string, tbs?: string): Promise<FirecrawlResult[]> {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      limit: 10,
      lang: "pt",
      country: "br",
      ...(tbs ? { tbs } : {}),
      scrapeOptions: { formats: ["markdown"] },
    }),
  });

  if (!res.ok) {
    console.error("Firecrawl error:", res.status, await res.text());
    return [];
  }

  const data = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Notícias de hoje primeiro; se vier pouca coisa (dia fraco de publicações),
// completa com uma janela maior para garantir candidatos suficientes.
async function buscarCandidatos(): Promise<Candidato[]> {
  const query = "inteligência artificial notícias hoje Brasil";
  let resultados = await firecrawlSearch(query, "qdr:d");
  if (resultados.length < 6) {
    const extra = await firecrawlSearch(query, "qdr:w");
    const vistos = new Set(resultados.map((r) => r.url));
    for (const r of extra) {
      if (r.url && !vistos.has(r.url)) {
        resultados.push(r);
        vistos.add(r.url);
      }
    }
  }

  return resultados
    .filter((r) => r.url && (r.title || r.description))
    .slice(0, 12)
    .map((r, i) => ({
      id: i + 1,
      titulo: r.title ?? "",
      url: r.url!,
      fonte: hostnameOf(r.url!),
      // Corta o conteúdo por candidato pra manter o prompt enxuto — o
      // suficiente pro modelo entender do que se trata sem mandar o
      // artigo inteiro.
      conteudo: (r.markdown || r.description || "").slice(0, 2500),
    }));
}

interface Selecionada {
  id: number;
  titulo: string;
  resumo: string;
}

interface AgenteResposta {
  selecionadas: Selecionada[];
  post_final: string;
}

async function chamarAnthropic(body: Record<string, unknown>): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", response.status, errText);
    throw new Error("Falha ao chamar o modelo.");
  }

  const data = await response.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Resposta inesperada do modelo.");
  return text;
}

async function selecionarEResumir(candidatos: Candidato[], hojeExtenso: string): Promise<AgenteResposta> {
  const listaCandidatos = candidatos
    .map((c) => `[${c.id}] fonte: ${c.fonte}\ntítulo: ${c.titulo}\nurl: ${c.url}\nconteúdo: ${c.conteudo}`)
    .join("\n\n");

  const text = await chamarAnthropic({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system:
      `Você é um editor que curadoria notícias de inteligência artificial para um público executivo brasileiro. Hoje é ${hojeExtenso}. ` +
      "Você recebe uma lista de notícias candidatas (numeradas). Escolha exatamente 5, distintas entre si (não repita o mesmo fato coberto por veículos diferentes), " +
      "priorizando sempre fontes brasileiras (sites .com.br e veículos brasileiros conhecidos); só use fontes internacionais se não houver 5 boas opções brasileiras entre os candidatos. " +
      "Para cada uma: 'titulo' é uma manchete clara em português (pode reescrever a original para maior clareza, sem sensacionalismo); " +
      "'resumo' explica em 2 a 4 frases, em tom executivo (direto, sem jargão técnico desnecessário, focado no que aconteceu e por que importa para quem toma decisão de negócio). " +
      "Depois monte 'post_final': um único texto pronto para publicar no LinkedIn, em português, reunindo as 5 notícias. " +
      "Regras do post_final: tom executivo e profissional; comece com uma linha de abertura curta contextualizando o dia; " +
      "liste as 5 notícias numeradas, cada uma com título e resumo curto, separadas por linha em branco para leitura fácil no celular; " +
      "NÃO use markdown (sem **, #, - de lista) pois o LinkedIn não renderiza — use apenas texto simples, números e no máximo 1 emoji por item; " +
      "termine com até 3 hashtags relevantes (ex: #InteligenciaArtificial); " +
      "LIMITE RÍGIDO: o campo post_final inteiro (contando espaços, emojis e hashtags) não pode ultrapassar 3000 caracteres — conte com cuidado antes de responder.",
    messages: [
      { role: "user", content: `Notícias candidatas:\n\n${listaCandidatos}` },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            selecionadas: {
              type: "array",
              minItems: 5,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  titulo: { type: "string" },
                  resumo: { type: "string" },
                },
                required: ["id", "titulo", "resumo"],
                additionalProperties: false,
              },
            },
            post_final: { type: "string", maxLength: 3000 },
          },
          required: ["selecionadas", "post_final"],
          additionalProperties: false,
        },
      },
    },
  });

  return JSON.parse(text);
}

// Melhor esforço: se o modelo estourar o limite mesmo com a instrução,
// pede pra ele mesmo cortar preservando as 5 notícias antes de truncar
// no braço como último recurso.
async function encurtarSeNecessario(postFinal: string): Promise<string> {
  if (postFinal.length <= 3000) return postFinal;

  try {
    const encurtado = await chamarAnthropic({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      system:
        "Reduza o texto do usuário para no máximo 3000 caracteres no total, mantendo as 5 notícias, o tom executivo e sem markdown. " +
        "Não corte frases pela metade. Responda apenas com o texto final, sem comentários.",
      messages: [{ role: "user", content: postFinal }],
    });
    if (encurtado.trim().length <= 3000) return encurtado.trim();
  } catch (err) {
    console.error("Falha ao encurtar post_final:", err);
  }

  const corte = postFinal.slice(0, 2997);
  const ultimoEspaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, ultimoEspaco > 2900 ? ultimoEspaco : 2997)}…`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const candidatos = await buscarCandidatos();
    if (candidatos.length < 5) {
      return json(
        { error: "Não foi possível encontrar notícias de IA suficientes agora. Tente novamente em instantes." },
        502,
      );
    }

    const hojeExtenso = new Date().toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const agente = await selecionarEResumir(candidatos, hojeExtenso);
    if (!Array.isArray(agente.selecionadas) || agente.selecionadas.length !== 5) {
      return json({ error: "Falha ao selecionar as 5 notícias. Tente novamente." }, 502);
    }

    const porId = new Map(candidatos.map((c) => [c.id, c]));
    const noticias = agente.selecionadas.map((s) => {
      const candidato = porId.get(s.id);
      return {
        titulo: s.titulo,
        resumo: s.resumo,
        fonte: candidato?.fonte ?? "",
        url: candidato?.url ?? "",
      };
    });

    const postFinal = await encurtarSeNecessario(agente.post_final);

    return json({
      noticias,
      post_final: postFinal,
      post_final_length: postFinal.length,
      buscado_em: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Falha ao buscar e gerar as notícias. Tente novamente em instantes." }, 502);
  }
});
