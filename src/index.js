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
  const { dataISO, publicacoes, novas, completo, registro } = await pendentesDoDia(dataBR, {
    dedupe: !dry,
  });

  // Canal que ficou para tras num complemento ANTERIOR desta mesma revisao: os
  // ids ja foram gravados, entao "novas" vem vazia, mas aquele canal nunca
  // recebeu. Sem este resgate, um zap com a sessao expirada as 14h perderia o
  // complemento de vez, porque as 16h nao haveria mais nada "novo" a achar.
  //
  // So vale para dia que JA passou por revisao (revisadoEm). Dia comum que
  // terminou com canal pendente e assunto do retry das 16h/17h, e alarga-lo
  // para ca faria a revisao reenviar dia inteiro por conta propria.
  const entregues = canaisEntregues(registro);
  const atrasados = registro?.revisadoEm
    ? [...config.canais].filter((c) => !entregues.has(c))
    : [];

  if (!novas.length && !atrasados.length) {
    log.info(`Revisao de ${dataBR}: nada ficou para tras na API do CNJ.`);
    return;
  }

  // Mesma regra do dia corrente: canal atrasado precisa do dia INTEIRO, nao do
  // delta, porque nao ha registro de qual publicacao foi por qual canal.
  const aEnviar = atrasados.length ? publicacoes : novas;
  const alvos = novas.length ? [...config.canais] : atrasados;
  const quantas = `${aEnviar.length} publicacao(oes)`;

  log.warn(
    !novas.length
      ? `Revisao de ${dataBR}: reenviando o dia para ${atrasados.join(', ')} — ficou para tras num complemento anterior.`
      : registro
        ? `Revisao de ${dataBR}: ${quantas} entraram no DJEN depois do envio daquele dia.`
        : `Revisao de ${dataBR}: ${quantas} e o dia nao tem registro de envio nenhum.`,
  );

  // O aviso muda com o caso, e a diferenca importa: "entraram depois" diz que o
  // dia foi tratado e estas sao retardatarias; num dia que o robo nunca rodou a
  // verdade e o oposto — NADA daquele dia foi conferido, portal inclusive —, e
  // ler a primeira frase ali afastaria o leitor justamente da conferencia a mao
  // que o dia inteiro esta pedindo.
  const ressalva =
    `Só a API do CNJ (DJEN) foi reconferida: publicação que exista apenas nos diários de MG ` +
    `ou da União não entra nesta conferência.`;
  const avisos = [
    registro
      ? `REVISÃO DE ${dataBR}: ${aEnviar.length} publicação(ões) daquele dia não tinham sido ` +
        `enviadas — entraram no diário depois do último envio. ${ressalva}`
      : `REVISÃO DE ${dataBR}: o robô NÃO RODOU naquele dia — nada dele tinha sido conferido. ` +
        `Abaixo o que a API do CNJ tem para a data. ${ressalva} ` +
        `Confira o portal da OAB manualmente para este dia.`,
  ];
  // esperado/extraido descrevem ESTE lote, nao o dia: o numero cheio do dia
  // mora no state.json e a revisao nao o recalcula (ver recordComplemento).
  const envio = {
    dataBR,
    publicacoes: aEnviar,
    avisos,
    complemento: true,
    esperado: aEnviar.length,
    extraido: aEnviar.length,
  };

  const pdfPath = await gerarPDF(envio);
  if (dry) {
    log.info(`DRY RUN — revisao de ${dataBR} nao envia. PDF: ${pdfPath}`);
    return;
  }

  // Parte do "entregues" que ja havia e mexe a partir dele: quem entregou entra,
  // quem falhou SAI mesmo se ja estava la — o canal deixou de estar em dia com
  // este dia, e e isso que traz a revisao de volta nele amanha.
  const falhas = [];
  for (const canal of alvos) {
    try {
      await ENVIAR[canal]({ ...envio, pdfPath });
      entregues.add(canal);
    } catch (e) {
      log.warn(`Revisao de ${dataBR}: canal "${canal}" falhou —`, e.message);
      entregues.delete(canal);
      falhas.push([canal, e]);
    }
  }

  const entregou = alvos.some((c) => entregues.has(c));
  // Nenhum canal saiu: nao grava id nenhum. Gravar aqui marcaria a publicacao
  // como resolvida sem ela ter chegado a lugar nenhum.
  if (!entregou) {
    const motivo = falhas.map(([c, e]) => `${c}: ${e.message}`).join(' | ');
    log.warn(`Revisao de ${dataBR} nao saiu por canal nenhum — sera tentada de novo.`);
    recordError('revisao', new Error(`Revisao de ${dataBR} nao saiu — ${motivo}`), {
      preservar: true,
    });
    return;
  }

  // Saiu por alguem: grava os ids (senao o proximo run reenviaria tudo do zero)
  // e, junto, quais canais estao mesmo em dia. O canal que falhou fica de fora
  // dessa lista, e e por ela que o resgate la em cima o encontra no proximo run.
  recordComplemento(dataISO, { publicacoes: aEnviar, completo, entregues });
  log.info(`Revisao de ${dataBR}: ${quantas} enviadas por ${[...entregues].join(', ')}.`);

  if (falhas.length) {
    const motivo = falhas.map(([c, e]) => `${c}: ${e.message}`).join(' | ');
    log.warn(`Revisao de ${dataBR}: falta ${falhas.map(([c]) => c).join(', ')} — volta no proximo run.`);
    recordError('revisao', new Error(`Revisao de ${dataBR} incompleta — ${motivo}`), {
      preservar: true,
    });
  }
}

/**
 * Passa pelos dias uteis anteriores (REVISAO_DIAS, padrao 1) antes de o dia
 * corrente ser tratado.
 *
 * Best effort do inicio ao fim: a API do CNJ fora do ar, ou um dia da lista que
 * exploda, nao pode derrubar o run — o dia de hoje vale mais que a conferencia
 * de ontem. Cada dia em try proprio pelo mesmo motivo.
 */
async function revisarAnteriores(dataBR, dry, havia) {
  // Fora do laco mas dentro do try: config.revisaoDias e um getter que ESTOURA
  // se REVISAO_DIAS vier invalido, e main() nao tem catch. Sem isto, "1.5" no
  // .env mataria o processo depois de o dia ja ter saido — sem recordError, sem
  // aviso, sem nada em state.json explicando.
  try {
    const dias = diasParaRevisar(dataBR);
    if (!dias.length) return;

    // "havia" e medido ANTES de o dia corrente rodar. Medir aqui nao serviria de
    // nada: processarDia acabou de gravar hoje no state.json, entao o historico
    // estaria sempre cheio e a porta nunca fecharia — que era justamente o caso
    // que ela existe para barrar (primeiro run numa maquina limpa, ou depois de
    // um state.json perdido, despejando o dia anterior inteiro como novidade).
    if (!havia) {
      log.info('Revisao: nao havia dia registrado no inicio do run — sem passado para conferir.');
      return;
    }

    for (const dia of dias) {
      try {
        await revisarDia(dia, dry);
      } catch (e) {
        log.warn(`Revisao de ${dia} falhou (${e.message}) — sera tentada no proximo run.`);
      }
    }
  } catch (e) {
    log.error('Revisao nao pode nem comecar:', e.message);
    if (!dry) recordError('revisao', e, { preservar: true });
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

  // Medido aqui, antes de processarDia gravar o dia de hoje — ver revisarAnteriores.
  const havia = temHistorico();

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
    await revisarAnteriores(dataBR, dry, havia);
  }
}

main();
