import fs from 'node:fs';
import path from 'node:path';
import pkg from 'whatsapp-web.js';
import { config } from './config.js';
import { formatarPartes, oabConstaComoAdvogado } from './merge.js';
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

/**
 * Envia e SO VOLTA quando o WhatsApp confirmou que a mensagem saiu.
 *
 * `sendMessage` devolve `undefined` contra o WhatsApp Web 2.3000 — a construcao
 * do modelo de retorno esta quebrada (na mesma sessao, getChats() e
 * getChatById() estouram com erro minificado). Durante um tempo isto aqui
 * tratou o retorno vazio como "limitacao cosmetica: a mensagem chega, so nao da
 * para conferir". Estava errado, e custou caro.
 *
 * Medido em 15/08/2026, com dois envios lado a lado: mandar e fechar o cliente
 * na hora NAO entrega; mandar, esperar 8s e fechar entrega. O `sendMessage`
 * volta antes de a mensagem sair, e o `client.destroy()` do bloco finally
 * matava o navegador com ela ainda na fila. O log dizia "resumo enviado" e o
 * celular nao recebia nada — o pior formato possivel de falha, porque o
 * advogado so descobre que ficou sem a publicacao quando o prazo ja passou.
 *
 * A confirmacao real existe e nao depende do retorno quebrado: o evento
 * `message_ack` funciona. ack 1 = o servidor do WhatsApp recebeu (dai em diante
 * a entrega e problema deles), 2 = chegou no aparelho, 3 = lida. Esperar ack
 * >= 1 e o que transforma "mandei" em "saiu".
 *
 * Sem ack, LANCA. Antes o silencio virava sucesso; agora vira canal pendente, e
 * o retry das 16h/17h tenta de novo. Uma mensagem repetida e chateacao, uma
 * publicacao que nao chegou e prazo.
 */
const ACK_TIMEOUT_MS = 60000;

async function enviarConferindo(client, chatId, conteudo, oQue) {
  // O ouvinte e armado ANTES do envio: o ack de mensagem curta chega em ~2s e
  // passaria antes de haver quem escutasse.
  const espera = esperarAck(client, casaCom(conteudo));
  try {
    await client.sendMessage(chatId, conteudo);
    const ack = await espera.promise;
    if (ack === null) {
      throw new Error(
        `WhatsApp: ${oQue} nao foi confirmado em ${ACK_TIMEOUT_MS / 1000}s. ` +
          'A mensagem provavelmente NAO saiu — o retry tentara de novo.',
      );
    }
    log.info(`WhatsApp: ${oQue} saiu, confirmado (ack=${ack}).`);
  } finally {
    espera.cancel();
  }
}

/**
 * Reconhece a nossa mensagem entre os acks que passam.
 *
 * Texto casa por prefixo, nao por igualdade: o WhatsApp normaliza o corpo (e o
 * resumo tem 1.6k caracteres, emoji e markdown), e um acento reescrito na volta
 * faria a comparacao exata perder o ack da propria mensagem que acabou de sair.
 * Anexo nao tem corpo para comparar — casa por ser nosso e ter midia.
 */
function casaCom(conteudo) {
  if (typeof conteudo !== 'string') return (m) => ehNossa(m) && m.hasMedia;
  const inicio = conteudo.slice(0, 120);
  return (m) => ehNossa(m) && String(m.body ?? '').slice(0, 120) === inicio;
}

const ehNossa = (m) => Boolean(m?.fromMe ?? m?.id?.fromMe);

/**
 * Espera o ack. Devolve o nivel alcancado, ou null se nao veio a tempo.
 *
 * Mesma forma de aguardarReady, e pelo mesmo motivo: quem arma precisa poder
 * desarmar. Sem o cancel, o timer de 60s de um envio que ja terminou seguraria
 * o processo depois de o cliente ter sido destruido.
 */
function esperarAck(client, casa, { timeoutMs = ACK_TIMEOUT_MS, minimo = 1 } = {}) {
  let cancel;

  const promise = new Promise((resolve) => {
    let done = false;
    const onAck = (msg, ack) => {
      if (ack >= minimo && casa(msg)) settle(ack);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);

    function settle(valor) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off('message_ack', onAck);
      resolve(valor);
    }

    client.on('message_ack', onAck);
    cancel = () => settle(null);
  });

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
      // O portal recorta por nome e pega processo em que voce e PARTE, ou
      // homonimo. Duvida a conferir, nunca descarte: o texto do portal vem
      // cortado e a linha do advogado pode nao ter vindo.
      if (!oabConstaComoAdvogado(p, config.oab.numero)) {
        linhas.push(`❓ Sua OAB não aparece no texto — pode ser você como parte, ou homônimo. Confira.`);
      }
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
  //
  // Vale para QUALQUER linha de prazo, nao so as que dizem "vence": o "contagem
  // começa" tambem e data calculada por nos, e depende dos mesmos feriados.
  const rodape = prazos.some(Boolean)
    ? '\n\n_Datas de prazo são estimativa (dias úteis, art. 224 e 220 do CPC). ' +
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

    await enviarConferindo(
      client,
      chatId,
      montarResumo({ dataBR, publicacoes, avisos, complemento }),
      'o resumo',
    );

    if (pdfPath && fs.existsSync(pdfPath)) {
      try {
        await enviarConferindo(client, chatId, MessageMedia.fromFilePath(pdfPath), 'o PDF');
      } catch (e) {
        log.warn('WhatsApp: falhou o anexo do PDF —', e.message);
        // Sem o canal de e-mail ligado, mandar o leitor "olhar no e-mail" seria
        // apontar para um lugar onde nada chegou: so resta o arquivo local.
        //
        // O resumo, que e o que importa, ja saiu confirmado — por isso a falha
        // do anexo nao derruba o envio. Mas o bilhete que a substitui passa
        // pela mesma confirmacao: mandar sem conferir foi o que criou este bug.
        const onde = config.canais.has('email') ? 'no e-mail e em' : 'em';
        await enviarConferindo(
          client,
          chatId,
          `📄 PDF completo ${onde}:\n${pdfPath}`,
          'o aviso do PDF',
        );
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

    await enviarConferindo(
      client,
      numberId._serialized,
      `🚨 *FALHA na automação da OAB*\n` +
        `Etapa: _${stage}_\n\n` +
        `${String(error?.message ?? error).slice(0, 400)}\n\n` +
        `⚠️ *Confira o portal manualmente hoje.*\n` +
        `Detalhes em state.json (lastError) e em logs/.`,
      'o aviso de falha',
    );
  } finally {
    ready.cancel();
    await client.destroy().catch(() => {});
  }
}
