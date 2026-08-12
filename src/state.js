import fs from 'node:fs';
import { config } from './config.js';

const EMPTY = {
  lastSuccessAt: null,
  lastError: null,
  /** { "2026-08-11": { esperado, extraido, completo, canaisEntregues, enviadoEm, ids } } */
  days: {},
};

export function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(config.paths.state, 'utf8')) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(state) {
  fs.writeFileSync(config.paths.state, JSON.stringify(state, null, 2));
}

/**
 * Identificador estavel de uma publicacao, para nao enviar a mesma duas vezes.
 * Prefere o "Identificador do documento" do portal; cai para processo+data.
 */
export function publicationId(pub) {
  return pub.identificador || `${pub.numeroProcesso}|${pub.dataDisponibilizacao}`;
}

/** Registro salvo de um dia, ou null se nunca rodou. */
export function dayRecord(dateISO) {
  return load().days[dateISO] ?? null;
}

/** Publicacoes ainda nao enviadas neste dia. */
export function filterNew(dateISO, publicacoes) {
  const known = new Set(dayRecord(dateISO)?.ids ?? []);
  return publicacoes.filter((p) => !known.has(publicationId(p)));
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
  const ids = [...new Set([...previous, ...publicacoes.map(publicationId)])];
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
  if (day.completo === false) return false;
  const entregues = canaisEntregues(day, canais);
  if (![...canais].every((c) => entregues.has(c))) return false;
  return day.extraido >= day.esperado;
}
