import fs from 'node:fs';
import { config } from './config.js';

const EMPTY = {
  lastSuccessAt: null,
  lastError: null,
  /**
   * { "2026-08-11": { esperado, extraido, completo, canaisEntregues, enviadoEm,
   *                   revisadoEm?, ids } }
   * revisadoEm so aparece nos dias em que a revisao do dia seguinte achou
   * publicacao atrasada e a mandou (ver recordComplemento).
   */
  days: {},
};

export function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(config.paths.state, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

/**
 * Dias guardados. Passado isso, o registro so ocupa espaco: o dedupe olha o
 * dia da publicacao, e nenhum run consulta um dia de tres meses atras.
 */
const DIAS_GUARDADOS = 120;

function podar(state) {
  const limite = new Date(Date.now() - DIAS_GUARDADOS * 86400000).toISOString().slice(0, 10);
  for (const dia of Object.keys(state.days)) {
    // Comparacao de string funciona porque a chave e ISO (aaaa-mm-dd).
    if (dia < limite) delete state.days[dia];
  }
  return state;
}

function save(state) {
  // Escreve em arquivo temporario e renomeia: se a maquina cair no meio da
  // escrita, o state.json antigo continua inteiro em vez de virar JSON pela
  // metade — que o load() trataria como "nunca rodou" e reenviaria tudo.
  const tmp = `${config.paths.state}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(podar(state), null, 2));
  fs.renameSync(tmp, config.paths.state);
}

/**
 * TODOS os identificadores conhecidos de uma publicacao, para nao enviar a
 * mesma duas vezes mesmo quando o merge muda de forma entre execucoes.
 *
 * Uma publicacao que hoje as 14h so tem o CNJ fora do ar sai com o id do
 * Portal. Se o CNJ volta as 16h, unir() processa as fontes na mesma ordem de
 * sempre (CNJ primeiro) e o grupo passa a carregar o id do CNJ — o id
 * top-level muda mesmo sendo a MESMA publicacao. Por isso o id "estavel"
 * aqui e o conjunto de tudo que ja identificou essa publicacao, nao um
 * unico valor: basta UM deles bater com o que ja foi enviado.
 */
export function publicationIds(pub) {
  const ids = new Set();
  for (const id of Object.values(pub.identificadores ?? {})) {
    if (id) ids.add(id);
  }
  if (pub.identificador) ids.add(pub.identificador);
  // "processo|data" so entra quando NENHUM id de fonte existe. E chave de
  // GRUPO em merge.js, nao de identidade: duas intimacoes distintas do mesmo
  // processo no mesmo dia (33004 e 33005, ver a nota em merge.js) cairiam no
  // mesmo grupo mas tem id proprio cada uma. Adicionar o fallback sempre
  // faria a segunda parecer "ja enviada" so por compartilhar processo+data
  // com a primeira.
  if (ids.size === 0) {
    ids.add(`${pub.numeroProcesso}|${pub.dataDisponibilizacao}`);
  }
  return [...ids];
}

/** Registro salvo de um dia, ou null se nunca rodou. */
export function dayRecord(dateISO) {
  return load().days[dateISO] ?? null;
}

/** Publicacoes ainda nao enviadas neste dia. */
export function filterNew(dateISO, publicacoes) {
  const known = new Set(dayRecord(dateISO)?.ids ?? []);
  return publicacoes.filter((p) => !publicationIds(p).some((id) => known.has(id)));
}

/**
 * Canais que ja receberam este dia.
 *
 * Registros gravados antes deste campo existir nao tem a lista. Assumir "todos
 * entregaram" nesse caso e deliberado: sem isso, o primeiro retry apos a
 * atualizacao reenviaria dias ja resolvidos por todos os canais.
 */
export function canaisEntregues(day, canais = config.canais) {
  if (!day) return new Set();
  if (Array.isArray(day.canaisEntregues)) return new Set(day.canaisEntregues);
  return day.enviadoEm ? new Set(canais) : new Set();
}

/**
 * @param {object} dados
 * @param {boolean} dados.completo    todas as fontes ligadas entregaram tudo
 * @param {Set<string>|string[]} dados.entregues  canais que ja receberam o dia
 */
export function recordSuccess(dateISO, { esperado, extraido, publicacoes, completo, entregues }) {
  const state = load();
  const previous = state.days[dateISO]?.ids ?? [];
  const ids = [...new Set([...previous, ...publicacoes.flatMap(publicationIds)])];
  state.days[dateISO] = {
    esperado,
    extraido,
    completo,
    canaisEntregues: [...entregues],
    enviadoEm: new Date().toISOString(),
    ids,
  };
  state.lastSuccessAt = new Date().toISOString();
  state.lastError = null;
  save(state);
}

/**
 * Acrescenta a um dia JA FECHADO as publicacoes que a revisao do dia seguinte
 * encontrou atrasadas (ver src/revisao.js).
 *
 * Existe separado do recordSuccess porque o que ele NAO pode fazer e o ponto:
 *
 *   - nao sobrescreve esperado/extraido com os numeros da revisao. A revisao ve
 *     so a API do CNJ; o registro original contou tambem o portal. Trocar 5 por
 *     3 faria o dia parecer que encolheu, e diagnosticarDia passaria a acusar
 *     "coletadas 3 de 5" para sempre. Os dois sobem juntos pelo tanto que
 *     entrou, que e o unico numero que a revisao sabe de verdade;
 *   - nao promove `completo` a true. Se o portal caiu naquele dia, ele continua
 *     caido — uma conferencia que nao olhou o portal nao tem como absolver o
 *     portal. So um dia SEM registro nenhum recebe a opiniao da revisao;
 *   - nao mexe em lastError. A revisao roda depois do dia corrente, e limpar o
 *     erro dele aqui esconderia justamente o que o retry das 16h/17h precisa ler.
 *
 * So e chamada quando TODOS os canais entregaram o complemento (ver
 * src/index.js): gravar id que saiu pela metade faria a proxima revisao
 * considerar a publicacao resolvida e o canal que falhou nunca receberia.
 *
 * @param {boolean} completo  opiniao da revisao, usada so se o dia nao tem registro
 */
export function recordComplemento(dateISO, { publicacoes, completo }) {
  const state = load();
  const anterior = state.days[dateISO] ?? null;
  const previous = anterior?.ids ?? [];
  const ids = [...new Set([...previous, ...publicacoes.flatMap(publicationIds)])];
  const novos = ids.length - previous.length;

  state.days[dateISO] = {
    ...anterior,
    esperado: (anterior?.esperado ?? 0) + novos,
    extraido: (anterior?.extraido ?? 0) + novos,
    completo: anterior ? anterior.completo : completo,
    // Uniao, nao substituicao: se CANAIS encolheu desde aquele dia, o canal que
    // saiu da configuracao ainda recebeu o lote original, e apagar isso do
    // registro reescreveria o passado.
    canaisEntregues: [...new Set([...(anterior?.canaisEntregues ?? []), ...config.canais])],
    enviadoEm: new Date().toISOString(),
    revisadoEm: new Date().toISOString(),
    ids,
  };
  save(state);
}

/**
 * Registra a falha com a etapa em que ocorreu. Como a tarefa roda sem terminal,
 * este campo e o principal diagnostico depois do fato.
 */
export function recordError(stage, error) {
  const state = load();
  state.lastError = {
    at: new Date().toISOString(),
    stage,
    message: error?.message ?? String(error),
  };
  save(state);
}

/**
 * Um dia esta "resolvido" quando nao sobrou NADA a fazer por ele:
 *
 *   1. saiu (enviadoEm);
 *   2. saiu por TODO canal ligado — se o e-mail entregou e o zap caiu, o dia
 *      chegou pela metade e o retry precisa completar o canal que faltou;
 *   3. nenhuma fonte ligada caiu ou veio pela metade (completo) — um portal
 *      fora do ar as 14h so tem antidoto se as 16h tentarem de novo;
 *   4. a contagem bateu.
 *
 * Qualquer "nao" aqui deixa o dia em aberto para os retries das 16h/17h.
 */
export function isDayComplete(dateISO, canais = config.canais) {
  const day = load().days[dateISO];
  if (!day || !day.enviadoEm) return false;
  // "!== true", nao "=== false": registros gravados antes deste campo existir
  // nao tem opiniao sobre a completude das fontes. Ao contrario de
  // canaisEntregues (onde assumir "entregue" evita reenvio em massa no dia da
  // troca), aqui o custo de assumir errado e maior — entao a duvida vira UM
  // retry extra, nao um "provavelmente esta tudo bem".
  if (day.completo !== true) return false;
  const entregues = canaisEntregues(day, canais);
  if (![...canais].every((c) => entregues.has(c))) return false;
  return day.extraido >= day.esperado;
}
