import { createClient } from "jsr:@supabase/supabase-js@2"

// Resumo/insights por IA sobre um exame (PDF/JPG/PNG) enviado por um
// paciente, pra apoiar a leitura do médico responsável. Requer a secret
// ANTHROPIC_API_KEY configurada no projeto Supabase (já usada por outras
// functions deste mesmo projeto compartilhado). O resultado é salvo em
// pandafit_document_ai_summaries (chave = document_id) pra não gerar de
// novo — nem gastar de novo na API — se o médico reabrir o mesmo exame;
// passe { force: true } no corpo pra regenerar mesmo já tendo cache.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

const ALLOWED_MEDIA_TYPES: Record<string, boolean> = {
  "application/pdf": true,
  "image/jpeg": true,
  "image/png": true,
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Não autenticado" }, 401)

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData.user) return json({ error: "Sessão inválida" }, 401)

    const admin = createClient(supabaseUrl, serviceKey)

    const { data: callerScope, error: scopeError } = await admin
      .from("pandafit_usuarios")
      .select("id, role")
      .eq("id", callerData.user.id)
      .maybeSingle()
    if (scopeError) throw scopeError
    if (!callerScope) return json({ error: "Esta conta não tem acesso ao PandaFit" }, 403)

    // Recurso pensado pra apoiar o médico na leitura do exame de um
    // paciente vinculado a ele — por enquanto restrito a esse papel.
    if (callerScope.role !== "medico") {
      return json({ error: "Apenas médicos podem gerar o resumo com IA" }, 403)
    }

    const body = await req.json()
    const documentId = body.documentId
    const force = body.force === true
    if (documentId == null || (typeof documentId !== "number" && typeof documentId !== "string")) {
      return json({ error: "documentId é obrigatório" }, 400)
    }

    const { data: doc, error: docError } = await admin
      .from("pandafit_documents")
      .select("id, user_id, file_name, file_path, file_type, file_size")
      .eq("id", documentId)
      .maybeSingle()
    if (docError) throw docError
    if (!doc) return json({ error: "Documento não encontrado" }, 404)

    const { data: vinculo, error: vinculoError } = await admin
      .from("pandafit_medico_pacientes")
      .select("medico_id")
      .eq("medico_id", callerScope.id)
      .eq("usuario_id", doc.user_id)
      .maybeSingle()
    if (vinculoError) throw vinculoError
    if (!vinculo) return json({ error: "Você não está conectado a este paciente" }, 403)

    if (!ALLOWED_MEDIA_TYPES[doc.file_type]) {
      return json({ error: "Tipo de arquivo não suportado para análise por IA (só PDF, JPG ou PNG)." }, 400)
    }

    if (!force) {
      const { data: cached, error: cachedError } = await admin
        .from("pandafit_document_ai_summaries")
        .select("summary, model, generated_at")
        .eq("document_id", doc.id)
        .maybeSingle()
      if (cachedError) throw cachedError
      if (cached) {
        return json({ summary: cached.summary, model: cached.model, generatedAt: cached.generated_at, cached: true })
      }
    }

    const { data: fileBlob, error: downloadError } = await admin.storage
      .from("pandafit-documents")
      .download(doc.file_path)
    if (downloadError || !fileBlob) {
      console.error("Falha ao baixar documento para análise:", downloadError)
      return json({ error: "Não foi possível carregar o arquivo pra análise." }, 502)
    }

    const buffer = await fileBlob.arrayBuffer()
    if (buffer.byteLength > MAX_FILE_BYTES) {
      return json({ error: "Arquivo grande demais pra análise por IA (máx. 10MB)." }, 400)
    }
    const base64 = bufferToBase64(buffer)

    const contentBlock = doc.file_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: doc.file_type, data: base64 } }
      : { type: "image", source: { type: "base64", media_type: doc.file_type, data: base64 } }

    const model = "claude-sonnet-5"
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system:
          "Você é um assistente de apoio à leitura de exames médicos para um médico responsável, em português do Brasil. " +
          "Resuma o documento anexado de forma objetiva: tipo de exame, principais achados, valores fora da faixa de " +
          "referência quando aparecerem, e pontos que mereçam atenção. Não dê diagnóstico nem recomendação de tratamento " +
          "— isso é papel do médico. Seja direto, use bullet points curtos quando fizer sentido, e termine sempre com a " +
          "frase: \"Resumo gerado por IA como apoio à leitura — a interpretação clínica é do médico responsável.\"",
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: `Arquivo: ${doc.file_name}. Resuma este exame.` },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error("Anthropic API error:", response.status, errText)
      return json({ error: "Falha ao gerar o resumo. Tente novamente em instantes." }, 502)
    }

    const data = await response.json()
    const summary = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim()
    if (!summary) return json({ error: "Resposta inesperada do modelo." }, 502)

    const generatedAt = new Date().toISOString()
    const { error: upsertError } = await admin
      .from("pandafit_document_ai_summaries")
      .upsert(
        { document_id: doc.id, summary, model, generated_by: callerScope.id, generated_at: generatedAt },
        { onConflict: "document_id" },
      )
    if (upsertError) console.error("Falha ao salvar resumo de IA:", upsertError)

    return json({ summary, model, generatedAt, cached: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno"
    return json({ error: message }, 500)
  }
})
