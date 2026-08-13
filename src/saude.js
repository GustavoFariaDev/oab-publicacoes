import { config } from './config.js';
import { deBR, ehDiaUtil } from './prazo.js';
import { canaisEntregues, load } from './state.js';

/**
 * O dia fechou como deveria?
 *
 * Existe por causa de um modo de falha real: o WhatsApp pode "entregar" sem
 * entregar (a biblioteca devolve `undefined` em vez de confirmacao, ver
 * docs/PENDENCIAS.md), e se o e-mail tambem nao sair, o dia inteiro some sem
 * ninguem perceber. Silencio e indistinguivel de "nao havia publicacao".
 *
 * Esta funcao NAO reenvia nada e nao consulta as fontes. Ela le o estado que a
 * execucao das 14h deixou e responde uma pergunta so: da para dormir tranquilo?
 *
 * @returns {{ok: boolean, problemas: string[]}}
 */
export function diagnosticarDia(dataISO, canais = config.canais) {
  const estado = load();
  const dia = estado.days[dataISO];
  const problemas = [];

  // Erro recente conta em qualquer dia, inclusive sabado: se o processo quebrou,
  // isso e problema mesmo sem publicacao nenhuma para entregar. Fica antes da
  // saida por dia nao util, de proposito.
  const HORAS = 12;
  const erroRecente =
    estado.lastError?.at && Date.now() - Date.parse(estado.lastError.at) < HORAS * 3600000;
  if (erroRecente) {
    problemas.push(`ultimo erro (${estado.lastError.stage}): ${estado.lastError.message}`);
  }

  // Dia sem expediente e sem registro nao e falha: nao havia o que entregar, e
  // o pipeline sai sem enviar (ver src/index.js). Alertar aqui seria alarme
  // falso todo fim de semana — o jeito mais rapido de ensinar alguem a ignorar
  // o alarme.
  // dataISO ("aaaa-mm-dd") e o formato ISO que deBR tambem aceita. Data que nao
  // deu para ler conta como dia util: na duvida, o vigia fala. Silencio por
  // engano e o unico erro que este arquivo nao pode cometer.
  const data = deBR(dataISO);
  const diaUtil = data ? ehDiaUtil(data) : true;
  if (!dia?.enviadoEm && !diaUtil) {
    return { ok: problemas.length === 0, problemas };
  }

  if (!dia?.enviadoEm) {
    problemas.push('a execucao do dia nao registrou nenhuma entrega');
    // Sem entrega registrada, os outros testes nao acrescentam nada.
    return { ok: false, problemas };
  }

  // Contra os canais CONFIGURADOS, nao contra um canal fixo. Cravar "e-mail"
  // aqui quebraria em duas direcoes: com CANAIS=whatsapp alertaria todo dia
  // sem motivo, e um canal novo no .env passaria despercebido.
  const entregues = canaisEntregues(dia, canais);
  const faltando = [...canais].filter((c) => !entregues.has(c));
  if (faltando.length) {
    problemas.push(`nao saiu por: ${faltando.join(', ')}`);
  }

  if (dia.completo !== true) {
    problemas.push('alguma fonte caiu ou veio incompleta — pode faltar publicacao');
  }

  if (dia.extraido < dia.esperado) {
    problemas.push(`coletadas ${dia.extraido} de ${dia.esperado} publicacoes esperadas`);
  }

  return { ok: problemas.length === 0, problemas };
}
