/**
 * Confirmacao de envio: matching do ack e espera, sem abrir o WhatsApp.
 *
 * O bug de 15/08 era destroy() com a mensagem na fila. A defesa e o ack —
 * e ela so vale se reconhecer a mensagem certa e nao esperar 60s quando a
 * sessao ja caiu.
 */
import { EventEmitter } from 'node:events';
import { casaCom, ehNossa, esperarAck } from '../src/whatsapp-ack.js';

let ok = 0;
let mal = 0;
const eq = (nome, obtido, esperado) => {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok    ${nome}`);
  } else {
    mal++;
    console.log(`  FALHA ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
  }
};

const resumo =
  '*OAB 437271* — 15/08/2026\n5 publicação(ões)\n\n*1. Intimação*\nProcesso: 0000000-00';

eq('ehNossa pelo fromMe', ehNossa({ fromMe: true, body: 'x' }), true);
eq('ehNossa pelo id.fromMe', ehNossa({ id: { fromMe: true } }), true);
eq('mensagem de outro nao e nossa', ehNossa({ fromMe: false, body: resumo }), false);

const casaTexto = casaCom(resumo);
eq(
  'casa o prefixo mesmo com o resto diferente',
  casaTexto({ fromMe: true, body: resumo + '\n...resto enorme...' }),
  true,
);
eq(
  'casa com o body truncado no evento (menos de 120 chars)',
  casaTexto({ fromMe: true, body: resumo.slice(0, 60) }),
  true,
);
eq(
  'NFD no evento ainda casa (acento reescrito)',
  casaTexto({ fromMe: true, body: resumo.normalize('NFD') }),
  true,
);
eq(
  'quebra extra ainda casa',
  casaTexto({ fromMe: true, body: resumo.replaceAll('\n', '\n\n') }),
  true,
);
eq('corpo de outra mensagem nao casa', casaTexto({ fromMe: true, body: 'oi, tudo bem?' }), false);

// Curta demais para ter prefixo: casa inteira. Se nao casasse, o envio teria
// dado certo e seria reportado como falha — o erro deste arquivo ao contrario.
const casaCurta = casaCom('✅ conectado');
eq('mensagem curta casa por igualdade', casaCurta({ fromMe: true, body: '✅ conectado' }), true);
eq('curta parecida nao casa', casaCurta({ fromMe: true, body: '✅ conectado?' }), false);
eq('ack de terceiros com o mesmo texto nao casa', casaTexto({ fromMe: false, body: resumo }), false);

const pdf = { mimetype: 'application/pdf', data: 'x' };
const casaPdf = casaCom(pdf, { desdeMs: Date.now() });
eq('anexo casa por midia nossa recente', casaPdf({ fromMe: true, hasMedia: true, timestamp: Date.now() / 1000 }), true);
eq('anexo antigo da sessao nao confirma o envio atual', casaPdf({ fromMe: true, hasMedia: true, timestamp: 1 }), false);
eq('texto nosso nao confirma anexo', casaPdf({ fromMe: true, hasMedia: false, body: resumo }), false);

const fake = () => {
  const e = new EventEmitter();
  // whatsapp-web.js usa on/off; EventEmitter tem os dois.
  return e;
};

{
  const c = fake();
  const { promise } = esperarAck(c, (m) => m.ok, { timeoutMs: 50, minimo: 1 });
  c.emit('message_ack', { ok: false }, 1);
  c.emit('message_ack', { ok: true }, 1);
  eq('ack da mensagem certa resolve', (await promise).ack, 1);
}

{
  const c = fake();
  const { promise } = esperarAck(c, () => true, { timeoutMs: 50, minimo: 1 });
  c.emit('message_ack', { fromMe: true }, 0);
  eq('ack 0 (pendente) nao confirma', (await promise).ack, null);
}

{
  const c = fake();
  const { promise } = esperarAck(c, () => true, { timeoutMs: 2000, minimo: 1 });
  c.emit('disconnected', 'LOGOUT');
  const r = await promise;
  eq('desconexao nao espera o timeout', r.ack, null);
  eq('e diz que desconectou', r.motivo.includes('desconectou'), true);
}

{
  const c = fake();
  const { promise, cancel } = esperarAck(c, () => true, { timeoutMs: 2000 });
  cancel();
  eq('cancel desarma sem ack', (await promise).ack, null);
  c.emit('message_ack', { fromMe: true }, 1);
  eq('ack depois do cancel e ignorado', (await promise).ack, null);
}

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
