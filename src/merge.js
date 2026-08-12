import { log } from './log.js';
import { normalizarProcesso } from './sources/cnj.js';

/**
 * @typedef {Object} Publicacao
 * @property {'CNJ'|'Portal'} fonte
 * @property {string} identificador
 * @property {string} dataDisponibilizacao  dd/mm/aaaa
 * @property {string} dataPublicacao
 * @property {string} jornal
 * @property {string} caderno
 * @property {string} tribunal
 * @property {string} vara
 * @property {string} titulo
 * @property {string} pagina
 * @property {string} numeroProcesso
 * @property {string} intimacao
 * @property {string} [link]
 * @property {{nome: string, polo: string}[]} [partes]
 * @property {string[]} [advogados]
 * @property {string[]} [fontes]
 */

/** Codigos de polo do DJEN. Qualquer outro passa cru, em vez de sumir. */
const ROTULO_POLO = { A: 'Autor', P: 'Réu' };

/**
 * Agrupa as partes por polo: ['Autor: FULANO', 'Réu: CIA X LTDA'].
 *
 * Nomes chegam abreviados ("R.P.S.A.") quando o processo corre em segredo de
 * justica. Passam assim mesmo: e a informacao que existe, e esconder deixaria
 * a publicacao sem nenhuma identificacao de parte.
 */
export function formatarPartes(partes = []) {
  const porPolo = new Map();
  for (const { nome, polo } of partes) {
    if (!nome) continue;
    const rotulo = ROTULO_POLO[polo] || polo || 'Parte';
    if (!porPolo.has(rotulo)) porPolo.set(rotulo, []);
    porPolo.get(rotulo).push(nome);
  }
  // Ordem fixa Autor -> Reu: a API devolve na ordem dela, e duas publicacoes
  // lado a lado com os polos invertidos se leem mal.
  const ordem = Object.values(ROTULO_POLO);
  return [...porPolo]
    .sort((a, b) => {
      const ia = ordem.indexOf(a[0]);
      const ib = ordem.indexOf(b[0]);
      return (ia < 0 ? ordem.length : ia) - (ib < 0 ? ordem.length : ib);
    })
    .map(([rotulo, nomes]) => `${rotulo}: ${nomes.join(', ')}`);
}

/**
 * Limiar de similaridade para considerar que duas fontes descrevem o MESMO ato.
 * Alto de proposito: ver a nota sobre assimetria de erro em unir().
 */
const LIMIAR = 0.9;

/** Texto normalizado para comparacao: sem acento, pontuacao ou espaco duplo. */
function normalizarTexto(texto = '') {
  return texto
    .normalize('NFD')
    // Faixa de diacriticos combinantes, escapada: os bytes literais equivalentes
    // sao invisiveis no editor e ja se perderam em copia/colagem antes.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaccard sobre conjuntos de palavras — barato e suficiente aqui. */
function similaridade(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let comuns = 0;
  for (const t of A) if (B.has(t)) comuns++;
  return comuns / (A.size + B.size - comuns);
}

/** Agrupador: mesmo processo, mesmo dia. Dentro disso e que se compara texto. */
function chaveGrupo(pub) {
  return `${normalizarProcesso(pub.numeroProcesso)}|${pub.dataDisponibilizacao}`;
}

/**
 * Une as listas das duas fontes.
 *
 * Duas regras, e a segunda existe por causa de um erro real cometido antes:
 *
 * 1. DENTRO de uma fonte, nada e fundido. A fonte ja distingue seus proprios
 *    registros. Em 11/08/2026 o processo 1000130-40.2026.5.02.0467 tem duas
 *    notificacoes distintas (numeroComunicacao 33004 e 33005) cujos primeiros
 *    160 caracteres sao identicos, porque o cabecalho da vara e padronizado.
 *    Qualquer dedupe por prefixo de texto apagaria uma delas.
 *
 * 2. ENTRE fontes, so funde com similaridade alta (>= 0.9) do texto inteiro.
 *    O erro aqui e assimetrico: uma duplicata a mais no e-mail e chateacao;
 *    uma publicacao a menos e prazo perdido. Na duvida, mantem as duas.
 *
 * @param {Record<string, Publicacao[]>} porFonte  ex.: { CNJ: [...], Portal: [...] }
 */
export function unir(porFonte) {
  const grupos = new Map();
  const resumoFontes = {};
  const avisos = [];

  for (const [fonte, lista] of Object.entries(porFonte)) {
    resumoFontes[fonte] = lista.length;

    for (const pub of lista) {
      const chave = chaveGrupo(pub);
      if (!grupos.has(chave)) grupos.set(chave, []);
      const grupo = grupos.get(chave);
      const texto = normalizarTexto(pub.intimacao);

      // Só procura par entre registros de OUTRA fonte (regra 1).
      let alvo = null;
      let melhor = LIMIAR;
      for (const cand of grupo) {
        if (cand.fontes.includes(fonte)) continue;
        const s = similaridade(texto, cand._texto);
        if (s >= melhor) {
          melhor = s;
          alvo = cand;
        }
      }

      if (!alvo) {
        grupo.push({ ...pub, fontes: [fonte], _texto: texto });
        continue;
      }

      alvo.fontes.push(fonte);
      for (const campo of ['dataPublicacao', 'pagina', 'link', 'tribunal', 'vara', 'caderno']) {
        if (!alvo[campo] && pub[campo]) alvo[campo] = pub[campo];
      }
      // Listas ficam de fora do laco acima: [] e truthy, entao "!alvo[campo]"
      // nunca deixaria a outra fonte preencher um array vazio.
      for (const campo of ['partes', 'advogados']) {
        if (!alvo[campo]?.length && pub[campo]?.length) alvo[campo] = pub[campo];
      }
      if ((pub.intimacao || '').length > (alvo.intimacao || '').length) {
        alvo.intimacao = pub.intimacao;
        alvo._texto = texto;
      }
    }
  }

  const publicacoes = [...grupos.values()].flat().map(({ _texto, ...p }) => p);

  // Exclusividade de fonte e sinal operacional: ou a outra fonte falhou, ou
  // aquela publicacao so existe num dos diarios. Nos dois casos vale saber.
  const fontesAtivas = Object.keys(porFonte).filter((f) => porFonte[f].length > 0);
  if (fontesAtivas.length > 1) {
    for (const fonte of fontesAtivas) {
      const exclusivas = publicacoes.filter((p) => p.fontes.length === 1 && p.fontes[0] === fonte);
      if (exclusivas.length) {
        avisos.push(`${exclusivas.length} publicação(ões) vieram só de "${fonte}".`);
      }
    }
  }

  log.info(
    `Uniao: ${publicacoes.length} unica(s) a partir de ` +
      Object.entries(resumoFontes)
        .map(([f, n]) => `${f}=${n}`)
        .join(', '),
  );

  return { publicacoes, avisos, resumoFontes };
}
