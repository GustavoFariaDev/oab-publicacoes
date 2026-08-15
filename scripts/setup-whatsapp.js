/**
 * Conecta o WhatsApp uma vez: mostra o QR no terminal e salva a sessao
 * em .wwebjs_auth/. Rode de novo se o WhatsApp derrubar a sessao.
 *
 * A mensagem de teste passa pelo mesmo enviarConferindo da producao — espera
 * ack e so depois destroi o cliente. Mandar e fechar na hora foi o bug que
 * engolia o envio do dia (ver docs/PENDENCIAS.md item 4).
 */
import qrcode from 'qrcode-terminal';
import { config } from '../src/config.js';
import { log } from '../src/log.js';
import { criarCliente, enviarConferindo } from '../src/whatsapp.js';

const client = criarCliente({
  onQR: (qr) => {
    console.log('\nEscaneie no celular: WhatsApp > Aparelhos conectados > Conectar aparelho\n');
    qrcode.generate(qr, { small: true });
  },
});

client.on('ready', async () => {
  log.info('WhatsApp conectado.');
  try {
    const numberId = await client.getNumberId(config.whatsappTo);
    if (!numberId) {
      log.error(`O numero ${config.whatsappTo} nao tem WhatsApp. Confira WHATSAPP_TO no .env.`);
      process.exitCode = 1;
    } else {
      await enviarConferindo(
        client,
        numberId._serialized,
        '✅ Automação de publicações da OAB conectada. A partir de agora você recebe aqui todo dia às 14h.',
        'a mensagem de teste',
      );
    }
  } catch (e) {
    log.error(e.message);
    process.exitCode = 1;
  } finally {
    await client.destroy().catch(() => {});
    process.exit(process.exitCode ?? 0);
  }
});

client.on('auth_failure', (m) => {
  log.error('Falha de autenticacao:', m);
  process.exit(1);
});

await client.initialize();
