import fs from 'node:fs';
import path from 'node:path';
import pkg from 'whatsapp-web.js';
import { config } from './config.js';
import { formatarPartes } from './merge.js';
import { resumirPrazo } from './prazo.js';
import { log } from './log.js';

const { Client, LocalAuth, MessageMedia } = pkg;

/** Cliente com sessao persistida em .wwebjs_auth/ (QR so na primeira vez). */
export function criarCliente({ onQR } = {}) {
  const client = new Client({
    // Caminho absoluto de proposito: relativo ao cwd, rodar de outra pasta
    // (Agendador, atalho) criaria uma sessao nova e pediria o QR de novo.
    authStrategy: new LocalAuth({ dataPath: path.join(config.paths.root, '.wwebjs_auth') }),
    puppeteer: { headless: true, args: ['--no-sandbox'] },
  });
  if (onQR) client.on('qr', onQR);
  return client;
}

/**
 * initialize() resolve antes de a sessao estar utilizavel — chamar getNumberId
 * logo em seguida da corrida ("numero invalido" com sessao boa). O sinal certo
 * de que da pra usar o cliente e o evento 'ready'.
 *
 * Devolve { promise, cancel } porque a espera e armada ANTES do initialize()
 * (senao o evento pode passar antes de haver ouvinte). Se o initialize falhar,
 * ninguem faz await na promise — sem o cancel, o timer de 90s dispararia depois
 * e derrubaria o processo com unhandled rejection.
 */
function aguardarReady(client, timeoutMs = 90000) {
  let cancel;

  const promise = new Promise((resolve, reject) => {
    let done = false;
    const onReady = () => settle(resolve);
    const onAuthFailure = (m) =>
      settle(reject, new Error(`Sessao do WhatsApp caiu (${m}). Rode "npm run setup:whatsapp".`));
    const onDisconnected = (m) =>
      settle(reject, new Error(`WhatsApp desconectou (${m}). Rode "npm run setup:whatsapp".`));

    const timer = setTimeout(
      () =>
        settle(
          reject,
          new Error('WhatsApp nao ficou pronto a tempo. Rode "npm run setup:whatsapp".'),
        ),
      timeoutMs,
    );

    function settle(fn, arg) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('auth_failure', onAuthFailure);
      client.off('disconnected', onDisconnected);
      fn(arg);
    }

    client.on('ready', onReady);
    client.on('auth_failure', onAuthFailure);
    client.on('disconnected', onDisconnected);

    cancel = () => settle(resolve);
  });

  // Marca a promise como tratada: se o caminho de erro pular o await, a
  // rejeicao nao vira unhandled. O await de verdade continua vendo o erro.
  promise.catch(() => {});

  return { promise, cancel };
}

/** Resumo curto — o que cabe na tela do celular. O inteiro teor vai no PDF. */
export function montarResumo({ dataBR, publicacoes, avisos = [], complemento = false }) {
  if (publicacoes.length === 0) {
    return `*OAB ${config.oab.numero}* — ${dataBR}\n\nNenhuma publicação hoje.`;
  }

  const prazos = publicacoes.map(resumirPrazo);
  const itens = publicacoes
    .map((p, i) => {
      const linhas = [`*${i + 1}. ${p.titulo || 'Publicação'}*`];
      if (p.numeroProcesso) linhas.push(`Processo: ${p.numeroProcesso}`);
      linhas.push(...formatarPartes(p.partes));
      if (p.vara) linhas.push(p.vara);
      // Antes daqui saia so "Prazo: 15 dias", o numero cru do texto. Sozinho
      // ele nao diz nada de util: o que decide a agenda e a DATA em que vence,
      // contada em dias uteis a partir do primeiro dia util apos a publicacao.
      if (prazos[i]) linhas.push(prazos[i]);
      return linhas.join('\n');
    })
    .join('\n\n');

  const alerta = avisos.length ? `⚠ ${avisos.join(' ')}\n\n` : '';
  const cabecalho = complemento
    ? `_complemento_ — +${publicacoes.length} publicação(ões)`
    : `${publicacoes.length} publicação(ões)`;
  // O rodape do vencimento nao e formalidade: a conta nao conhece feriado
  // municipal/forense nem prazo em dobro, e uma data estimada mais tarde que a
  // real faz perder prazo. Fica no fim, uma vez, em vez de repetir por item.
  const rodape = prazos.some((linha) => linha?.includes('vence'))
    ? '\n\n_Vencimentos são estimativa (dias úteis, art. 224 e 220 do CPC). ' +
      'Não incluem feriado local/forense nem prazo em dobro — confira no processo._'
    : '';
  return `${alerta}*OAB ${config.oab.numero}* — ${dataBR}\n${cabecalho}\n\n${itens}${rodape}`;
}

