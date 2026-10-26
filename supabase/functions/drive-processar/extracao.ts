// Extração de texto de PDF, Word (.docx), PowerPoint (.pptx) e Excel (.xlsx),
// sempre com a localização de cada pedaço (página, slide, aba e linhas), e a
// divisão em trechos de tamanho uniforme para a busca.
//
// PDF: unpdf (pdf.js), página por página. Office: são ZIPs com XML dentro,
// lidos direto (só texto, sem imagens). O Excel sai linha por linha, com o
// cabeçalho repetido em cada trecho e datas convertidas para dd/mm/aaaa.
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.1";
import { strFromU8, unzipSync } from "npm:fflate@0.8.2";

export type Formato = "pdf" | "docx" | "pptx" | "xlsx";

export interface Secao {
  local: string;
  texto: string;
}

const MAX_LINHAS_PLANILHA = 10_000;

// ---------- formato ----------

// Pelo conteúdo, não pelo nome: arquivos do Google exportados e arquivos sem
// extensão caem no lugar certo.
export function detectarFormato(bytes: Uint8Array): Formato {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new Error("Formato antigo do Office (.doc, .ppt ou .xls). Abra o arquivo e salve como .docx, .pptx ou .xlsx.");
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const nomes: string[] = [];
    unzipSync(bytes, { filter: (f) => (nomes.push(f.name), false) });
    if (nomes.includes("word/document.xml")) return "docx";
    if (nomes.includes("ppt/presentation.xml")) return "pptx";
    if (nomes.includes("xl/workbook.xml")) return "xlsx";
  }
  throw new Error("Não reconheci o formato do arquivo. O agente lê PDF, .docx, .pptx e .xlsx.");
}

export function extrair(formato: Formato, bytes: Uint8Array): Promise<Secao[]> | Secao[] {
  if (formato === "pdf") return extrairPdf(bytes);
  if (formato === "docx") return extrairDocx(bytes);
  if (formato === "pptx") return extrairPptx(bytes);
  return extrairXlsx(bytes);
}

// ---------- PDF ----------

async function extrairPdf(bytes: Uint8Array): Promise<Secao[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ local: `página ${i + 1}`, texto: t }));
}

// ---------- XML do Office ----------

function decodificarXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Texto de cada parágrafo (<a:p> no PowerPoint, <w:p> no Word).
function paragrafos(xml: string, ns: "a" | "w"): { texto: string; interno: string }[] {
  const semVazios = xml.replace(new RegExp(`<${ns}:p\\s*/>`, "g"), "");
  const quebra = ns === "a" ? /<a:br\b[^>]*\/>/g : /<w:br\b[^>]*\/>/g;
  const reP = new RegExp(`<${ns}:p\\b[^>]*>([\\s\\S]*?)</${ns}:p>`, "g");
  const reT = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>`, "g");
  const saida: { texto: string; interno: string }[] = [];
  for (const m of semVazios.matchAll(reP)) {
    let interno = m[1].replace(quebra, `<${ns}:t> </${ns}:t>`);
    if (ns === "w") interno = interno.replace(/<w:tab\s*\/>/g, "<w:t>\t</w:t>");
    const texto = [...interno.matchAll(reT)].map((t) => decodificarXml(t[1])).join("").trim();
    if (texto) saida.push({ texto, interno: m[1] });
  }
  return saida;
}

function relacoes(xml: string): Map<string, { tipo: string; alvo: string }> {
  const mapa = new Map<string, { tipo: string; alvo: string }>();
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const tipo = /\bType="([^"]+)"/.exec(m[1])?.[1] ?? "";
    const alvo = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && alvo) mapa.set(id, { tipo, alvo });
  }
  return mapa;
}

function resolver(pasta: string, alvo: string): string {
  if (alvo.startsWith("/")) return alvo.slice(1);
  const partes: string[] = [];
  for (const p of (pasta + alvo).split("/")) {
    if (p === "..") partes.pop();
    else if (p && p !== ".") partes.push(p);
  }
  return partes.join("/");
}

// ---------- PowerPoint ----------

function extrairPptx(bytes: Uint8Array): Secao[] {
  const arquivos = unzipSync(bytes, { filter: (f) => f.name.startsWith("ppt/") && /\.(xml|rels)$/.test(f.name) });
  const ler = (nome: string) => (arquivos[nome] ? strFromU8(arquivos[nome]) : "");

  // Ordem real da apresentação (presentation.xml), não a numeração dos arquivos.
  const rels = relacoes(ler("ppt/_rels/presentation.xml.rels"));
  let slides = [...ler("ppt/presentation.xml").matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => rels.get(m[1]))
    .filter((r): r is { tipo: string; alvo: string } => !!r)
    .map((r) => resolver("ppt/", r.alvo));
  if (!slides.length) {
    slides = Object.keys(arquivos)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  }

  return slides.map((caminho, i) => {
    // Campos como o número do slide não são conteúdo.
    const limpar = (xml: string) => xml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, "");
    const texto = paragrafos(limpar(ler(caminho)), "a").map((p) => p.texto);
    const pasta = caminho.slice(0, caminho.lastIndexOf("/") + 1);
    const relsSlide = relacoes(ler(`${pasta}_rels/${caminho.slice(pasta.length)}.rels`));
    const notasRel = [...relsSlide.values()].find((r) => r.tipo.endsWith("/notesSlide"));
    const notas = notasRel ? paragrafos(limpar(ler(resolver(pasta, notasRel.alvo))), "a").map((p) => p.texto) : [];
    const partes = [texto.join("\n")];
    if (notas.length) partes.push(`Notas do apresentador:\n${notas.join("\n")}`);
    return { local: `slide ${i + 1}`, texto: partes.join("\n\n") };
  });
}

// ---------- Word ----------

const ESTILO_TITULO = /^(heading|title|t[ií]?tulo|ttulo)\s*\d*$/i;

function extrairDocx(bytes: Uint8Array): Secao[] {
  const arquivos = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = arquivos["word/document.xml"] ? strFromU8(arquivos["word/document.xml"]) : "";
  // Cada título do documento abre uma seção; a seção leva o nome do título.
  const secoes: Secao[] = [];
  let atual: Secao = { local: "início do documento", texto: "" };
  for (const p of paragrafos(xml, "w")) {
    const estilo = /<w:pStyle w:val="([^"]+)"/.exec(p.interno)?.[1];
    if (estilo && ESTILO_TITULO.test(estilo)) {
      if (atual.texto.trim()) secoes.push(atual);
      atual = { local: `seção "${p.texto.slice(0, 80)}"`, texto: p.texto };
    } else {
      atual.texto += (atual.texto ? "\n" : "") + p.texto;
    }
  }
  if (atual.texto.trim()) secoes.push(atual);
  if (secoes.length === 1) secoes[0].local = "documento";
  return secoes;
}

// ---------- Excel ----------

// Formatos de número embutidos do Excel que são datas.
const FORMATOS_DATA = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function textoRico(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodificarXml(m[1])).join("");
}

function colunaParaIndice(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function serialParaData(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 86400_000));
  const p = (x: number) => String(x).padStart(2, "0");
  const data = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return serial % 1 ? `${data} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : data;
}

// Lê as abas como linhas de células (texto), na ordem do arquivo.
function lerPlanilhas(bytes: Uint8Array): { aba: string; linhas: { n: number; celulas: string[] }[] }[] {
  const arquivos = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") && /\.(xml|rels)$/.test(f.name) });
  const ler = (nome: string) => (arquivos[nome] ? strFromU8(arquivos[nome]) : "");

  const compartilhadas = [...ler("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoRico(m[1]));

  // Estilos de célula que exibem data: embutidos ou formatos próprios com d/m/a.
  const estilos = ler("xl/styles.xml");
  const formatosData = new Set(FORMATOS_DATA);
  for (const m of estilos.matchAll(/<numFmt\b([^>]*)/g)) {
    const id = /numFmtId="(\d+)"/.exec(m[1])?.[1];
    const codigo = decodificarXml(/formatCode="([^"]*)"/.exec(m[1])?.[1] ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (id && (/[dy]/i.test(codigo) || /m{3,}/i.test(codigo))) formatosData.add(Number(id));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilos)?.[1] ?? "";
  const estiloData = [...xfs.matchAll(/<xf\b([^>]*)/g)].map((m) => formatosData.has(Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? -1)));

  const rels = relacoes(ler("xl/_rels/workbook.xml.rels"));
  const abas = [...ler("xl/workbook.xml").matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => ({
    nome: decodificarXml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "Planilha"),
    caminho: resolver("xl/", rels.get(/\br:id="([^"]+)"/.exec(m[1])?.[1] ?? "")?.alvo ?? ""),
  }));

  return abas.map(({ nome, caminho }) => {
    const linhas: { n: number; celulas: string[] }[] = [];
    for (const r of ler(caminho).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const n = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? linhas.length + 1);
      const celulas: string[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const interno = c[2] ?? "";
        const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
        const tipo = /\bt="(\w+)"/.exec(attrs)?.[1];
        const estilo = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(interno)?.[1];
        let valor = "";
        if (tipo === "s") valor = compartilhadas[Number(v)] ?? "";
        else if (tipo === "inlineStr") valor = textoRico(interno);
        else if (tipo === "b") valor = v === "1" ? "sim" : "não";
        else if (v !== undefined) {
          valor = decodificarXml(v);
          if (tipo !== "str" && tipo !== "e" && estiloData[estilo] && !isNaN(Number(valor))) valor = serialParaData(Number(valor));
        }
        const j = ref ? colunaParaIndice(ref) : celulas.length;
        celulas[j] = valor.trim();
      }
      linhas.push({ n, celulas: Array.from(celulas, (x) => x ?? "") });
    }
    return { aba: nome, linhas };
  });
}

