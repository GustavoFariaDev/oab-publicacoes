import { log } from '../log.js';
import { brToISO } from '../config.js';

/**
 * Fonte 1: API publica de Comunicacoes Processuais do CNJ (DJEN).
 *
 * https://comunicaapi.pje.jus.br/api/v1/comunicacao
 *
 * Publica, sem autenticacao e sem Cloudflare — e por isso a fonte confiavel
 * do dia a dia. Porem NAO e completa: cobre o DJEN, e o portal da OAB agrega
 * tambem os diarios de MG e da Uniao. Medido em 01/07-11/08/2026: portal ~179,
 * API 152 (~15% a menos). Por isso ela e unida ao portal, nao usada sozinha.
 */
const BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const POR_PAGINA = 100;

/** Numero do processo so com digitos — chave de comparacao entre as fontes. */
export function normalizarProcesso(numero = '') {
  return String(numero).replace(/\D/g, '');
}

/**
 * Busca as comunicacoes de um dia.
 * @param {string} dataBR  dd/mm/aaaa
 * @param {{numeroOab: string, ufOab: string}} oab
 * @returns {Promise<{publicacoes: import('../merge.js').Publicacao[], completo: boolean}>}
 *   `completo` e false quando a API entregou menos itens do que ela mesma
 *   declarou (corpo.count) — o dia continua em aberto para o retry, do mesmo
 *   jeito que o guard-rail do portal em src/sources/portal.js.
 */
export async function buscarNoCNJ(dataBR, { numeroOab, ufOab }) {
  const dataISO = brToISO(dataBR);
  const todas = [];
  let pagina = 1;
  let declarado = null;

  for (;;) {
    const url =
      `${BASE}?numeroOab=${encodeURIComponent(numeroOab)}&ufOab=${encodeURIComponent(ufOab)}` +
      `&dataDisponibilizacaoInicio=${dataISO}&dataDisponibilizacaoFim=${dataISO}` +
      `&pagina=${pagina}&itensPorPagina=${POR_PAGINA}`;

    const resposta = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (!resposta.ok) {
      throw new Error(`API do CNJ respondeu HTTP ${resposta.status} (pagina ${pagina}).`);
    }

    const corpo = await resposta.json();
    const itens = corpo.items ?? [];
    if (declarado === null) declarado = corpo.count ?? itens.length;
    todas.push(...itens);

    // O parametro de pagina e "pagina". Atencao: "page" e aceito e IGNORADO
    // silenciosamente — devolve sempre a primeira pagina.
    if (itens.length === 0 || todas.length >= declarado) break;
    pagina += 1;
    if (pagina > 50) throw new Error('Paginacao do CNJ nao terminou — abortando por seguranca.');
  }

  const completo = todas.length >= (declarado ?? todas.length);
  if (!completo) {
    log.warn(`CNJ: declarou ${declarado} mas entregou ${todas.length}.`);
  }
  log.info(`CNJ: ${todas.length} comunicacao(oes) em ${dataBR}.`);

  return { publicacoes: todas.map(paraPublicacao), completo };
}

/** Converte o item da API para o formato comum das duas fontes. */
function paraPublicacao(item) {
  return {
    fonte: 'CNJ',
    identificador: String(item.id ?? item.hash ?? ''),
    dataDisponibilizacao: item.datadisponibilizacao || '',
    dataPublicacao: '',
    jornal: item.meiocompleto || 'Diário de Justiça Eletrônico Nacional',
    caderno: item.nomeClasse || '',
    tribunal: item.siglaTribunal || '',
    vara: item.nomeOrgao || '',
    titulo: item.tipoDocumento || item.tipoComunicacao || 'Publicação',
    pagina: '',
    numeroProcesso: item.numeroprocessocommascara || item.numero_processo || '',
    intimacao: (item.texto || '').replace(/\s+/g, ' ').trim(),
    link: item.link || '',
    // "polo" vem como A (ativo/autor) ou P (passivo/reu). Nem toda comunicacao
    // traz os dois lados — algumas so listam a parte intimada.
    partes: (item.destinatarios ?? [])
      .map((d) => ({ nome: (d.nome || '').trim(), polo: (d.polo || '').toUpperCase() }))
      .filter((p) => p.nome),
    advogados: (item.destinatarioadvogados ?? [])
      .map((d) => d.advogado?.nome)
      .filter(Boolean),
  };
}
