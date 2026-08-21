import { log } from './log.js';
import { buscarPorProcesso } from './sources/cnj.js';

/**
 * Completa o texto das publicacoes que o portal entregou cortadas.
 *
 * O PORQUE. O portal da OAB corta a intimacao em ~986 caracteres e marca o
 * corte com reticencias — medido em 21/08/2026: as SETE publicacoes de 19/08
 * vieram cortadas, sem excecao. Quando a mesma publicacao tambem vem da API do
 * CNJ, a uniao ja fica com o inteiro teor (ver melhorTexto em merge.js). O
 * problema e a publicacao que SO existe no portal: dela sai a previa cortada, e
 * o PDF que promete inteiro teor entrega um pedaco.
 *
 * O CAMINHO ESCOLHIDO, e por que nao o obvio. O obvio seria abrir cada
 * publicacao no portal. Nao da: o portal nao tem tela de detalhe — o texto
 * completo so sai pelo menu "Exportar", que e um postback com modal de
 * confirmacao e download de RTF/TXT. Mais navegacao, mais seletor, mais
 * Cloudflare, e um formato a parsear, tudo dentro da fonte que ja e a fragil.
 *
 * O caminho barato usa a fonte que nao tem nada disso: a publicacao e buscada
 * na API do CNJ PELO NUMERO DO PROCESSO. Ela some da consulta por inscricao
 * quando o advogado nao esta constituido ali (o portal recorta por nome, e pega
 * processo em que voce e parte, ou em que outro advogado atua) — mas continua
 * no DJEN, com id, texto inteiro e certidao. Conferido em 21/08/2026 contra a
 * unica publicacao portal-only de 19/08: HTTP 200, uma comunicacao, texto
 * completo de 802 caracteres.
 *
 * O QUE ISTO NAO RESOLVE. Duas coisas, e a primeira NAO e a que parecia.
 *
 * Escrevi aqui, antes de medir, que publicacao de MG ou da Uniao nao esta no
 * DJEN. Estava errado: medido em 21/08/2026 nos dias 14 a 21/08, das 5
 * publicacoes que so o portal trouxe, 4 estavam no DJEN — inclusive uma do
 * Diario de Minas Gerais e uma do Diario da Uniao. O que as esconde nao e o
 * diario, e a CONSULTA: a busca por inscricao nao acha o que nao esta em nome
 * da sua OAB.
 *
 * O que de fato continua cortado:
 *   - processo com MAIS DE UMA comunicacao naquele dia. A guarda se recusa a
 *     escolher, e e o caso real de 21/08 (o processo de MG tinha duas);
 *   - processo com numeracao antiga, fora do padrao CNJ ("934/15", visto em
 *     20/08). Consultar por numero de processo nem se aplica ali.
 *
 * O aviso de corte no PDF e o que sobra para essas.
 */

/** O portal corta a intimacao e marca o corte com reticencias. */
const truncado = (texto = '') => /\.\.\.\s*$/.test(texto);

/**
 * Teto de consultas por execucao.
 *
 * O limite de requisicao da API e indocumentado e baixo (ver a nota das
 * variantes de sufixo em sources/cnj.js), e esta fonte e a mesma de que o
 * envio do dia depende. Completar texto e conforto; perder a coleta por 429 e
 * prazo. Na pratica isto quase nunca e atingido: sao 1 ou 2 por dia.
 */
const MAX_CONSULTAS = 5;

/** Pausa entre consultas, pelo mesmo motivo. */
const PAUSA_MS = 1500;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Devolve a lista com os textos cortados completados onde deu.
 *
 * NAO altera `fontes`. Parece detalhe e nao e: `fontes` responde "quem trouxe
 * esta publicacao", e oabConstaComoAdvogado() confia nele para decidir se a
 * inscricao consta como advogado — publicacao vinda do CNJ conta por definicao,
 * porque a consulta la e por inscricao. Aqui a consulta foi por PROCESSO, que
 * nao prova nada sobre quem advoga. Marcar "CNJ" aqui apagaria justamente o
 * "❓ sua OAB nao aparece no texto" das publicacoes em que ele mais importa.
 *
 * `buscar` e injetavel para o teste rodar sem rede — mesma ideia do STATE_PATH
 * em state.js: a regra que decide QUANDO aceitar um texto de fora e a parte
 * que precisa de teste, e ela nao deve depender da API estar no ar.
 *
 * @param {import('./merge.js').Publicacao[]} publicacoes
 * @param {{buscar?: typeof buscarPorProcesso, pausaMs?: number}} [opcoes]
 * @returns {Promise<{publicacoes: import('./merge.js').Publicacao[], avisos: string[]}>}
 */
export async function completarInteiroTeor(publicacoes = [], { buscar = buscarPorProcesso, pausaMs = PAUSA_MS } = {}) {
  const avisos = [];
  const alvos = publicacoes.filter(
    (p) => truncado(p.intimacao) && !p.fontes?.includes('CNJ') && p.numeroProcesso && p.dataDisponibilizacao,
  );
  if (!alvos.length) return { publicacoes, avisos };

  log.info(`Inteiro teor: ${alvos.length} publicacao(oes) cortada(s) — buscando o texto no DJEN por processo.`);

  let consultas = 0;
  let completadas = 0;
  const semTexto = [];

  for (const pub of alvos) {
    if (consultas >= MAX_CONSULTAS) {
      avisos.push(
        `TEXTO CORTADO: ${alvos.length - consultas} publicação(ões) do portal ficaram com o texto ` +
          'truncado — o limite de consultas ao DJEN foi atingido nesta execução. Leia o inteiro teor no processo.',
      );
      break;
    }

    if (consultas) await dormir(pausaMs);
    consultas++;

    let candidatos;
    try {
      candidatos = await buscar(pub.numeroProcesso, pub.dataDisponibilizacao);
    } catch (e) {
      // Falhar aqui nao pode custar a publicacao: ela ja existe, so cortada.
      log.warn(`Inteiro teor: consulta do processo ${pub.numeroProcesso} falhou (${e.message}).`);
      semTexto.push(pub.numeroProcesso);
      continue;
    }

    // So aceita quando ha UMA comunicacao daquele processo naquele dia. Com
    // duas nao da para saber qual e esta — o mesmo processo tem intimacoes
    // distintas no mesmo dia (o caso do TRT2 em merge.js), e colar o texto
    // errado numa publicacao e pior do que entregar a certa pela metade.
    const unico = candidatos.length === 1 ? candidatos[0] : null;
    if (!unico || truncado(unico.intimacao) || !unico.intimacao) {
      semTexto.push(pub.numeroProcesso);
      continue;
    }

    pub.intimacao = unico.intimacao;
    // A certidao vem de brinde, e e o documento oficial daquela intimacao.
    if (!pub.certidao && unico.certidao) pub.certidao = unico.certidao;
    pub.textoCompletadoPor = 'DJEN (consulta por processo)';
    completadas++;
  }

  if (completadas) {
    log.info(`Inteiro teor: ${completadas} texto(s) completado(s) pelo DJEN.`);
  }
  if (semTexto.length) {
    // Aviso, e nao silencio: o advogado precisa saber que aquele texto esta
    // pela metade antes de decidir que ja leu a publicacao.
    avisos.push(
      `TEXTO CORTADO: ${semTexto.length} publicação(ões) vieram só do portal, que corta a intimação ` +
        `(processo${semTexto.length > 1 ? 's' : ''} ${semTexto.join(', ')}). ` +
        'Não estão no DJEN — leia o inteiro teor no processo.',
    );
  }

  return { publicacoes, avisos };
}
