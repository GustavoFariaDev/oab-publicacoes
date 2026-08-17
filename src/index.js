import { brToISO, config, isDryRun, targetDateBR } from './config.js';
import { deBR, ehDiaUtil, ehFimDeSemana } from './prazo.js';
import { log } from './log.js';
import { coletar } from './coletar.js';
import { gerarPDF } from './pdf.js';
import { enviarEmail, enviarEmailDeErro } from './mailer.js';
import { enviarWhatsApp, enviarWhatsAppDeErro } from './whatsapp.js';
import { diasParaRevisar, pendentesDoDia, temHistorico } from './revisao.js';
import {
  canaisEntregues,
  dayRecord,
  filterNew,
  isDayComplete,
  recordComplemento,
  recordError,
  recordSuccess,
} from './state.js';

/** Como despachar cada canal. A ordem de tentativa vem de config.canais. */
const ENVIAR = { email: enviarEmail, whatsapp: enviarWhatsApp };

/**
 * Avisa que quebrou, por todo canal ligado. Cada um em try proprio: o canal
 * caido e justamente o suspeito de ter causado a falha, e nao pode levar junto
 * o aviso que ainda tinha como sair pelo outro.
 */
async function notificarFalha(stage, error) {
  for (const [canal, avisar] of [
    ['email', enviarEmailDeErro],
    ['whatsapp', enviarWhatsAppDeErro],
  ]) {
    if (!config.canais.has(canal)) continue;
    try {
      await avisar(stage, error);
    } catch (e) {
      log.error(`Nao consegui nem enviar o aviso de falha por ${canal}:`, e.message);
    }
  }
}

/**
 * Escreve em lastError o que ainda falta depois de um recordSuccess.
 *
 * recordSuccess sempre zera lastError (senao a mensagem de sucesso nao
 * "ganharia" da de erro anterior) — mas se sobrou pendencia (canal que
 * falhou, fonte que veio incompleta, ou os dois), o retry das 16h/17h so tem
 * esse campo pra saber o motivo, porque a tarefa roda sem terminal. Uma
 * chamada so, juntando os dois motivos: chamar recordError duas vezes faria
 * a segunda apagar a primeira, ja que e um slot so.
 */
function registrarPendencias(coleta, falhasCanal) {
  const problemas = falhasCanal.map(([canal, e]) => `canal ${canal}: ${e.message}`);
  if (!coleta.completo) problemas.push(`fonte incompleta: ${coleta.avisos.join(' | ')}`);
  if (problemas.length) {
    recordError('coleta', new Error(problemas.join(' | ')));
  }
}

/**
 * Um dia: scrape -> PDF -> e-mail -> WhatsApp -> estado.
 *
 * Nunca relanca: o que quebra vira lastError, aviso pelos canais e
 * process.exitCode = 1. E de proposito — a revisao do dia anterior roda depois
 * desta, e um dia corrente que falhou nao pode impedir a conferencia de ontem.
 */
