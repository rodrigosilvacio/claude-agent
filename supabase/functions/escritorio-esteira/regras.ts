// Regras determinísticas da esteira (as mesmas de escritorio-agentes/scripts/
// checar-texto.mjs e renderizar-arte.mjs, portadas para a nuvem). Valem mais
// que o julgamento do modelo: qualquer ERRO aqui reprova a versão.

export interface Post {
  titulo: string;
  texto: string;
  hashtags: string[];
  frase_arte: string;
}

export interface Checagem {
  erros: string[];
  avisos: string[];
  caracteres: number;
}

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

export function montarPostFinal(p: Post): string {
  return `${p.titulo.trim()}\n\n${p.texto.trim()}\n\n${p.hashtags.join(" ")}\n`;
}

export function normalizarHashtags(lista: string[]): string[] {
  return lista
    .map((h) => h.trim().replace(/^#*/, ""))
    .filter(Boolean)
    .map((h) => `#${h.replace(/\s+/g, "")}`);
}

export function checarPost(p: Post): Checagem {
  const erros: string[] = [];
  const avisos: string[] = [];
  const final = montarPostFinal(p);

  if (!p.titulo.trim()) erros.push("Título vazio.");
  if (p.titulo.includes("\n")) erros.push("O título deve ter uma linha só.");
  if (p.titulo.length > 90) erros.push(`Título com ${p.titulo.length} caracteres (máximo 90).`);
  if (final.length > 3000) erros.push(`Post com ${final.length} caracteres (máximo 3000 no LinkedIn).`);
  else if (final.length > 1800) avisos.push(`Post com ${final.length} caracteres (ideal até 1800).`);
  else if (final.length < 600) avisos.push(`Post com ${final.length} caracteres (curto, ideal a partir de 900).`);
  if (p.hashtags.length < 2 || p.hashtags.length > 3) erros.push(`${p.hashtags.length} hashtags (esperado de 2 a 3).`);
  const palavras = p.frase_arte.split(/\s+/).filter(Boolean).length;
  if (palavras > 12) erros.push(`Frase para a arte com ${palavras} palavras (máximo 12).`);

  const partes: Array<[string, string]> = [
    ["Título", p.titulo],
    ["Texto", p.texto],
    ["Hashtags", p.hashtags.join(" ")],
    ["Frase para a arte", p.frase_arte],
  ];
  for (const [nome, conteudo] of partes) {
    for (const t of acharTravessoes(conteudo)) erros.push(`${nome}: ${t}`);
  }

  const emojis = final.match(/\p{Extended_Pictographic}/gu) ?? [];
  if (emojis.length > 2) avisos.push(`${emojis.length} emojis (máximo recomendado 2).`);
  const longo = p.texto.split(/\n\s*\n/).find((par) => par.length > 320);
  if (longo) avisos.push(`Parágrafo longo para LinkedIn: "${longo.slice(0, 60)}..."`);

  return { erros, avisos, caracteres: final.length };
}

// ---------- veredito do Roberto ----------

export const CRITERIOS = [
  "ortografia",
  "gramatica",
  "coerencia",
  "titulo",
  "postura",
  "tom",
  "estrutura",
  "aderencia",
] as const;

export interface Bloqueante {
  trecho: string;
  problema: string;
  correcao: string;
}

export function decidirVeredito(
  notas: Record<string, number>,
  bloqueantesModelo: Bloqueante[],
  checagem: Checagem,
) {
  const limpas: Record<string, number> = {};
  for (const c of CRITERIOS) limpas[c] = Math.max(0, Math.min(10, Math.round(Number(notas[c] ?? 0) * 10) / 10));
  const valores = Object.values(limpas);
  const media = Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100;
  const bloqueantes: Bloqueante[] = [
    ...checagem.erros.map((e) => ({ trecho: "(checagem automática)", problema: e, correcao: "Corrigir conforme a regra." })),
    ...bloqueantesModelo,
  ];
  // Regra do escritório: nenhum bloqueante, nenhuma nota abaixo de 8, média >= 8,5.
  const aprovado = bloqueantes.length === 0 && Math.min(...valores) >= 8 && media >= 8.5;
  return { notas: limpas, media, bloqueantes, aprovado };
}

export const formatarMedia = (m: number) => m.toFixed(2).replace(/0$/, "").replace(".", ",");

// ---------- arte ----------

// O HTML vem do modelo: tira tudo que executa ou carrega conteúdo de fora.
// O painel ainda renderiza num iframe sandbox sem scripts e com CSP.
export function sanitizarArte(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|base|meta|link(?![^>]*fonts\.googleapis\.com))[^>]*>/gi, "")
    .replace(/<\/(iframe|object|embed|frame|frameset)\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function validarArte(html: string): string[] {
  const erros: string[] = [];
  if (html.length > 60000) erros.push("HTML grande demais (máximo 60 mil caracteres).");
  const logos = html.match(/<img\b[^>]*>/gi)?.filter((tag) => /data-logo/i.test(tag)) ?? [];
  if (!logos.length) erros.push('Logo ausente: inclua <img data-logo src="{{LOGO}}" alt="Rodrigo Silva">.');
  else if (!logos.some((tag) => /src\s*=\s*["']\{\{LOGO\}\}["']/.test(tag))) {
    erros.push('O logo deve usar exatamente src="{{LOGO}}".');
  }
  const textoVisivel = html
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(mdash|ndash|horbar|minus|#821[12]|#x201[34]);/gi, "—")
    .replace(/&#?[a-z0-9]+;/gi, " ");
  for (const t of acharTravessoes(textoVisivel)) erros.push(`Travessão na arte: ${t}`);
  return erros;
}
