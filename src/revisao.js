import { brToISO, config } from './config.js';
import { unir } from './merge.js';
import { deBR, ehDiaUtil, ehFimDeSemana, paraBR } from './prazo.js';
import { buscarNoCNJ } from './sources/cnj.js';
import { dayRecord, filterNew, load } from './state.js';

/**
 * Revisao do(s) dia(s) anterior(es): o que entrou no DJEN DEPOIS de o dia ter
 * sido fechado e por isso nunca foi enviado.
 *
 * O buraco que ela tapa e real e foi medido: em 13/08/2026 sairam as
 * publicacoes que existiam naquela hora; se uma tivesse entrado no diario a
 * noite, ninguem veria — o ultimo retry do dia e as 17h, e no dia seguinte o
 * pipeline so olha a data corrente. Publicacao que nao chega e prazo perdido,
 * entao a conferencia do dia anterior nao pode depender de alguem lembrar.
 *
 * SO A API DO CNJ, de proposito. Duas razoes:
 *
 *   1. o portal exige janela de Chrome viva, sessao autenticada e travessia da
 *      Cloudflare. Abrir tudo isso mais uma vez por dia, para um dia que
 *      quase sempre nao tem nada faltando, e muito custo e mais uma chance de
 *      a sessao quebrar bem na hora do dia corrente;
 *   2. a API responde igual para qualquer data passada. O portal, nao: de
 *      manha ele ainda mostra o dia anterior (ver docs/), e e justamente essa
 *      defasagem que a revisao existe para contornar do lado do CNJ.
 *
 * A contrapartida fica escrita na mensagem que sai: publicacao que so existe
 * nos diarios de MG e da Uniao (que so o portal agrega) nao entra nesta
 * conferencia. A revisao cobre o DJEN, nao o dia inteiro.
 */

const DIA_MS = 86400000;

/**
 * Teto de dias corridos que o passeio para tras percorre. Cobre um fim de
 * semana emendado com feriado sem risco de laco longo se REVISAO_DIAS vier alto.
 */
const MAX_PASSOS = 21;

/**
 * Dias a conferir antes de `dataBR`, do mais recente para o mais antigo.
 *
 * Pula sabado e domingo (o Diario nao circula, ver src/index.js) mas NAO pula
 * feriado: feriado tem publicacao — o robo roda neles de proposito, porque nao
 * ha lista confiavel de feriado forense e um palpite errado engoliria um dia
 * inteiro. Pular aqui teria o mesmo efeito, so que calado.
 */
export function diasParaRevisar(dataBR, quantidade = config.revisaoDias) {
  const alvo = deBR(dataBR);
  if (!alvo || quantidade <= 0) return [];

  const dias = [];
  let d = alvo;
  for (let passo = 0; passo < MAX_PASSOS && dias.length < quantidade; passo++) {
    // deBR devolve a data ao meio-dia UTC: subtrair 24h nao escorrega de dia
    // nem na virada do horario de verao.
    d = new Date(d.getTime() - DIA_MS);
    if (ehFimDeSemana(d)) continue;
    dias.push(paraBR(d));
  }
  return dias;
}

/**
 * Instalacao nova nao tem passado para revisar.
 *
 * Sem esta porta, a PRIMEIRA execucao do robo numa maquina limpa acharia o dia
 * anterior inteiro "nao enviado" — porque nao ha registro nenhum — e despejaria
 * um dia velho como se fosse novidade. Estado vazio significa "nunca rodou",
 * nao "falhou ontem".
 */
export function temHistorico() {
  return Object.keys(load().days).length > 0;
}

/**
 * Consulta a API do CNJ para um dia passado e devolve o que dele ainda nao foi
 * enviado, segundo o state.json.
 *
 * O dedupe e o mesmo do dia corrente (filterNew/publicationIds): compara contra
 * TODOS os identificadores ja registrados, entao publicacao que saiu pelo id do
 * portal nao volta aqui so por ter chegado agora com o id do CNJ.
 *
 * @param {boolean} [opcoes.dedupe]  false devolve tudo em `novas`, sem olhar o
 *   estado. E o que o --dry precisa: com o dedupe ligado a revisao quase sempre
 *   diz "nada ficou para tras" e o caminho de envio nunca aparece no teste a
 *   mao — a mesma razao pela qual o dry run do dia corrente ignora o dedupe.
 * @returns {Promise<{dataBR: string, dataISO: string, publicacoes: object[],
 *   novas: object[], completo: boolean, registro: object|null}>}
 */
export async function pendentesDoDia(dataBR, { dedupe = true } = {}) {
  const dataISO = brToISO(dataBR);
  const registro = dayRecord(dataISO);
  const cnj = await buscarNoCNJ(dataBR, {
    numeroOab: config.oab.numero,
    ufOab: config.oab.uf,
    // A varredura das 6 variantes de sufixo dispara quando a base vem vazia num
    // dia util (ver src/sources/cnj.js) — 6 consultas e ~9s a mais, tres vezes
    // por dia. Num dia que JA foi entregue isso nao compra nada: base vazia ali
    // so confirma o que o estado ja sabe, e o preco e risco de HTTP 429 na
    // fonte de que o dia corrente depende. Vale so no dia que nunca saiu, onde
    // "zero" pode mesmo ser publicacao gravada com sufixo.
    diaUtil: !registro && ehDiaUtil(deBR(dataBR)),
  });

  // Passa pelo unir() mesmo com uma fonte so: e ele que monta o campo
  // "identificadores" de que o dedupe do estado depende.
  const { publicacoes } = unir({ CNJ: cnj.publicacoes });

  return {
    dataBR,
    dataISO,
    publicacoes,
    novas: dedupe ? filterNew(dataISO, publicacoes) : publicacoes,
    completo: cnj.completo,
    registro,
  };
}
