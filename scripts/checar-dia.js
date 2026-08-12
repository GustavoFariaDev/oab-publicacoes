/**
 * Guarda-noturno: as 18h, confere se o dia fechou — e avisa se nao fechou.
 *
 * O buraco que ele tapa: a execucao das 14h pode terminar sem entregar nada e
 * sem ninguem saber. O WhatsApp "entrega" sem entregar (a biblioteca nao
 * confirma), o e-mail pode cair no spam, o PC pode ter ficado desligado. Em
 * todos esses casos o resultado que voce percebe e o mesmo: silencio. E
 * silencio hoje significa duas coisas opostas — "nao havia publicacao" e "a
 * automacao falhou".
 *
 * Ele NAO reenvia publicacao e NAO consulta as fontes. So le o estado.
 *
 * LIMITE, e vale dizer alto: este vigia mora na mesma maquina que ele vigia.
 * Se o PC estiver desligado, ele nao roda (a tarefa tem StartWhenAvailable,
 * entao dispara quando a maquina voltar — tarde, mas dispara). E se TODOS os
 * canais estiverem mortos, o aviso tambem nao sai. Vigia interno cobre falha
 * de parte; falha total so um vigia de fora cobriria.
 *
 *   npm run checar
 */
import { config, todayBR, todayISO } from '../src/config.js';
import { log } from '../src/log.js';
import { diagnosticarDia } from '../src/saude.js';
import { enviarEmailDeErro } from '../src/mailer.js';
import { enviarWhatsAppDeErro } from '../src/whatsapp.js';

const dataISO = todayISO();
const { ok, problemas } = diagnosticarDia(dataISO);

if (ok) {
  // Dia certo nao gera mensagem. Aviso diario de "esta tudo bem" vira ruido, e
  // ruido e o que faz um alerta ser ignorado no dia em que ele importa.
  log.info(`Checagem de ${todayBR()}: o dia fechou certo. Nada a avisar.`);
  process.exit(0);
}

log.warn(`Checagem de ${todayBR()}: ${problemas.length} problema(s) — avisando.`);
for (const p of problemas) log.warn(`  - ${p}`);

const erro = new Error(
  `A execução de ${todayBR()} não fechou como deveria:\n\n` +
    problemas.map((p) => `• ${p}`).join('\n') +
    '\n\nConfira o portal da OAB manualmente hoje.',
);

// Todos os canais ligados, cada um em try proprio: o canal caido e justamente
// o suspeito, e nao pode levar junto o aviso que sairia pelo outro.
for (const [canal, avisar] of [
  ['email', enviarEmailDeErro],
  ['whatsapp', enviarWhatsAppDeErro],
]) {
  if (!config.canais.has(canal)) continue;
  try {
    await avisar('checagem-do-dia', erro);
  } catch (e) {
    log.error(`Nao consegui avisar por ${canal}:`, e.message);
  }
}

process.exitCode = 1;
