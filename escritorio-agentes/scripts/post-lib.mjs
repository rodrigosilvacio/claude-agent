// Funções compartilhadas pelos scripts da esteira: leitura das seções do post
// e detecção de travessões.

export const SECOES = ['Título', 'Texto', 'Hashtags', 'Frase para a arte', 'Notas do Tiago'];

export function lerSecoes(md) {
  const secoes = {};
  let atual = null;
  for (const linha of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = linha.match(/^##\s+(.+?)\s*$/);
    if (m && SECOES.includes(m[1])) {
      atual = m[1];
      secoes[atual] = [];
    } else if (atual) {
      secoes[atual].push(linha);
    }
  }
  for (const k of Object.keys(secoes)) secoes[k] = secoes[k].join('\n').trim();
  return secoes;
}

// Travessão = em dash, en dash, barra horizontal, sinal de menos, hífen solto
// entre espaços ou hífen abrindo linha. Hífen dentro de palavra é permitido.
const PADROES = [
  { re: /[—–―−]/g, nome: 'travessão (— ou –)' },
  { re: /[ \t]-{1,2}[ \t]/g, nome: 'hífen solto usado como travessão' },
  { re: /^\s*-{1,3}(\s|$)/gm, nome: 'linha começando com hífen' },
];

export function acharTravessoes(texto) {
  const achados = [];
  for (const { re, nome } of PADROES) {
    for (const m of texto.matchAll(re)) {
      const ini = Math.max(0, m.index - 25);
      const trecho = texto.slice(ini, m.index + m[0].length + 25).replace(/\n/g, ' ');
      achados.push({ nome, trecho: trecho.trim() });
    }
  }
  return achados;
}

export function montarPostFinal(secoes) {
  return `${secoes['Título']}\n\n${secoes['Texto']}\n\n${secoes['Hashtags']}\n`;
}