async function processarDia(dataBR, dry) {
  const dataISO = brToISO(dataBR);
  let stage = 'inicio';

  // ATENCAO ao mexer aqui: o --retry NAO pode desistir antes de coletar.
  //
  // Ate 12/08/2026 ele saia direto quando isDayComplete(dia) era true. Parecia
  // economia — o dia ja saiu, para que consultar de novo? — mas confundia duas
  // coisas: "nenhuma fonte falhou" (que e o que "completo" mede) com "nada mais
  // pode chegar", que no dia corrente nunca e verdade. Publicacao entra no DJEN
  // ao longo do dia; uma que aparecesse depois das 14h nao seria vista as 16h
  // nem as 17h, e o retry existe exatamente para isso.
  //
  // Coletar de novo custa uma consulta. Quem decide se manda alguma coisa e o
  // dedupe la embaixo: se nao ha publicacao nova nem canal pendente, o run
  // termina sem enviar nada. O estado so serve para dizer o que ja foi.
  if (process.argv.includes('--retry') && isDayComplete(dataISO)) {
    log.info(`Retry: ${dataBR} ja saiu por todos os canais — conferindo se entrou algo novo.`);
  }

  log.info(`=== OAB publicacoes — ${dataBR}${dry ? ' (DRY RUN)' : ''} ===`);

  try {
    stage = 'coleta';
    const coleta = await coletar(dataBR);
    const { publicacoes, resumoFontes } = coleta;
    // Depois da uniao, o total e sempre >= o de cada fonte: esta comparacao nao
    // e um guard-rail, e so o registro do que veio. Quem denuncia publicacao
    // faltando e "coleta.completo" — vem do resumo do dia contado pelo proprio
    // portal, que e a unica contagem independente da nossa extracao.
    const esperado = Math.max(publicacoes.length, ...Object.values(resumoFontes));
    const extraido = publicacoes.length;
    // screenshotPath vem da coleta (so o portal produz print) e pode ser null:
    // o print e best-effort e o mailer ja confere existencia antes de anexar.
    const resultado = { ...coleta, dataBR, esperado, extraido };
    log.info(`Coletadas ${extraido} publicacao(oes). Fontes: ${JSON.stringify(resumoFontes)}`);

    // Dedupe: num segundo run do mesmo dia (retry apos falha, ou "once" rodado
    // duas vezes) so vai o que ainda nao foi enviado. Na primeira execucao do
    // dia, "novas" e a lista inteira. O dry run ignora isso — e ferramenta de
    // teste e deve mostrar tudo que a extracao viu.
    const registro = dayRecord(dataISO);
    const jaEnviado = Boolean(registro?.enviadoEm);
    const entregues = canaisEntregues(registro);
    const canais = [...config.canais];
    const pendentes = canais.filter((c) => !entregues.has(c));
    const novas = dry ? publicacoes : filterNew(dataISO, publicacoes);

    // Sabado, domingo e feriado nao tem publicacao — conferido na API: 08 e
    // 09/08/2026 devolvem zero. Mandar "nenhuma publicacao hoje" nesses dias
    // seriam ~104 mensagens por ano, em cada canal, dizendo nada. E ruido que
    // custa caro: alerta que toca a toa e alerta que se aprende a ignorar.
    //
    // A condicao exige ZERO publicacao, entao isto nunca engole publicacao de
    // verdade — se aparecer alguma num sabado, ela sai normalmente.
    if (!dry && publicacoes.length === 0 && !ehDiaUtil(deBR(dataBR))) {
      log.info(`${dataBR} nao e dia util e nao ha publicacao. Nada a enviar.`);
      return;
    }

    // !dry primeiro: dry run e ferramenta de teste e nao pode mutar state.json.
    // "completo" segue como veio da coleta: se uma fonte caiu, o dia continua em
    // aberto e os retries voltam — mas sem reenviar nada, porque nada mudou.
    if (!dry && novas.length === 0 && pendentes.length === 0) {
      log.info(`${dataBR} ja foi enviado por todos os canais e nao ha publicacao nova.`);
      recordSuccess(dataISO, {
        esperado,
        extraido,
        publicacoes,
        completo: coleta.completo,
        entregues,
      });
      registrarPendencias(coleta, []);
      return;
    }
    if (novas.length < publicacoes.length) {
      log.info(`${publicacoes.length - novas.length} publicacao(oes) ja enviadas antes — omitidas.`);
    }

    // Um canal que nunca recebeu este dia precisa do dia INTEIRO, nao do delta:
    // se o e-mail entregou as 14h e o zap caiu, as 16h o zap tem que receber
    // tudo. Nesse caso o canal que ja estava em dia pode receber repetido — e a
    // troca certa, porque duplicata e chateacao e publicacao faltando e prazo.
    const faltaCanal = !dry && jaEnviado && pendentes.length > 0;
    const aEnviar = faltaCanal ? publicacoes : novas;

    // Ha publicacao nova? Todo canal precisa dela. So um canal atrasado? So ele.
    const alvos = novas.length ? canais : pendentes;

    // "complemento" faz o assunto do e-mail e a capa do PDF dizerem que aquele
    // numero e o que falta, nao o total do dia. Nao vale quando o envio e o dia
    // inteiro indo para um canal que ficou para tras.
    const complemento = !dry && jaEnviado && !faltaCanal;
    // esperado/extraido seguem com os numeros cheios da varredura, nao os de
    // "aEnviar": eles descrevem o dia, nao este envio.
    const envio = { ...resultado, publicacoes: aEnviar, complemento };

    stage = 'pdf';
    const pdfPath = aEnviar.length ? await gerarPDF(envio) : null;

    if (dry) {
      log.info('DRY RUN — nada enviado.');
      log.info(`PDF: ${pdfPath ?? '(nenhum)'}`);
      log.info(`Print: ${resultado.screenshotPath ?? '(nenhum)'}`);
      return;
    }

    // Os canais sao independentes de proposito: um caido (sessao do zap
    // expirada, SMTP recusando) nunca pode impedir o outro de entregar o dia.
    stage = 'envio';
    const falhas = [];
    let entregue = false;

    for (const canal of alvos) {
      try {
        await ENVIAR[canal]({ ...envio, pdfPath });
        entregues.add(canal);
        entregue = true;
      } catch (e) {
        log.warn(`Canal "${canal}" falhou:`, e.message);
        // Sai da lista de entregues mesmo se ja estava la: o canal deixou de
        // estar em dia com este dia, e e isso que faz o retry voltar nele.
        entregues.delete(canal);
        falhas.push([canal, e]);
      }
    }

    // Nenhum canal entregou = o dia NAO saiu. Cai no catch de proposito: assim
    // o state fica sem "enviadoEm" e o retry das 16h refaz o envio inteiro.
    if (!entregue) {
      throw new Error(
        `Nenhum canal entregou — ${falhas.map(([c, e]) => `${c}: ${e.message}`).join(' | ')}`,
      );
    }

    // Alguem entregou, entao o conteudo saiu: marca sucesso primeiro (senao o
    // retry reenviaria tudo do zero). So depois registra as falhas parciais —
    // na ordem inversa, recordSuccess limparia o lastError e elas sumiriam.
    // "entregues" guarda quem de fato recebeu e "completo" se as fontes vieram
    // inteiras: e por esses dois que o retry sabe que ainda tem servico.
    recordSuccess(dataISO, {
      esperado,
      extraido,
      publicacoes,
      completo: coleta.completo,
      entregues,
    });
    registrarPendencias(coleta, falhas);

    const restantes = canais.filter((c) => !entregues.has(c));
    if (restantes.length) {
      log.warn(`Falta entregar por: ${restantes.join(', ')} — o retry tentara de novo.`);
    }
    if (!coleta.completo) {
      log.warn('Alguma fonte caiu ou veio incompleta — o dia segue em aberto para o retry.');
    }
    log.info('=== Concluido ===');
  } catch (error) {
    log.error(`Falha na etapa "${stage}":`, error.message);
    // Mesma regra do caminho de sucesso: dry run nao escreve em state.json.
    // lastError e diagnostico de producao — um teste nao pode poluir.
    if (!dry) {
      recordError(stage, error);
      await notificarFalha(stage, error);
    }
    process.exitCode = 1;
  }
}

