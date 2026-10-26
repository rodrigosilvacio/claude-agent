// Listagem de uma pasta PÚBLICA do Google Drive sem credencial: lê a
// visualização embutida (embeddedfolderview), que não é API oficial. Se o
// Google mudar essa página, só esta função precisa ser trocada (por exemplo,
// pela Drive API com conta de serviço quando a pasta deixar de ser pública).

export type TipoDrive = "arquivo" | "doc" | "slides" | "planilha";

export interface ItemDrive {
  drive_id: string;
  nome: string;
  tipo_drive: TipoDrive;
  link: string;
}

export interface Listagem {
  suportados: ItemDrive[];
  ignorados: ItemDrive[];
}

const EXTENSOES = /\.(pdf|docx|pptx|xlsx)$/i;
const MAX_PASTAS = 30;

function decodificarHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function lerPasta(pastaId: string): Promise<{ id: string; nome: string; href: string }[]> {
  const resp = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(pastaId)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (drive-agente)", "Accept-Language": "pt-BR" },
  });
  if (!resp.ok) throw new Error(`O Drive respondeu ${resp.status} ao listar a pasta. Confira se ela está compartilhada como "Qualquer pessoa com o link".`);
  const html = await resp.text();
  const itens: { id: string; nome: string; href: string }[] = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) itens.push({ id: m[1], href: decodificarHtml(m[2]), nome: decodificarHtml(m[3]) });
  // Pasta vazia ainda tem o container; sem ele, a página mudou ou exige login.
  if (!itens.length && !html.includes("flip-entries")) throw new Error("Não consegui ler a pasta do Drive. Ela está pública?");
  return itens;
}

function classificar(href: string): TipoDrive | "pasta" | null {
  if (href.includes("/drive/folders/")) return "pasta";
  if (href.includes("docs.google.com/document/")) return "doc";
  if (href.includes("docs.google.com/presentation/")) return "slides";
  if (href.includes("docs.google.com/spreadsheets/")) return "planilha";
  if (href.includes("/file/d/")) return "arquivo";
  return null;
}

// Percorre a pasta e as subpastas (até MAX_PASTAS), separando o que o agente
// sabe ler (PDF, Word, PowerPoint, Excel e os nativos do Google) do resto.
export async function listarPasta(pastaId: string): Promise<Listagem> {
  const suportados: ItemDrive[] = [];
  const ignorados: ItemDrive[] = [];
  const fila: { id: string; prefixo: string }[] = [{ id: pastaId, prefixo: "" }];
  const vistos = new Set<string>();
  while (fila.length) {
    const pasta = fila.shift()!;
    if (vistos.has(pasta.id)) continue;
    vistos.add(pasta.id);
    if (vistos.size > MAX_PASTAS) throw new Error(`A pasta tem mais de ${MAX_PASTAS} subpastas. Simplifique a estrutura.`);
    for (const item of await lerPasta(pasta.id)) {
      const tipo = classificar(item.href);
      const nome = pasta.prefixo + item.nome;
      if (tipo === "pasta") {
        fila.push({ id: item.id, prefixo: `${nome}/` });
        continue;
      }
      const link = item.href.replace(/[?&]usp=drive_web$/, "");
      const registro = { drive_id: item.id, nome, tipo_drive: (tipo ?? "arquivo") as TipoDrive, link };
      if (tipo === "doc" || tipo === "slides" || tipo === "planilha" || (tipo === "arquivo" && EXTENSOES.test(item.nome))) {
        suportados.push(registro);
      } else {
        ignorados.push(registro);
      }
    }
  }
  return { suportados, ignorados };
}
