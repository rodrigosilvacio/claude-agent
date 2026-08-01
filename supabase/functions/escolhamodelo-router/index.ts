// Agente roteador: recebe uma pergunta do usuário e decide qual modelo da
// Anthropic deve respondê-la. Dois agentes em cadeia dentro da mesma
// function: o "classificador" (sempre claude-haiku-4-5, barato e rápido)
// avalia a complexidade/tipo da pergunta e escolhe o modelo; o modelo
// escolhido então responde de fato. Requer a secret ANTHROPIC_API_KEY
// (já configurada no projeto Supabase, compartilhada com generate-linkedin-post
// e as demais functions que chamam a Anthropic).
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

const MODELOS = ["haiku", "sonnet", "opus"] as const;
type ModeloChave = (typeof MODELOS)[number];

const MODELO_MAP: Record<ModeloChave, { id: string; label: string }> = {
  haiku: { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  sonnet: { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  opus: { id: "claude-opus-5", label: "Claude Opus 5" },
};

// Preços de referência em USD por milhão de tokens (entrada / saída).
// Servem para dar uma noção de grandeza do custo ao usuário, não são a
// fatura exata (não consideram promoções, desconto de cache, etc.).
const PRECOS_POR_MTOK: Record<string, { entrada: number; saida: number }> = {
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
  "claude-sonnet-5": { entrada: 3, saida: 15 },
  "claude-opus-5": { entrada: 5, saida: 25 },
};

const COTACAO_FALLBACK_USD_BRL = 5.5;

const CLASSIFICADOR_SYSTEM = `Você é um roteador que decide qual modelo Claude é mais adequado para responder a uma pergunta.

Modelos disponíveis:
- "haiku" (Claude Haiku 4.5): perguntas simples, diretas, factuais, de definição ou classificação, sem necessidade de raciocínio em múltiplas etapas. Ex: "Qual a capital do Japão?", "Traduza 'bom dia' para inglês."
- "sonnet" (Claude Sonnet 5): a maioria das perguntas de complexidade média — explicações conceituais, escrita, análise geral, código do dia a dia, perguntas abertas que pedem alguma elaboração mas não são extremamente complexas. Este é o padrão em caso de dúvida.
- "opus" (Claude Opus 5): perguntas que exigem raciocínio profundo e multi-etapas, codificação complexa/arquitetural, análise ambígua que exige muito cuidado, problemas matemáticos ou lógicos difíceis, tarefas de longo horizonte.

Critérios a avaliar:
1. Complexidade aparente da pergunta (simples / moderada / complexa).
2. Tipo da pergunta: factual_direta (fato único, resposta curta e objetiva), explicativa_geral (explicação/elaboração de complexidade média), analise_aberta (análise, comparação, opinião fundamentada, síntese), codificacao_complexa (código não-trivial, arquitetura, depuração difícil), raciocinio_multietapas (matemática/lógica com múltiplos passos dependentes).
3. Se exige raciocínio profundo/multi-etapas.

Responda APENAS com o JSON pedido. A justificativa deve ser curta (1-2 frases), em português, escrita para ser lida por um usuário leigo — explique o motivo da escolha de forma simples.`;

interface Classificacao {
  complexidade: "simples" | "moderada" | "complexa";
  tipo: string;
  precisa_raciocinio_profundo: boolean;
  modelo_escolhido: ModeloChave;
  justificativa: string;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

async function classificarPergunta(
  pergunta: string,
): Promise<{ classificacao: Classificacao; usage: AnthropicUsage } | null> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: CLASSIFICADOR_SYSTEM,
        messages: [{ role: "user", content: `Pergunta do usuário: "${pergunta}"` }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                complexidade: { type: "string", enum: ["simples", "moderada", "complexa"] },
                tipo: {
                  type: "string",
                  enum: [
                    "factual_direta",
                    "explicativa_geral",
                    "analise_aberta",
                    "codificacao_complexa",
                    "raciocinio_multietapas",
                  ],
                },
                precisa_raciocinio_profundo: { type: "boolean" },
                modelo_escolhido: { type: "string", enum: MODELOS },
                justificativa: { type: "string" },
              },
              required: [
                "complexidade",
                "tipo",
                "precisa_raciocinio_profundo",
                "modelo_escolhido",
                "justificativa",
              ],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      console.error("Anthropic API error (classificador):", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    if (!MODELOS.includes(parsed.modelo_escolhido)) return null;

    return { classificacao: parsed as Classificacao, usage: data.usage as AnthropicUsage };
  } catch (err) {
    console.error("Falha ao classificar pergunta:", err);
    return null;
  }
}

async function responderPergunta(
  modeloId: string,
  pergunta: string,
): Promise<{ resposta: string; usage: AnthropicUsage }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modeloId,
      max_tokens: 4096,
      messages: [{ role: "user", content: pergunta }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error (resposta):", response.status, errText);
    throw new Error("Falha ao gerar a resposta. Tente novamente em instantes.");
  }

  const data = await response.json();
  const resposta = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim();
  if (!resposta) {
    throw new Error("Resposta inesperada do modelo.");
  }

  return { resposta, usage: data.usage as AnthropicUsage };
}

async function buscarCotacaoUsdBrl(): Promise<{ valor: number; fonte: "tempo_real" | "fallback" }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const valor = Number(data?.USDBRL?.bid);
    if (!Number.isFinite(valor) || valor <= 0) throw new Error("cotação inválida");
    return { valor, fonte: "tempo_real" };
  } catch (err) {
    console.error("Falha ao buscar cotação USD-BRL, usando fallback:", err);
    return { valor: COTACAO_FALLBACK_USD_BRL, fonte: "fallback" };
  }
}