/**
 * Reconfere UM dia passado na API do CNJ e manda o que tinha ficado de fora.
 *
 * O envio e o mesmo do complemento de retry (mesmo PDF com sufixo de hora,
 * mesmo cabecalho "_complemento_"), so que com a data daquele dia — nunca a de
 * hoje. Publicacao atrasada chegar carimbada com a data errada seria pior do
 * que nao chegar: o prazo conta da disponibilizacao.
 */
async function revisarDia(dataBR, dry) {
  const { dataISO, novas, completo, registro } = await pendentesDoDia(dataBR);

  if (!novas.length) {
    log.info(`Revisao de ${dataBR}: nada ficou para tras na API do CNJ.`);
    return;
  }

  const quantas = `${novas.length} publicacao(oes)`;
  log.warn(
    registro
      ? `Revisao de ${dataBR}: ${quantas} entraram no DJEN depois do envio daquele dia.`
      : `Revisao de ${dataBR}: ${quantas} e o dia nao tem registro de envio nenhum.`,
  );

  const avisos = [
    `REVISÃO DE ${dataBR}: ${novas.length} publicação(ões) daquele dia não tinham sido enviadas — ` +
      `entraram no diário depois do último envio. Só a API do CNJ (DJEN) foi reconferida: ` +
      `publicação que exista apenas nos diários de MG ou da União não entra nesta conferência, ` +
      `confira o portal da OAB se o dia for crítico.`,
  ];
  // esperado/extraido descrevem ESTE lote, nao o dia: o numero cheio do dia
  // mora no state.json e a revisao nao o recalcula (ver recordComplemento).
  const envio = {
    dataBR,
    publicacoes: novas,
    avisos,
    complemento: true,
    esperado: novas.length,
    extraido: novas.length,
  };

  const pdfPath = await gerarPDF(envio);
  if (dry) {
    log.info(`DRY RUN — revisao de ${dataBR} nao envia. PDF: ${pdfPath}`);
    return;
  }

  const falhas = [];
  for (const canal of config.canais) {
    try {
      await ENVIAR[canal]({ ...envio, pdfPath });
    } catch (e) {
      log.warn(`Revisao de ${dataBR}: canal "${canal}" falhou —`, e.message);
      falhas.push([canal, e]);
    }
  }

  // Entrega parcial NAO grava os ids. Sem isso a publicacao ficaria marcada
  // como resolvida e o canal que falhou nunca a receberia — e o retry das
  // 16h/17h so tem como reconferir o que continua pendente. O preco e repetir
  // no canal que ja recebeu, que e a troca de sempre: duplicata e chateacao,
  // publicacao faltando e prazo.
  if (falhas.length) {
    const motivo = falhas.map(([c, e]) => `${c}: ${e.message}`).join(' | ');
    log.warn(`Revisao de ${dataBR} nao saiu por todos os canais — sera tentada de novo.`);
    recordError('revisao', new Error(`Revisao de ${dataBR} incompleta — ${motivo}`));
    return;
  }

  recordComplemento(dataISO, { publicacoes: novas, completo });
  log.info(`Revisao de ${dataBR}: ${quantas} enviadas e registradas.`);
}