function extrairXlsx(bytes: Uint8Array): Secao[] {
  const secoes: Secao[] = [];
  let restantes = MAX_LINHAS_PLANILHA;
  for (const { aba, linhas } of lerPlanilhas(bytes)) {
    if (restantes <= 0) break;
    const comNumero = linhas.filter((l) => l.celulas.some(Boolean));
    if (!comNumero.length) continue;

    // Primeira linha com conteúdo = cabeçalho, repetido no início de cada trecho.
    const [cab, ...dados] = comNumero;
    const colunas = cab.celulas.map((c, j) => c || `Coluna ${j + 1}`);
    const prefixo = `Planilha "${aba}". Colunas: ${colunas.join(", ")}\n`;
    if (!dados.length) {
      secoes.push({ local: `aba "${aba}"`, texto: prefixo });
      continue;
    }
    let bloco: string[] = [];
    let inicio = dados[0].n;
    let fim = inicio;
    const fechar = () => {
      if (bloco.length) secoes.push({ local: `aba "${aba}", linhas ${inicio} a ${fim}`, texto: prefixo + bloco.join("\n") });
      bloco = [];
    };
    for (const l of dados.slice(0, restantes)) {
      const texto = `Linha ${l.n}: ` + l.celulas
        .map((v, j) => (v ? `${colunas[j] ?? `Coluna ${j + 1}`}: ${v}` : ""))
        .filter(Boolean)
        .join(" | ");
      if (bloco.length && prefixo.length + bloco.join("\n").length + texto.length > ALVO) {
        fechar();
        inicio = l.n;
      }
      bloco.push(texto);
      fim = l.n;
    }
    fechar();
    restantes -= dados.length;
  }
  return secoes;
}

// ---------- divisão em trechos ----------

const MAX = 3500;
const ALVO = 2500;
const SOBREPOSICAO = 300;

// Seção curta vira um trecho; seção longa é quebrada por parágrafos em trechos
// de ~2500 caracteres, com ~300 de sobreposição para não cortar o contexto.
export function dividir(secoes: Secao[]): Secao[] {
  const saida: Secao[] = [];
  for (const s of secoes) {
    const texto = s.texto.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!texto) continue;
    if (texto.length <= MAX) {
      saida.push({ local: s.local, texto });
      continue;
    }
    const blocos: string[] = [];
    for (const b of texto.split(/\n+/)) {
      for (let i = 0; i < b.length; i += ALVO) blocos.push(b.slice(i, i + ALVO));
    }
    const partes: string[] = [];
    let atual = "";
    for (const b of blocos) {
      if (atual && atual.length + b.length + 1 > ALVO) {
        partes.push(atual);
        const cauda = atual.slice(-SOBREPOSICAO);
        atual = cauda.slice(cauda.indexOf(" ") + 1) + "\n" + b;
      } else {
        atual = atual ? `${atual}\n${b}` : b;
      }
    }
    if (atual) partes.push(atual);
    partes.forEach((p, k) => saida.push({ local: `${s.local} (parte ${k + 1} de ${partes.length})`, texto: p }));
  }
  return saida;
}
