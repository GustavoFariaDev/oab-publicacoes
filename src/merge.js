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

/** Palavras unicas de um texto ja normalizado. */
function palavras(texto = '') {
  return new Set(texto.split(' ').filter(Boolean));
}

/**
 * Quanto do texto MENOR cabe dentro do maior (|A∩B| / |menor|).
 *
 * Nao e Jaccard, e a troca foi medida: o portal da OAB corta o texto da
 * intimacao em ~986 caracteres e termina com "...", enquanto a API do CNJ
 * entrega o inteiro teor. No dia 12/08/2026 os cinco pares reais da mesma
 * publicacao davam Jaccard 0,18 a 0,82 — abaixo de qualquer limiar util, e um
 * deles (texto de 7805 caracteres contra 986) despencava justamente por ser o
 * mais longo. Pela contencao, os mesmos cinco pares deram 0,97 a 1,00.
 *
 * Jaccard pergunta "estes dois textos sao o mesmo texto?". Aqui a pergunta e
 * outra: "este resumo e o comeco daquele inteiro teor?".
 */
function contencao(A, B) {
  if (!A.size || !B.size) return 0;
  let comuns = 0;
  for (const t of A) if (B.has(t)) comuns++;
  return comuns / Math.min(A.size, B.size);
}

/**
 * Piso de tamanho para a contencao valer.
 *
 * Contencao e generosa por natureza: um texto de cinco palavras cabe dentro de
 * quase qualquer coisa. Abaixo deste piso, duas intimacoes curtas e
 * padronizadas ("Ciencia as partes.") seriam declaradas a mesma publicacao.
 */
const MINIMO_PALAVRAS = 15;

/** O portal corta a intimacao e marca o corte com reticencias. */
const truncado = (texto = '') => /\.\.\.\s*$/.test(texto);

/**
 * Entre os textos das duas fontes para a MESMA publicacao, qual fica.
 *
 * Comprimento sozinho nao serve, e o caso real esta em 12/08/2026, processo
 * 4000001-00.2025.8.26.0000: a API entregou 470 caracteres inteiros e o portal
 * 986 truncados. "Fica o maior" escolhia a previa cortada e o advogado recebia
 * a intimacao pela metade — com mais caracteres.
 *
 * Entao: texto inteiro ganha de texto cortado, sempre. Entre dois inteiros (ou
 * dois cortados), ganha o maior.
 */
function melhorTexto(candidato = '', atual = '') {
  if (truncado(atual) && !truncado(candidato)) return true;
  if (truncado(candidato) && !truncado(atual)) return false;
  return candidato.length > atual.length;
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
 *    registros. Em 11/08/2026 o processo 1000000-00.2026.5.02.0000 tem duas
 *    notificacoes distintas (numeroComunicacao dois numeros de comunicacao distintos) cujos primeiros
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
      const tokens = palavras(texto);

      // Só procura par entre registros de OUTRA fonte (regra 1).
      let alvo = null;

      // Prova antes de indício: o "Identificador do documento" que o portal
      // mostra é o mesmo número que a API do CNJ devolve como "id". Quando os
      // dois existem e batem, é a mesma publicação e não há o que comparar.
      // (Nem toda publicação do portal traz esse campo — as que não vêm do
      // DJEN não têm. Por isso ele resolve parte dos casos, não todos.)
      if (pub.identificador) {
        alvo =
          grupo.find(
            (cand) =>
              !cand.fontes.includes(fonte) &&
              Object.values(cand.identificadores).includes(pub.identificador),
          ) ?? null;
      }

      if (!alvo) {
        let melhor = LIMIAR;
        for (const cand of grupo) {
          if (cand.fontes.includes(fonte)) continue;
          if (Math.min(tokens.size, cand._tokens.size) < MINIMO_PALAVRAS) continue;
          const s = contencao(tokens, cand._tokens);
          if (s >= melhor) {
            melhor = s;
            alvo = cand;
          }
        }
      }

      if (!alvo) {
        grupo.push({
          ...pub,
          fontes: [fonte],
          _texto: texto,
          _tokens: tokens,
          // Guarda o identificador de CADA fonte que contribuiu, nao so da que
          // criou o grupo. O identificador top-level (pub.identificador) muda
          // conforme qual fonte chega primeiro nesta execucao (ordem de
          // Object.entries, e se uma fonte caiu na varredura anterior) — nao e
          // seguro para dedupe sozinho. Ver publicationIds() em state.js.
          identificadores: { [fonte]: pub.identificador },
        });
        continue;
      }

      alvo.fontes.push(fonte);
      alvo.identificadores[fonte] = pub.identificador;
      for (const campo of ['dataPublicacao', 'pagina', 'link', 'tribunal', 'vara', 'caderno']) {
        if (!alvo[campo] && pub[campo]) alvo[campo] = pub[campo];
      }
      // Listas ficam de fora do laco acima: [] e truthy, entao "!alvo[campo]"
      // nunca deixaria a outra fonte preencher um array vazio.
      for (const campo of ['partes', 'advogados']) {
        if (!alvo[campo]?.length && pub[campo]?.length) alvo[campo] = pub[campo];
      }
      if (melhorTexto(pub.intimacao, alvo.intimacao)) {
        alvo.intimacao = pub.intimacao;
        alvo._texto = texto;
        alvo._tokens = tokens;
      }
    }
  }

  // Os dois campos de trabalho saem aqui. _tokens e um Set: escapar daqui o
  // levaria ao PDF, ao e-mail e ao JSON do estado, onde vira "{}" silencioso.
  const publicacoes = [...grupos.values()].flat().map(({ _texto, _tokens, ...p }) => p);

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
