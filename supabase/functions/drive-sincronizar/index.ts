// Botão "Atualizar base" do Agente do Drive (só admin; deploy com verify_jwt).
// Lista a pasta pública, enfileira os arquivos suportados numa nova
// sincronização, remove da base o que saiu da pasta e dispara a cadeia de
// `drive-processar`. Se já houver uma sincronização andando, devolve ela; se
// ela travou (cadeia interrompida), retoma de onde parou.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { listarPasta } from "./drive.ts";

const servico = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function config(): Promise<Record<string, string>> {
  const { data, error } = await servico.from("drive_config").select("chave, valor");
  if (error) throw error;
  return Object.fromEntries(data.map((l) => [l.chave, l.valor]));
}

async function dispararProcessamento(sinc: string) {
  const cfg = await config();
  const resp = await fetch(cfg.url_processar, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-drive-interno": cfg.segredo_interno },
    body: JSON.stringify({ sinc }),
  });
  if (!resp.ok) throw new Error(`drive-processar respondeu ${resp.status}`);
}

async function sincronizar(email: string) {
  // Uma sincronização por vez. Sem atualização há 3 min = cadeia interrompida.
  const { data: atual } = await servico
    .from("drive_sincronizacoes")
    .select("id, status, atualizado_em")
    .in("status", ["listando", "processando"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (atual) {
    const parada = Date.now() - new Date(atual.atualizado_em).getTime() > 3 * 60_000;
    if (!parada) return json({ id: atual.id, em_andamento: true });
    if (atual.status === "processando") {
      await servico.from("drive_sincronizacoes").update({ atualizado_em: new Date().toISOString() }).eq("id", atual.id);
      await dispararProcessamento(atual.id);
      return json({ id: atual.id, retomada: true });
    }
    await servico.from("drive_sincronizacoes").update({ status: "erro", mensagem: "A listagem da pasta foi interrompida." }).eq("id", atual.id);
  }

  const { data: sinc, error } = await servico.from("drive_sincronizacoes").insert({ iniciada_por: email }).select("id").single();
  if (error) throw error;
  const falhar = async (mensagem: string) => {
    await servico.from("drive_sincronizacoes").update({ status: "erro", mensagem, atualizado_em: new Date().toISOString() }).eq("id", sinc.id);
    return json({ id: sinc.id, erro: mensagem }, 502);
  };

  const cfg = await config();
  let lista;
  try {
    lista = await listarPasta(cfg.pasta_id);
  } catch (e) {
    return await falhar(e instanceof Error ? e.message : String(e));
  }

  const { data: existentes, error: errExist } = await servico.from("drive_documentos").select("id, drive_id");
  if (errExist) return await falhar(errExist.message);
  const naPasta = new Set([...lista.suportados, ...lista.ignorados].map((i) => i.drive_id));
  const removidos = existentes.filter((d) => !naPasta.has(d.drive_id)).map((d) => d.id);

  if (lista.suportados.length) {
    // Sem `status` no upsert: arquivo novo nasce 'pendente'; o que já estava ok
    // continua pesquisável enquanto é reprocessado.
    const { error: e } = await servico.from("drive_documentos").upsert(
      lista.suportados.map((i) => ({
        ...i,
        fila_sinc: sinc.id,
        ultima_sinc: sinc.id,
        resultado_sinc: null,
        passo_em: null,
        tentativas: 0,
      })),
      { onConflict: "drive_id" },
    );
    if (e) return await falhar(e.message);
  }
  if (lista.ignorados.length) {
    const { data: ign, error: e } = await servico.from("drive_documentos").upsert(
      lista.ignorados.map((i) => ({
        ...i,
        status: "ignorado",
        erro: "Formato não suportado. O agente lê PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx) e arquivos do Google Docs, Slides e Sheets.",
        fila_sinc: null,
        ultima_sinc: sinc.id,
        resultado_sinc: "ignorado",
        total_trechos: 0,
      })),
      { onConflict: "drive_id" },
    ).select("id");
    if (e) return await falhar(e.message);
    await servico.from("drive_trechos").delete().in("documento_id", ign.map((d) => d.id));
  }
  if (removidos.length) {
    const { error: e } = await servico.from("drive_documentos").delete().in("id", removidos);
    if (e) return await falhar(e.message);
  }

  await servico.from("drive_sincronizacoes").update({
    status: "processando",
    total: lista.suportados.length,
    ignorados: lista.ignorados.length,
    removidos: removidos.length,
    atualizado_em: new Date().toISOString(),
  }).eq("id", sinc.id);

  if (!lista.suportados.length) {
    await servico.rpc("drive_registrar_progresso", { p_sinc: sinc.id });
  } else {
    try {
      await dispararProcessamento(sinc.id);
    } catch (e) {
      return await falhar(`Não consegui iniciar o processamento: ${e instanceof Error ? e.message : e}`);
    }
  }
  return json({ id: sinc.id, total: lista.suportados.length, ignorados: lista.ignorados.length, removidos: removidos.length }, 201);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await servico.auth.getUser(token);
  const email = auth?.user?.email?.toLowerCase();
  if (!email) return json({ erro: "Entre na sua conta." }, 401);
  const { data: acesso } = await servico.from("drive_acessos").select("admin").eq("email", email).maybeSingle();
  if (!acesso?.admin) return json({ erro: "Só administradores podem atualizar a base." }, 403);

  try {
    return await sincronizar(email);
  } catch (e) {
    console.error("drive-sincronizar:", e);
    return json({ erro: "Falha ao atualizar a base. Tente de novo." }, 500);
  }
});