/**
 * Envia resumo + PDF.
 *
 * O anexo e best-effort: whatsapp-web.js engasga com PDF grande. Se o anexo
 * falhar, o texto ja foi entregue e mandamos o caminho local do arquivo. O
 * e-mail continua sendo a fonte da verdade — o zap e notificacao.
 */
export async function enviarWhatsApp({
  dataBR,
  publicacoes,
  avisos = [],
  pdfPath,
  complemento = false,
}) {
  const client = criarCliente();
  const ready = aguardarReady(client);

  try {
    await client.initialize();
    await ready.promise;

    const numberId = await client.getNumberId(config.whatsappTo);
    if (!numberId) {
      throw new Error(`O numero ${config.whatsappTo} nao tem WhatsApp ou esta invalido.`);
    }
    const chatId = numberId._serialized;

    await client.sendMessage(chatId, montarResumo({ dataBR, publicacoes, avisos, complemento }));
    log.info('WhatsApp: resumo enviado.');

    if (pdfPath && fs.existsSync(pdfPath)) {
      try {
        await client.sendMessage(chatId, MessageMedia.fromFilePath(pdfPath));
        log.info('WhatsApp: PDF enviado.');
      } catch (e) {
        log.warn('WhatsApp: falhou o anexo do PDF —', e.message);
        // Sem o canal de e-mail ligado, mandar o leitor "olhar no e-mail" seria
        // apontar para um lugar onde nada chegou: so resta o arquivo local.
        const onde = config.canais.has('email') ? 'no e-mail e em' : 'em';
        await client.sendMessage(chatId, `📄 PDF completo ${onde}:\n${pdfPath}`);
      }
    }
  } finally {
    // Antes do destroy: o proprio destroy emite 'disconnected', e desarmar o
    // timer aqui evita o processo ficar pendurado ate os 90s.
    ready.cancel();
    await client.destroy().catch(() => {});
  }
}

/**
 * Aviso de falha pelo zap — o equivalente do enviarEmailDeErro.
 *
 * Existe porque sem e-mail o aviso de erro nao teria por onde sair, e uma falha
 * silenciosa e indistinguivel de um dia sem publicacao. So o stack vai cortado:
 * no celular, o que importa e "quebrou e em que etapa"; o resto esta nos logs.
 */
export async function enviarWhatsAppDeErro(stage, error) {
  const client = criarCliente();
  const ready = aguardarReady(client);

  try {
    await client.initialize();
    await ready.promise;

    const numberId = await client.getNumberId(config.whatsappTo);
    if (!numberId) {
      throw new Error(`O numero ${config.whatsappTo} nao tem WhatsApp ou esta invalido.`);
    }

    await client.sendMessage(
      numberId._serialized,
      `🚨 *FALHA na automação da OAB*\n` +
        `Etapa: _${stage}_\n\n` +
        `${String(error?.message ?? error).slice(0, 400)}\n\n` +
        `⚠️ *Confira o portal manualmente hoje.*\n` +
        `Detalhes em state.json (lastError) e em logs/.`,
    );
    log.info('WhatsApp: aviso de falha enviado.');
  } finally {
    ready.cancel();
    await client.destroy().catch(() => {});
  }
}
