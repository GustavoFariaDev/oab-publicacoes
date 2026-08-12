import { config } from './config.js';
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

  // Erro recente. Janela de horas em vez de comparar a data: lastError.at e
  // UTC e dataISO e Sao Paulo, entao das 21h em diante os dois "dias" deixam de
  // bater e o erro passaria batido justamente numa execucao noturna.
  const HORAS = 12;
  if (estado.lastError?.at && Date.now() - Date.parse(estado.lastError.at) < HORAS * 3600000) {
    problemas.push(`ultimo erro (${estado.lastError.stage}): ${estado.lastError.message}`);
  }

  return { ok: problemas.length === 0, problemas };
}