/**
 * Passa pelos dias uteis anteriores (REVISAO_DIAS, padrao 1) antes de o dia
 * corrente ser tratado.
 *
 * Best effort do inicio ao fim: a API do CNJ fora do ar, ou um dia da lista que
 * exploda, nao pode derrubar o run — o dia de hoje vale mais que a conferencia
 * de ontem. Cada dia em try proprio pelo mesmo motivo.
 */
async function revisarAnteriores(dataBR, dry) {
  const dias = diasParaRevisar(dataBR);
  if (!dias.length) return;

  if (!temHistorico()) {
    log.info('Revisao: nao ha dia registrado ainda — sem passado para conferir.');
    return;
  }

  for (const dia of dias) {
    try {
      await revisarDia(dia, dry);
    } catch (e) {
      log.warn(`Revisao de ${dia} falhou (${e.message}) — sera tentada no proximo run.`);
    }
  }
}

/**
 * Flags:
 *   --dry              gera os arquivos em out/ e nao envia nada
 *   --data=dd/mm/aaaa  consulta outra data (padrao: hoje) e nao revisa nada
 *   --retry            no-op so se o dia estiver inteiramente resolvido
 *                      (ver isDayComplete: saiu, por todos os canais, com
 *                      todas as fontes de pe)
 */
async function main() {
  const dataBR = targetDateBR();
  const dry = isDryRun();

  // Sabado e domingo o Diario nao circula: a API devolve zero (conferido em 08 e
  // 09/08/2026) e o portal repete o ultimo dia util. Antes o run ia ate o fim e
  // so segurava o envio la embaixo; agora nem comeca — abrir Chrome, passar pela
  // Cloudflare e acordar a maquina duas vezes no fim de semana (14h, 16h, 17h)
  // era trabalho para colher nada, e todo run e uma chance a mais de a sessao do
  // portal ou do zap quebrar sozinha.
  //
  // Vale para a revisao tambem: a segunda-feira ja reconfere a sexta, entao
  // acordar a maquina no sabado nao adiantaria o aviso de nada.
  //
  // Duas escapatorias de proposito: --dry (ferramenta de teste, tem que rodar
  // quando eu mandar) e --data= explicito (se eu peco um sabado nominalmente, e
  // porque quero conferir aquele sabado).
  const dataExplicita = process.argv.some((a) => a.startsWith('--data='));
  const alvo = deBR(dataBR);
  if (!dry && !dataExplicita && alvo && ehFimDeSemana(alvo)) {
    log.info(`${dataBR} e fim de semana — o Diario nao publica. Nada a fazer.`);
    return;
  }

  await processarDia(dataBR, dry);

  // Depois, nunca antes. Tres razoes, todas de ordem:
  //   1. o dia de hoje nao pode esperar a conferencia de ontem — se a API do
  //      CNJ estiver lenta na revisao, o envio das 14h ja saiu;
  //   2. recordSuccess zera lastError. Rodando antes, uma revisao que falhasse
  //      teria o erro apagado pelo sucesso do dia corrente, e o retry das 16h
  //      nao teria como saber que ficou servico;
  //   3. --data= explicito e pedido pontual daquela data: revisar a vespera
  //      dela seria efeito colateral que ninguem pediu.
  if (!dataExplicita) {
    await revisarAnteriores(dataBR, dry);
  }
}

main();