function calcularCustoUsd(modeloId: string, usage: AnthropicUsage): number {
  const precos = PRECOS_POR_MTOK[modeloId];
  if (!precos) return 0;
  return (
    (usage.input_tokens / 1_000_000) * precos.entrada +
    (usage.output_tokens / 1_000_000) * precos.saida
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let pergunta: string | undefined;
  try {
    ({ pergunta } = await req.json());
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  pergunta = pergunta?.trim();
  if (!pergunta) {
    return json({ error: "pergunta é obrigatória." }, 400);
  }
  if (pergunta.length > 2000) {
    return json({ error: "pergunta muito longa (máx. 2000 caracteres)." }, 400);
  }

  const classificacaoResultado = await classificarPergunta(pergunta);
  const modeloChave: ModeloChave = classificacaoResultado?.classificacao.modelo_escolhido ?? "sonnet";
  const modelo = MODELO_MAP[modeloChave];

  let resposta: string;
  let usageResposta: AnthropicUsage;
  try {
    ({ resposta, usage: usageResposta } = await responderPergunta(modelo.id, pergunta));
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message || "Falha ao processar a pergunta." }, 502);
  }

  const usageClassificador = classificacaoResultado?.usage ?? { input_tokens: 0, output_tokens: 0 };
  const tokensEntrada = usageClassificador.input_tokens + usageResposta.input_tokens;
  const tokensSaida = usageClassificador.output_tokens + usageResposta.output_tokens;

  const custoUsd =
    (classificacaoResultado ? calcularCustoUsd("claude-haiku-4-5", usageClassificador) : 0) +
    calcularCustoUsd(modelo.id, usageResposta);

  const { valor: cotacao, fonte: cotacaoFonte } = await buscarCotacaoUsdBrl();

  return json({
    resposta,
    modelo,
    classificacao: classificacaoResultado?.classificacao ?? null,
    custo: {
      tokens: {
        entrada: tokensEntrada,
        saida: tokensSaida,
        total: tokensEntrada + tokensSaida,
      },
      usd: custoUsd,
      brl: custoUsd * cotacao,
      cotacao_usd_brl: cotacao,
      cotacao_fonte: cotacaoFonte,
    },
  });
});
