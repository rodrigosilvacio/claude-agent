// Versão exata pinada (mesmo motivo de manage-usuarios/index.ts): uma
// release nova do supabase-js não deve entrar em produção sem passar por
// um commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// Agente Theo: recebe mensagens de WhatsApp via webhook do Z-API e responde
// perguntas sobre o catálogo/tabela de preços da empresa. Fluxo de resposta:
//
//   1. Consulta a planilha oficial (Google Sheets, ao vivo) via a ferramenta
//      `buscar_produto` — é a fonte de verdade, sempre preferida.
//   2. Se a planilha não tiver a resposta (ou a pergunta não for sobre o
//      catálogo), cai para busca na web (ferramenta nativa `web_search` da
//      Anthropic) como alternativa.
//   3. Se o usuário pedir um CEP, usa `consultar_cep`, que chama o servidor
//      MCP `mcp-cep` já existente neste repositório via JSON-RPC.
//
// Histórico de conversa persistido por telefone (tabelas `theo_conversas`/
// `theo_mensagens`, migration 0025) — mesmo padrão do `oraculo-webhook`.
//
// Endpoint público (deploy com --no-verify-jwt, quem chama é o Z-API, não
// um cliente Supabase autenticado — mesmo racional de `oraculo-webhook`).
// Segurança feita por um secret próprio na query string (?secret=...),
// configurado como parte da URL do webhook no painel do Z-API — ver README.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID")!;
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN")!;
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN")!;
const THEO_WEBHOOK_SECRET = Deno.env.get("THEO_WEBHOOK_SECRET")!;
const GOOGLE_SHEETS_CLIENT_EMAIL = Deno.env.get("GOOGLE_SHEETS_CLIENT_EMAIL")!;
const GOOGLE_SHEETS_PRIVATE_KEY = Deno.env.get("GOOGLE_SHEETS_PRIVATE_KEY")!;
const GOOGLE_SHEETS_SPREADSHEET_ID = Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID")!;
const GOOGLE_SHEETS_RANGE = Deno.env.get("GOOGLE_SHEETS_RANGE")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Quantas mensagens do histórico entram no contexto enviado à Anthropic.
const HISTORICO_LIMITE = 20;
// Rate limit por conversa (o webhook está aberto a qualquer número que
// mandar mensagem, mesma decisão do Oráculo — é o que contém custo/abuso).
const RATE_LIMIT_JANELA_MINUTOS = 15;
const RATE_LIMIT_MAX_MENSAGENS = 20;
// Quantas idas e voltas de ferramenta tolerar antes de desistir e responder
// com o que tiver (evita loop infinito se o modelo insistir em chamar
// ferramentas sem nunca concluir).
const MAX_ITERACOES_FERRAMENTA = 5;

const SYSTEM_PROMPT =
  "Você é o Theo, um assistente de WhatsApp que responde perguntas sobre o catálogo de " +
  "produtos e preços da empresa, em português do Brasil. Tom coloquial e simpático, como " +
  "numa conversa de WhatsApp de verdade — nada de linguagem formal ou robótica. Respostas " +
  "curtas e diretas, pensadas para leitura no celular (evite parágrafos longos). " +
  "Quando o usuário cumprimentar ou perguntar quem você é, apresente-se de forma simples, " +
  "no estilo: \"Oi! Sou o Theo 🙂 Posso te ajudar a encontrar produtos e preços do nosso " +
  "catálogo, consultar um CEP ou buscar alguma informação na internet quando não tiver na " +
  "planilha. Manda sua pergunta!\" — adapte as palavras ao contexto, não repita sempre a " +
  "mesma frase decorada. " +
  "Para perguntas sobre produtos, preços, categorias ou disponibilidade, SEMPRE use a " +
  "ferramenta buscar_produto primeiro — a planilha é a fonte oficial e deve ser preferida. " +
  "Só recorra à busca na web (web_search) quando a planilha não tiver a informação ou a " +
  "pergunta não for sobre o catálogo — e, nesse caso, deixe claro que a resposta veio da " +
  "internet, não da planilha oficial. Se o usuário pedir um CEP ou informações de endereço, " +
  "use a ferramenta consultar_cep. Se não encontrar a resposta em nenhuma fonte, diga isso " +
  "claramente em vez de inventar.";

