// Cowork — agente gerador de documentos. Recebe um pedido em linguagem natural
// (+ instruções do projeto + anexos de referência) e devolve uma estrutura
// (spec) pronta para virar um arquivo Office de verdade no client (xlsx/docx/pptx
// são montados no browser com exceljs/docx/pptxgenjs — esta function só decide
// o conteúdo). Requer a secret ANTHROPIC_API_KEY já configurada no projeto
// Supabase (mesma usada por generate-linkedin-post).
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

type DocType = "spreadsheet" | "document" | "presentation";

const DOC_TYPES: DocType[] = ["spreadsheet", "document", "presentation"];

const ALLOWED_NATIVE_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_PROMPT_LENGTH = 4000;
const MAX_INSTRUCTIONS_LENGTH = 4000;
const MAX_FEEDBACK_LENGTH = 1000;
const MAX_TEXT_EXCERPTS = 5;
const MAX_TEXT_EXCERPT_LENGTH = 20000;
const MAX_NATIVE_DOCS = 5;
const MAX_NATIVE_DOC_BASE64_LENGTH = 12_000_000; // ~9MB binário

const QUALITY_RULES =
  "Regras de qualidade: gere conteúdo real e completo, nunca placeholders como " +
  '"[insira aqui]" ou "TODO"; use os dados e o contexto fornecidos pelo usuário e ' +
  "pelos anexos de referência sempre que existirem; mantenha hierarquia e nomenclatura " +
  "consistentes; escreva em português do Brasil, a menos que o pedido do usuário peça " +
  "outro idioma; prefira densidade de conteúdo alta (não deixe seções ou planilhas vazias " +
  "ou rasas quando o pedido claramente exige mais detalhe).";

const SYSTEM_PROMPTS: Record<DocType, string> = {
  spreadsheet:
    "Você é um especialista em montar planilhas Excel profissionais. " +
    "Você DEVE responder chamando a tool build_spreadsheet com a estrutura completa da planilha " +
    "(uma ou mais abas). Use cabeçalhos claros, tipos de dado corretos nas células (número onde é " +
    "número, não texto), e inclua fórmulas de total/subtotal como texto explicativo em `notes` quando " +
    "fizer sentido (a planilha final não calcula fórmulas, só valores — se precisar de totais, calcule " +
    "o valor você mesmo e coloque na linha). " +
    QUALITY_RULES,
  document:
    "Você é um especialista em redigir documentos profissionais (relatórios, propostas, contratos, " +
    "memorandos etc.), no padrão de um documento Word bem formatado. " +
    "Você DEVE responder chamando a tool build_document com a estrutura completa do documento, usando " +
    "títulos (heading1/heading2/heading3), parágrafos, listas e tabelas onde fizer sentido. " +
    QUALITY_RULES,
  presentation:
    "Você é um especialista em montar apresentações de slides profissionais, no padrão de um deck " +
    "PowerPoint bem desenhado. " +
    "Você DEVE responder chamando a tool build_presentation com a estrutura completa dos slides. " +
    "Slides de bullets devem ter no máximo 5-6 bullets curtos e diretos (não parágrafos inteiros); use " +
    "o layout 'section_header' para separar blocos temáticos e 'closing' para o slide final. " +
    QUALITY_RULES,
};

const TOOLS: Record<DocType, { name: string; description: string; input_schema: Record<string, unknown> }> = {
  spreadsheet: {
    name: "build_spreadsheet",
    description: "Define a estrutura completa de uma planilha Excel com uma ou mais abas.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título/nome geral da planilha." },
        sheets: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nome da aba (máx. 31 caracteres)." },
              columns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    header: { type: "string" },
                    width: { type: "number", description: "Largura da coluna em caracteres, ex: 20." },
                  },
                  required: ["header"],
                },
              },
              rows: {
                type: "array",
                description: "Cada linha é um array de valores, na mesma ordem das colunas.",
                items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } },
              },
              headerStyle: {
                type: "object",
                properties: {
                  bold: { type: "boolean" },
                  fillColor: { type: "string", description: "Cor hex sem #, ex: '1F4E78'." },
                  fontColor: { type: "string", description: "Cor hex sem #, ex: 'FFFFFF'." },
                },
              },
              notes: { type: "string", description: "Observações sobre a aba (ex: como totais foram calculados)." },
            },
            required: ["name", "columns", "rows"],
          },
        },
      },
      required: ["title", "sheets"],
    },
  },
  document: {
    name: "build_document",
    description: "Define a estrutura completa de um documento de texto (Word).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sections: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "heading1",
                  "heading2",
                  "heading3",
                  "paragraph",
                  "bullet_list",
                  "numbered_list",
                  "table",
                  "page_break",
                ],
              },
              text: { type: "string", description: "Usado em heading1/heading2/heading3/paragraph." },
              items: {
                type: "array",
                items: { type: "string" },
                description: "Usado em bullet_list/numbered_list.",
              },
              table: {
                type: "object",
                description: "Usado em type=table.",
                properties: {
                  headers: { type: "array", items: { type: "string" } },
                  rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                },
              },
            },
            required: ["type"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
  presentation: {
    name: "build_presentation",
    description: "Define a estrutura completa de uma apresentação de slides (PowerPoint).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        theme: {
          type: "object",
          properties: {
            primaryColor: { type: "string", description: "Cor hex sem #, ex: '1F4E78'." },
          },
        },
        slides: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              layout: {
                type: "string",
                enum: ["title", "title_content", "bullets", "two_column", "section_header", "closing"],
              },
              title: { type: "string" },
              subtitle: { type: "string" },
              body: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              leftBullets: { type: "array", items: { type: "string" } },
              rightBullets: { type: "array", items: { type: "string" } },
              notes: { type: "string", description: "Notas do apresentador (não aparecem no slide)." },
            },
            required: ["layout"],
          },
        },
      },
      required: ["title", "slides"],
    },
  },
};

