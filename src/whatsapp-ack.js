/**
 * Confirmacao de envio do WhatsApp, sem depender do retorno quebrado de
 * sendMessage (undefined no Web 2.3000). O evento `message_ack` e o sinal
 * real: 1 = servidor recebeu, 2 = no aparelho, 3 = lida.
 *
 * Este arquivo nao importa whatsapp-web.js de proposito: a logica precisa
 * ser testavel sem abrir Chromium.
 */

export function ehNossa(m) {
  return Boolean(m?.fromMe ?? m?.id?.fromMe);
}

/**
 * Abaixo disto nao da para casar por prefixo sem risco de pegar o ack de outra
 * mensagem qualquer; acima, o prefixo ja identifica.
 */
const PREFIXO_MINIMO = 20;

/** NFC + espaco colapsado: o WhatsApp reescreve acento e quebra de linha. */
export function nucleoAck(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reconhece a nossa mensagem entre os acks que passam.
 *
 * Texto casa por PREFIXO normalizado, nao por igualdade do corpo inteiro:
 * o evento as vezes traz o body truncado, e um acento reescrito na volta
 * faria a comparacao exata perder o ack da propria mensagem que acabou de
 * sair. Anexo nao tem corpo — casa por ser nosso, ter midia, e ser recente
 * (senao um PDF antigo da mesma sessao poderia "confirmar" o envio atual).
 */
export function casaCom(conteudo, { desdeMs = Date.now() } = {}) {
  if (typeof conteudo !== 'string') {
    const desdeSeg = desdeMs / 1000 - 5;
    return (m) => ehNossa(m) && m.hasMedia && (m.timestamp == null || m.timestamp >= desdeSeg);
  }
  const nosso = nucleoAck(conteudo);
  return (m) => {
    if (!ehNossa(m)) return false;
    const corpo = nucleoAck(m.body);
    if (!corpo) return false;
    // Mensagem curta nao tem prefixo de 20 caracteres para comparar — casa
    // inteira. Sem esta linha ela NUNCA casaria: esperaria os 60s e o envio
    // bem-sucedido seria reportado como falha. E o mesmo erro que este arquivo
    // existe para nao cometer, so que ao contrario. Nenhuma mensagem da
    // producao e curta assim hoje, mas a proxima pode ser.
    if (nosso.length < PREFIXO_MINIMO) return corpo === nosso;
    const n = Math.min(80, nosso.length, corpo.length);
    return n >= PREFIXO_MINIMO && nosso.slice(0, n) === corpo.slice(0, n);
  };
}

/**
 * Espera o ack. Devolve { ack } ou { ack: null, motivo }.
 *
 * Mesma forma de aguardarReady, e pelo mesmo motivo: quem arma precisa poder
 * desarmar. Sem o cancel, o timer de 60s de um envio que ja terminou seguraria
 * o processo depois de o cliente ter sido destruido.
 *
 * Desconexao no meio do envio nao espera o timeout: e o mesmo buraco do
 * destroy() precoce, so que vindo da sessao caindo sozinha.
 */
export function esperarAck(client, casa, { timeoutMs = 60000, minimo = 1 } = {}) {
  let cancel;

  const promise = new Promise((resolve) => {
    let done = false;
    const onAck = (msg, ack) => {
      if (Number(ack) >= minimo && casa(msg)) settle({ ack: Number(ack) });
    };
    const onGone = (m) =>
      settle({ ack: null, motivo: `WhatsApp desconectou durante o envio (${m ?? ''})`.trim() });
    const timer = setTimeout(
      () => settle({ ack: null, motivo: `nao confirmou em ${timeoutMs / 1000}s` }),
      timeoutMs,
    );

    function settle(valor) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off('message_ack', onAck);
      client.off('disconnected', onGone);
      client.off('auth_failure', onGone);
      resolve(valor);
    }

    client.on('message_ack', onAck);
    client.on('disconnected', onGone);
    client.on('auth_failure', onGone);
    cancel = () => settle({ ack: null, motivo: 'cancelado' });
  });

  return { promise, cancel };
}