const TOOLS = [
  {
    name: "buscar_produto",
    description:
      "Busca produtos, preços e disponibilidade na planilha oficial de catálogo (Google " +
      "Sheets, consultada ao vivo). Use um termo (nome do produto, categoria ou parte dele) " +
      "para filtrar; deixe vazio para listar os primeiros itens da planilha.",
    input_schema: {
      type: "object",
      properties: {
        termo: {
          type: "string",
          description: "Termo de busca (nome do produto, categoria, etc). Opcional.",
        },
      },
    },
  },
  {
    name: "consultar_cep",
    description:
      "Consulta um CEP brasileiro (8 dígitos) e retorna o endereço correspondente " +
      "(logradouro, bairro, cidade, UF) via o servidor MCP de CEP deste projeto.",
    input_schema: {
      type: "object",
      properties: {
        cep: {
          type: "string",
          description: "CEP com 8 dígitos, com ou sem formatação (ex: \"01001000\" ou \"01001-000\").",
        },
      },
      required: ["cep"],
    },
  },
  { type: "web_search_20260209", name: "web_search" },
];

function normalizarTelefone(input: unknown): string {
  return String(input ?? "").replace(/\D/g, "");
}

async function enviarMensagemZapi(phone: string, message: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Client-Token": ZAPI_CLIENT_TOKEN,
        },
        body: JSON.stringify({ phone, message }),
      },
    );
    if (!res.ok) {
      console.error("Z-API send-text error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Falha ao chamar Z-API send-text:", err);
  }
}

// --- Google Sheets (planilha ao vivo, via service account) ---------------

let cachedGoogleToken: string | null = null;
let cachedGoogleTokenExpiraEm = 0;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(input: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(input));
}

async function importGooglePrivateKey(pem: string): Promise<CryptoKey> {
  const pemNormalizado = pem.replace(/\\n/g, "\n");
  const corpo = pemNormalizado
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binario = atob(corpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return await crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// Autenticação server-to-server com uma conta de serviço do Google (JWT
// assinado com a chave privada, trocado por um access token OAuth2) — sem
// isso não dá para ler uma planilha privada via API sem um usuário logado.
async function obterGoogleAccessToken(): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && agora < cachedGoogleTokenExpiraEm - 60) {
    return cachedGoogleToken;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: GOOGLE_SHEETS_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  };
  const naoAssinado = `${base64UrlEncodeString(JSON.stringify(header))}.${
    base64UrlEncodeString(JSON.stringify(claims))
  }`;
  const chave = await importGooglePrivateKey(GOOGLE_SHEETS_PRIVATE_KEY);
  const assinatura = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    chave,
    new TextEncoder().encode(naoAssinado),
  );
  const jwt = `${naoAssinado}.${base64UrlEncodeBytes(new Uint8Array(assinatura))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao autenticar no Google (status ${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  cachedGoogleToken = data.access_token;
  cachedGoogleTokenExpiraEm = agora + (data.expires_in ?? 3600);
  return cachedGoogleToken!;
}

// Cache curto das linhas da planilha para não bater no Sheets API a cada
// mensagem — 60s é suficiente para absorver uma rajada de perguntas na
// mesma conversa sem servir dados velhos por muito tempo.
let cachedLinhas: Record<string, string>[] | null = null;
let cachedLinhasExpiraEm = 0;
const CACHE_PLANILHA_SEGUNDOS = 60;

async function obterLinhasPlanilha(): Promise<Record<string, string>[]> {
  const agora = Math.floor(Date.now() / 1000);
  if (cachedLinhas && agora < cachedLinhasExpiraEm) return cachedLinhas;

  const accessToken = await obterGoogleAccessToken();
  const range = encodeURIComponent(GOOGLE_SHEETS_RANGE);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_SPREADSHEET_ID}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(
      `Falha ao ler a planilha do Google Sheets (status ${res.status}): ${await res.text()}`,
    );
  }
  const data = await res.json();
  const valores: string[][] = data.values ?? [];
  if (valores.length === 0) {
    cachedLinhas = [];
    cachedLinhasExpiraEm = agora + CACHE_PLANILHA_SEGUNDOS;
    return cachedLinhas;
  }
  const [cabecalho, ...linhas] = valores;
  cachedLinhas = linhas.map((linha) => {
    const obj: Record<string, string> = {};
    cabecalho.forEach((coluna, i) => {
      obj[coluna || `coluna_${i + 1}`] = linha[i] ?? "";
    });
    return obj;
  });
  cachedLinhasExpiraEm = agora + CACHE_PLANILHA_SEGUNDOS;
  return cachedLinhas;
}

function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const MAX_RESULTADOS_BUSCA = 25;

async function buscarProduto(termoInput: unknown): Promise<string> {
  const linhas = await obterLinhasPlanilha();
  if (linhas.length === 0) {
    return "A planilha está vazia ou não retornou nenhuma linha.";
  }

  const termo = typeof termoInput === "string" ? termoInput.trim() : "";
  let resultado = linhas;
  if (termo) {
    const termoNormalizado = normalizarTexto(termo);
    resultado = linhas.filter((linha) =>
      Object.values(linha).some((valor) => normalizarTexto(String(valor)).includes(termoNormalizado))
    );
  }

  if (resultado.length === 0) {
    return `Nenhum produto encontrado na planilha para "${termo}".`;
  }

  const total = resultado.length;
  const limitado = resultado.slice(0, MAX_RESULTADOS_BUSCA);
  const aviso = total > MAX_RESULTADOS_BUSCA
    ? `\n(mostrando ${MAX_RESULTADOS_BUSCA} de ${total} resultados — peça para refinar a busca se precisar de mais)`
    : "";
  return JSON.stringify(limitado, null, 2) + aviso;
}

// --- CEP, via o servidor MCP mcp-cep já existente no projeto --------------

async function consultarCepViaMcp(cepInput: unknown): Promise<{ texto: string; isError: boolean }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mcp-cep`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "consultar_cep", arguments: { cep: cepInput } },
      }),
    });
    if (!res.ok) {
      return { texto: `Falha ao chamar o serviço de CEP (status ${res.status}).`, isError: true };
    }
    const data = await res.json();
    const texto = data?.result?.content?.[0]?.text ?? "Erro ao consultar CEP.";
    return { texto, isError: Boolean(data?.result?.isError) };
  } catch (err) {
    return { texto: err instanceof Error ? err.message : String(err), isError: true };
  }
}