interface TextExcerpt {
  fileName?: string;
  text?: string;
}

interface NativeDoc {
  fileName?: string;
  mediaType?: string;
  base64?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: {
    docType?: string;
    prompt?: string;
    instructions?: string;
    textExcerpts?: TextExcerpt[];
    nativeDocs?: NativeDoc[];
    feedback?: string;
    previousSpec?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  const docType = body.docType as DocType;
  if (!docType || !DOC_TYPES.includes(docType)) {
    return json({ error: `docType deve ser um de: ${DOC_TYPES.join(", ")}.` }, 400);
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return json({ error: "prompt é obrigatório." }, 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return json({ error: `prompt muito longo (máx. ${MAX_PROMPT_LENGTH} caracteres).` }, 400);
  }

  const instructions = body.instructions?.trim() ?? "";
  if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    return json({ error: `instructions muito longas (máx. ${MAX_INSTRUCTIONS_LENGTH} caracteres).` }, 400);
  }

  const feedback = body.feedback?.trim();
  if (feedback && feedback.length > MAX_FEEDBACK_LENGTH) {
    return json({ error: `feedback muito longo (máx. ${MAX_FEEDBACK_LENGTH} caracteres).` }, 400);
  }
  if (feedback && !body.previousSpec) {
    return json({ error: "feedback requer previousSpec." }, 400);
  }

  const textExcerpts = Array.isArray(body.textExcerpts) ? body.textExcerpts : [];
  if (textExcerpts.length > MAX_TEXT_EXCERPTS) {
    return json({ error: `no máximo ${MAX_TEXT_EXCERPTS} anexos de texto por geração.` }, 400);
  }
  for (const excerpt of textExcerpts) {
    if (typeof excerpt.text !== "string" || typeof excerpt.fileName !== "string") {
      return json({ error: "cada textExcerpt precisa de fileName e text." }, 400);
    }
  }

  const nativeDocs = Array.isArray(body.nativeDocs) ? body.nativeDocs : [];
  if (nativeDocs.length > MAX_NATIVE_DOCS) {
    return json({ error: `no máximo ${MAX_NATIVE_DOCS} anexos nativos (PDF/imagem) por geração.` }, 400);
  }
  for (const doc of nativeDocs) {
    if (!doc.mediaType || !ALLOWED_NATIVE_MEDIA_TYPES.has(doc.mediaType)) {
      return json({ error: `mediaType de anexo não suportado: ${doc.mediaType}.` }, 400);
    }
    if (!doc.base64 || doc.base64.length > MAX_NATIVE_DOC_BASE64_LENGTH) {
      return json({ error: `anexo "${doc.fileName ?? ""}" ausente ou grande demais.` }, 400);
    }
  }

  const contentBlocks: Record<string, unknown>[] = [];

  for (const doc of nativeDocs) {
    contentBlocks.push({
      type: doc.mediaType === "application/pdf" ? "document" : "image",
      source: { type: "base64", media_type: doc.mediaType, data: doc.base64 },
    });
  }

  let textBlock = `Pedido do usuário:\n${prompt}`;

  if (textExcerpts.length > 0) {
    const excerptsText = textExcerpts
      .map((e) => `--- ${e.fileName} ---\n${(e.text ?? "").slice(0, MAX_TEXT_EXCERPT_LENGTH)}`)
      .join("\n\n");
    textBlock += `\n\nTrechos extraídos dos arquivos de referência anexados:\n\n${excerptsText}`;
  }

  if (feedback && body.previousSpec) {
    textBlock +=
      `\n\nEsta é uma REVISÃO de um documento já gerado. Estrutura atual (JSON):\n` +
      `${JSON.stringify(body.previousSpec)}\n\n` +
      `Feedback do usuário sobre essa versão: "${feedback}"\n\n` +
      `Chame a tool novamente com a estrutura COMPLETA revisada, aplicando o feedback ` +
      `(mantenha o que não foi pedido para mudar).`;
  }

  contentBlocks.push({ type: "text", text: textBlock });

  const tool = TOOLS[docType];
  const system = instructions
    ? `${SYSTEM_PROMPTS[docType]}\n\nInstruções específicas deste projeto, definidas pelo usuário: ${instructions}`
    : SYSTEM_PROMPTS[docType];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: contentBlocks }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", response.status, errText);
    return json({ error: "Falha ao gerar o documento. Tente novamente em instantes." }, 502);
  }

  const data = await response.json();
  const toolUse = data.content?.find(
    (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === tool.name,
  );
  const spec = toolUse?.input;
  if (!spec) {
    return json({ error: "Resposta inesperada do modelo." }, 502);
  }

  return json({ docType, title: spec.title ?? "Documento sem título", spec });
});
