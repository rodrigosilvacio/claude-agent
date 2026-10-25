// Regras determinísticas da esteira Nina News (valem mais que o julgamento do
// modelo). Funções puras, sem rede e sem Deno, para testar com `node --test`.

export type Tema = "ia" | "dados" | "vazamentos";
export const TEMAS: Tema[] = ["ia", "dados", "vazamentos"];

export const ROTULO_TEMA: Record<Tema, string> = {
  ia: "IA",
  dados: "Dados",
  vazamentos: "Vazamentos",
};

export interface Noticia {
  tema: Tema;
  titulo: string;
  resumo: string;
  fonte: string;
  url: string;
}

export interface Post {
  titulo: string;
  texto: string;
  hashtags: string[];
}

export interface Checagem {
  erros: string[];
  avisos: string[];
  caracteres: number;
}

export const LIMITE_POST = 3000;
export const LIMITE_TITULO = 90;

// ---------- travessões ----------

// Travessão = em dash, en dash, barra horizontal, sinal de menos, hífen solto
// entre espaços ou hífen abrindo linha. Hífen dentro de palavra é permitido.
const PADROES: Array<[RegExp, string]> = [
  [/[—–―−]/g, "travessão (— ou –)"],
  [/[ \t]-{1,2}[ \t]/g, "hífen solto usado como travessão"],
  [/^\s*-{1,3}(\s|$)/gm, "linha começando com hífen"],
];

export function acharTravessoes(texto: string): string[] {
  const achados: string[] = [];
  for (const [re, nome] of PADROES) {
    for (const m of texto.matchAll(re)) {
      const ini = Math.max(0, (m.index ?? 0) - 25);
      const trecho = texto.slice(ini, (m.index ?? 0) + m[0].length + 25).replace(/\n/g, " ").trim();
      achados.push(`${nome} em "...${trecho}..."`);
    }
  }
  return achados;
}

// Último recurso quando o modelo insiste: troca o travessão por vírgula e o
// hífen de lista por "•". Hífen dentro de palavra (guarda-chuva) fica.
export function limparTravessoes(texto: string): string {
  return texto
    .split("\n")
    .map((linha) =>
      linha
        .replace(/^(\s*)-{1,3}\s+/, "$1• ")
        .replace(/\s*[—–―−]\s*/g, ", ")
        .replace(/[ \t]-{1,2}[ \t]/g, ", ")
        .replace(/,\s*,/g, ",")
        .replace(/\s+([,.;:!?])/g, "$1")
    )
    .join("\n");
}

// ---------- post ----------

export function normalizarHashtags(lista: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const h of lista) {
    const limpa = String(h).trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!limpa || vistos.has(limpa.toLowerCase())) continue;
    vistos.add(limpa.toLowerCase());
    saida.push(`#${limpa}`);
  }
  return saida;
}

export function montarPostFinal(p: Post): string {
  return `${p.titulo.trim()}\n\n${p.texto.trim()}\n\n${p.hashtags.join(" ")}`;
}

export function checarPost(p: Post): Checagem {
  const erros: string[] = [];
  const avisos: string[] = [];
  const final = montarPostFinal(p);

  if (!p.titulo.trim()) erros.push("Título vazio.");
  if (p.titulo.includes("\n")) erros.push("O título deve ter uma linha só.");
  if (p.titulo.length > LIMITE_TITULO) erros.push(`Título com ${p.titulo.length} caracteres (máximo ${LIMITE_TITULO}).`);
  if (!p.texto.trim()) erros.push("Texto vazio.");
  if (final.length > LIMITE_POST) erros.push(`Post com ${final.length} caracteres (máximo ${LIMITE_POST} no LinkedIn).`);
  else if (final.length < 600) avisos.push(`Post com ${final.length} caracteres (curto, ideal a partir de 900).`);
  if (p.hashtags.length < 2 || p.hashtags.length > 3) erros.push(`${p.hashtags.length} hashtags (esperado de 2 a 3).`);

  for (const [nome, conteudo] of [["Título", p.titulo], ["Texto", p.texto], ["Hashtags", p.hashtags.join(" ")]]) {
    for (const t of acharTravessoes(conteudo)) erros.push(`${nome}: ${t}`);
  }

  const emojis = final.match(/\p{Extended_Pictographic}/gu) ?? [];
  if (emojis.length > 2) avisos.push(`${emojis.length} emojis (máximo recomendado 2).`);
  return { erros, avisos, caracteres: final.length };
}

// ---------- entrada vinda do navegador ----------
// O corpo vem de fora: nada é confiado. Tudo é cortado em tamanho e validado.

export class EntradaInvalida extends Error {}

export function texto(valor: unknown, campo: string, max: number): string {
  if (typeof valor !== "string") throw new EntradaInvalida(`Campo "${campo}" ausente ou inválido.`);
  const limpo = valor.trim();
  if (!limpo) throw new EntradaInvalida(`Campo "${campo}" vazio.`);
  if (limpo.length > max) throw new EntradaInvalida(`Campo "${campo}" acima de ${max} caracteres.`);
  return limpo;
}

export function urlHttp(valor: unknown, campo: string): string {
  const s = texto(valor, campo, 600);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new EntradaInvalida(`Campo "${campo}" não é uma URL.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new EntradaInvalida(`Campo "${campo}" precisa ser http ou https.`);
  return u.href;
}

export function validarNoticia(valor: unknown): Noticia {
  if (!valor || typeof valor !== "object") throw new EntradaInvalida("Notícia inválida.");
  const n = valor as Record<string, unknown>;
  if (!TEMAS.includes(n.tema as Tema)) throw new EntradaInvalida('Campo "tema" inválido.');
  return {
    tema: n.tema as Tema,
    titulo: texto(n.titulo, "titulo", 300),
    resumo: texto(n.resumo, "resumo", 1200),
    fonte: texto(n.fonte, "fonte", 120),
    url: urlHttp(n.url, "url"),
  };
}

export function validarNoticias(valor: unknown): Noticia[] {
  if (!Array.isArray(valor) || valor.length < 1 || valor.length > 3) {
    throw new EntradaInvalida('Campo "noticias" precisa ter de 1 a 3 itens.');
  }
  return valor.map(validarNoticia);
}

// Fala de balão: curta, uma linha, sem travessão.
export function falaCurta(valor: unknown, padrao: string): string {
  const s = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  const limpa = limparTravessoes(s || padrao);
  return limpa.length > 220 ? `${limpa.slice(0, 217).trimEnd()}...` : limpa;
}