// --- Loop de ferramentas com a Anthropic ----------------------------------

async function gerarResposta(
  mensagens: { role: string; content: unknown }[],
  // deno-lint-ignore no-explicit-any
  supabaseDebug: any,
  conversaIdDebug: string,
): Promise<string> {
  let historico = mensagens;

  for (let iteracao = 0; iteracao < MAX_ITERACOES_FERRAMENTA; iteracao++) {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: historico,
      }),
    });
    if (!anthropicRes.ok) {
      const corpoErro = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, corpoErro);
      throw new Error(`anthropic-error: ${anthropicRes.status} ${corpoErro}`);
    }
    const data = await anthropicRes.json();

    if (data.stop_reason === "pause_turn") {
      // Loop de ferramenta server-side (web_search) bateu no limite interno
      // da Anthropic — reenviar o turno faz o servidor continuar de onde
      // parou, sem precisar de uma mensagem extra do usuário.
      historico = [...historico, { role: "assistant", content: data.content }];
      continue;
    }

    const blocosFerramenta = (data.content ?? []).filter(
      (b: { type: string }) => b.type === "tool_use",
    );
    if (data.stop_reason !== "tool_use" || blocosFerramenta.length === 0) {
      const texto = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim();
      return texto || "Não consegui gerar uma resposta agora. Pode perguntar de novo?";
    }

    historico = [...historico, { role: "assistant", content: data.content }];

    const resultados = [];
    for (const bloco of blocosFerramenta as { id: string; name: string; input: unknown }[]) {
      let conteudo: string;
      let isError = false;
      try {
        if (bloco.name === "buscar_produto") {
          conteudo = await buscarProduto((bloco.input as { termo?: string })?.termo);
        } else if (bloco.name === "consultar_cep") {
          const resultado = await consultarCepViaMcp((bloco.input as { cep?: string })?.cep);
          conteudo = resultado.texto;
          isError = resultado.isError;
        } else {
          conteudo = `Ferramenta desconhecida: "${bloco.name}".`;
          isError = true;
        }
      } catch (err) {
        conteudo = err instanceof Error ? err.message : String(err);
        isError = true;
        // DEBUG TEMPORÁRIO: grava o erro da ferramenta no histórico para
        // diagnosticar sem depender de acesso à rede externa nesta sessão —
        // remover depois.
        await supabaseDebug.from("theo_mensagens").insert({
          conversa_id: conversaIdDebug,
          role: "assistant",
          conteudo: `[DEBUG ${bloco.name}] ${conteudo}`,
        });
      }
      resultados.push({
        type: "tool_result",
        tool_use_id: bloco.id,
        content: conteudo,
        is_error: isError,
      });
    }
    historico = [...historico, { role: "user", content: resultados }];
  }

  return "Precisei de mais passos do que consigo dar de uma vez para responder isso. Pode tentar reformular a pergunta?";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== THEO_WEBHOOK_SECRET) {
    return json({ error: "Não autorizado." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  // Eco do próprio bot ou mensagem de grupo: fora de escopo no MVP.
  if (payload.fromMe === true || payload.isGroup === true) {
    return json({ ignored: true });
  }

  const telefone = normalizarTelefone(payload.phone);
  if (!telefone) {
    return json({ ignored: true });
  }

  const textoRecebido = (payload.text as { message?: string } | undefined)?.message?.trim();
  const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
  const senderName = typeof payload.senderName === "string" ? payload.senderName.trim() : null;

  if (!textoRecebido) {
    await enviarMensagemZapi(
      telefone,
      "Por enquanto eu só entendo mensagens de texto — me conta em palavras o que você está procurando 🙂",
    );
    return json({ ignored: true, reason: "unsupported-media" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Get-or-create da conversa pelo telefone.
  let conversaId: string;
  const { data: conversaExistente, error: selectConversaErr } = await supabase
    .from("theo_conversas")
    .select("id, nome")
    .eq("telefone", telefone)
    .maybeSingle();
  if (selectConversaErr) {
    console.error("Erro ao buscar conversa:", selectConversaErr);
    return json({ error: "Erro interno." }, 500);
  }

  if (conversaExistente) {
    conversaId = conversaExistente.id;
    if (!conversaExistente.nome && senderName) {
      await supabase.from("theo_conversas").update({ nome: senderName }).eq("id", conversaId);
    }
  } else {
    const { data: novaConversa, error: insertConversaErr } = await supabase
      .from("theo_conversas")
      .insert({ telefone, nome: senderName })
      .select("id")
      .single();
    if (insertConversaErr || !novaConversa) {
      console.error("Erro ao criar conversa:", insertConversaErr);
      return json({ error: "Erro interno." }, 500);
    }
    conversaId = novaConversa.id;
  }

  // Idempotência: se o Z-API reentregar a mesma mensagem (retry), o unique
  // index em zapi_message_id barra o insert e não reprocessamos.
  const { error: insertMsgErr } = await supabase.from("theo_mensagens").insert({
    conversa_id: conversaId,
    role: "user",
    conteudo: textoRecebido,
    zapi_message_id: messageId,
  });
  if (insertMsgErr) {
    if (insertMsgErr.code === "23505") {
      return json({ ok: true, deduped: true });
    }
    console.error("Erro ao salvar mensagem do usuário:", insertMsgErr);
    return json({ error: "Erro interno." }, 500);
  }

  const desde = new Date(Date.now() - RATE_LIMIT_JANELA_MINUTOS * 60_000).toISOString();
  const { count: mensagensRecentes, error: countErr } = await supabase
    .from("theo_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", conversaId)
    .eq("role", "user")
    .gte("criado_em", desde);
  if (countErr) {
    console.error("Erro ao contar mensagens para rate limit:", countErr);
  } else if ((mensagensRecentes ?? 0) > RATE_LIMIT_MAX_MENSAGENS) {
    await enviarMensagemZapi(
      telefone,
      "Recebi muitas mensagens suas nos últimos minutos, me dá um tempinho antes de mandar mais 🙏",
    );
    return json({ ok: true, rateLimited: true });
  }

  const { data: historicoDb, error: histErr } = await supabase
    .from("theo_mensagens")
    .select("role, conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(HISTORICO_LIMITE);
  if (histErr) {
    console.error("Erro ao buscar histórico:", histErr);
    return json({ error: "Erro interno." }, 500);
  }
  const mensagens = (historicoDb ?? [])
    .reverse()
    .map((m: { role: string; conteudo: string }) => ({ role: m.role, content: m.conteudo }));

  let resposta: string;
  try {
    resposta = await gerarResposta(mensagens, supabase, conversaId);
  } catch (err) {
    console.error("Falha ao gerar resposta do Theo:", err);
    // DEBUG TEMPORÁRIO: grava o detalhe do erro no histórico para diagnosticar
    // sem depender de acesso à rede externa nesta sessão — remover depois.
    await supabase.from("theo_mensagens").insert({
      conversa_id: conversaId,
      role: "assistant",
      conteudo: `[DEBUG] ${err instanceof Error ? err.message : String(err)}`,
    });
    await enviarMensagemZapi(telefone, "Tive um problema para responder agora. Tenta de novo daqui a pouco?");
    return json({ error: "Falha ao gerar resposta." }, 502);
  }

  const { error: insertRespostaErr } = await supabase.from("theo_mensagens").insert({
    conversa_id: conversaId,
    role: "assistant",
    conteudo: resposta,
  });
  if (insertRespostaErr) {
    console.error("Erro ao salvar resposta do assistente:", insertRespostaErr);
  }
  await supabase
    .from("theo_conversas")
    .update({ atualizado_em: new Date().toISOString() })
    .eq("id", conversaId);

  await enviarMensagemZapi(telefone, resposta);

  return json({ ok: true });
});
