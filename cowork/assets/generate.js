// Cowork — orquestra a geração de documentos: chama a edge function pra obter
// a estrutura (spec), monta o binário Office real no client e sobe pro storage.
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "./supabaseClient.js";
import { blobToBase64 } from "./fileExtract.js";
import { buildSpreadsheetBlob } from "./builders/xlsx.js";
import { buildDocumentBlob } from "./builders/docx.js";
import { buildPresentationBlob } from "./builders/pptx.js";

const BUILDERS = {
  spreadsheet: buildSpreadsheetBlob,
  document: buildDocumentBlob,
  presentation: buildPresentationBlob,
};

const EXTENSIONS = {
  spreadsheet: "xlsx",
  document: "docx",
  presentation: "pptx",
};

export async function listDocuments(projectId) {
  const { data, error } = await supabase
    .from("cowork_documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function callGenerateFunction(payload) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/cowork-generate-document`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(responseBody.error || "Falha ao gerar o documento.");
  }
  return responseBody;
}

// Referências com texto extraído no upload vão direto; PDFs/imagens ("native")
// são relidos do storage e convertidos pra base64 só na hora de gerar, pra não
// guardar base64 no banco.
async function referencesToPayload(referenceFiles) {
  const textExcerpts = [];
  const nativeDocs = [];

  for (const ref of referenceFiles) {
    if (ref.extracted_text) {
      textExcerpts.push({ fileName: ref.file_name, text: ref.extracted_text });
      continue;
    }
    const { data, error } = await supabase.storage.from("cowork-references").download(ref.file_path);
    if (error) continue;
    nativeDocs.push({ fileName: ref.file_name, mediaType: ref.file_type, base64: await blobToBase64(data) });
  }

  return { textExcerpts, nativeDocs };
}

export async function generateDocument({ ownerId, projectId, docType, prompt, instructions, referenceFiles }) {
  const docRow = await insertPlaceholder(ownerId, projectId, docType, prompt, "Gerando…");

  try {
    const { textExcerpts, nativeDocs } = await referencesToPayload(referenceFiles);
    const { title, spec } = await callGenerateFunction({ docType, prompt, instructions, textExcerpts, nativeDocs });
    return await finalizeDocument(docRow, docType, title, spec, ownerId, projectId);
  } catch (err) {
    await markError(docRow.id, err, "Falha ao gerar");
    throw err;
  }
}

export async function regenerateWithFeedback({
  ownerId,
  projectId,
  docType,
  prompt,
  instructions,
  referenceFiles,
  feedback,
  previousSpec,
}) {
  const docRow = await insertPlaceholder(ownerId, projectId, docType, prompt, "Ajustando…");

  try {
    const { textExcerpts, nativeDocs } = await referencesToPayload(referenceFiles);
    const { title, spec } = await callGenerateFunction({
      docType,
      prompt,
      instructions,
      textExcerpts,
      nativeDocs,
      feedback,
      previousSpec,
    });
    return await finalizeDocument(docRow, docType, title, spec, ownerId, projectId);
  } catch (err) {
    await markError(docRow.id, err, "Falha ao ajustar");
    throw err;
  }
}

async function insertPlaceholder(ownerId, projectId, docType, prompt, title) {
  const { data, error } = await supabase
    .from("cowork_documents")
    .insert([{ owner_id: ownerId, project_id: projectId, doc_type: docType, title, prompt, status: "generating" }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function markError(id, err, title) {
  await supabase
    .from("cowork_documents")
    .update({ status: "error", error_message: err.message, title })
    .eq("id", id);
}

async function finalizeDocument(docRow, docType, title, spec, ownerId, projectId) {
  const blob = await BUILDERS[docType](spec);
  const fileName = `${sanitizeFileName(title)}.${EXTENSIONS[docType]}`;
  const path = `${ownerId}/${projectId}/${docRow.id}/${fileName}`;

  const { error: uploadError } = await supabase.storage.from("cowork-documents").upload(path, blob, {
    contentType: blob.type,
  });
  if (uploadError) throw uploadError;

  const { data: updated, error: updateError } = await supabase
    .from("cowork_documents")
    .update({ status: "ready", title, file_path: path, file_name: fileName, spec })
    .eq("id", docRow.id)
    .select()
    .single();
  if (updateError) throw updateError;

  return updated;
}

function sanitizeFileName(name) {
  const cleaned = String(name || "documento")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned || "documento";
}

export async function getDownloadUrl(filePath) {
  const { data, error } = await supabase.storage.from("cowork-documents").createSignedUrl(filePath, 600);
  if (error) throw error;
  return data.signedUrl;
}
