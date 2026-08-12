/**
 * Conecta o WhatsApp uma vez: mostra o QR no terminal e salva a sessao
 * em .wwebjs_auth/. Rode de novo se o WhatsApp derrubar a sessao.
 */
import qrcode from 'qrcode-terminal';
import { config } from '../src/config.js';
import { log } from '../src/log.js';
import { criarCliente } from '../src/whatsapp.js';

const client = criarCliente({
  onQR: (qr) => {
    console.log('\nEscaneie no celular: WhatsApp > Aparelhos conectados > Conectar aparelho\n');
    qrcode.generate(qr, { small: true });
  },
});

client.on('ready', async () => {
  log.info('WhatsApp conectado.');

  const numberId = await client.getNumberId(config.whatsappTo);
  if (!numberId) {
    log.error(`O numero ${config.whatsappTo} nao tem WhatsApp. Confira WHATSAPP_TO no .env.`);
  } else {
    await client.sendMessage(
      numberId._serialized,
      '✅ Automação de publicações da OAB conectada. A partir de agora você recebe aqui todo dia às 14h.',
    );
    log.info('Mensagem de teste enviada.');
  }

  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', (m) => {
  log.error('Falha de autenticacao:', m);
  process.exit(1);
});

await client.initialize();
