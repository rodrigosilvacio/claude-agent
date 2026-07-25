// Cowork — extração de anexos de referência no client. PDF e imagem são
// enviados nativamente à Claude (a API lê PDF/imagem direto, sem OCR manual),
// então aqui só marcamos "native" e guardamos o arquivo cru. Os demais tipos
// suportados viram texto ("text"), extraído uma vez no upload e cacheado em
// cowork_reference_files.extracted_text para não reprocessar a cada geração.

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_TEXT_LENGTH = 20000;

const NATIVE_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MEDIA_TYPE_BY_EXT = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export class UnsupportedFileError extends Error {}

function extOf(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName || "");
  return match ? match[1].toLowerCase() : "";
}

// Lê os bytes do File/Blob e devolve como base64 (sem o prefixo "data:...;base64,").
// Feito em chunks para não estourar a call stack de String.fromCharCode em
// arquivos grandes.
export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Extrai o que for necessário para um arquivo recém anexado. Retorna:
// { kind: "native", mediaType, fileName, fileSize }  — pdf/imagem
// { kind: "text", mediaType, text, fileName, fileSize } — demais suportados
export async function extractReferenceFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new UnsupportedFileError(`"${file.name}" excede o limite de ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
  }

  const ext = extOf(file.name);
  const mediaType = file.type || MEDIA_TYPE_BY_EXT[ext] || "";

  if (NATIVE_MEDIA_TYPES.has(mediaType)) {
    return { kind: "native", mediaType, fileName: file.name, fileSize: file.size };
  }

  if (["txt", "md", "csv"].includes(ext)) {
    const text = (await file.text()).slice(0, MAX_TEXT_LENGTH);
    return { kind: "text", mediaType: mediaType || "text/plain", text, fileName: file.name, fileSize: file.size };
  }

  if (ext === "docx") {
    const mammoth = await import("https://esm.sh/mammoth@1.8.0");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return {
      kind: "text",
      mediaType: MEDIA_TYPE_BY_EXT.docx,
      text: value.slice(0, MAX_TEXT_LENGTH),
      fileName: file.name,
      fileSize: file.size,
    };
  }

  if (ext === "xlsx") {
    const { default: ExcelJS } = await import("https://esm.sh/exceljs@4.4.0");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const parts = [];
    workbook.eachSheet((sheet) => {
      parts.push(`## ${sheet.name}`);
      sheet.eachRow((row) => {
        const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
        parts.push(cells.map((v) => (v == null ? "" : String(v))).join(" | "));
      });
    });
    return {
      kind: "text",
      mediaType: MEDIA_TYPE_BY_EXT.xlsx,
      text: parts.join("\n").slice(0, MAX_TEXT_LENGTH),
      fileName: file.name,
      fileSize: file.size,
    };
  }

  throw new UnsupportedFileError(
    `Tipo de arquivo não suportado: "${file.name}". Use PDF, imagem (PNG/JPG/WEBP/GIF), DOCX, XLSX, TXT, MD ou CSV.`,
  );
}
