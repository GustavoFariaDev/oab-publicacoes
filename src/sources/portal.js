import path from 'node:path';
import fs from 'node:fs';
import { config, brToISO } from '../config.js';
import { log } from '../log.js';
import { conectarChromeAberto, desafioCloudflarePersiste } from '../browser.js';
import { garantirSessao } from '../login.js';

/**
 * Fonte 2: portal da OAB SP (Historico > Publicacoes por Data).
 *
 * Fonte MAIS COMPLETA que a API do CNJ: agrega tambem os diarios de MG e da
 * Uniao. Medido em 01/07-11/08/2026: portal ~179 publicacoes contra 152 da API.
 *
 * Por que ele se conecta a um Chrome ja aberto em vez de abrir o proprio:
 * o portal usa Cloudflare Turnstile, e um Chrome lancado pelo Playwright e
 * reprovado no desafio mesmo com um humano clicando na caixa — as marcas de
 * automacao do lancador entregam o navegador. Conectando por CDP a uma janela
 * de Chrome normal (aberta por scripts/abrir-chrome.js), quem navega e o
 * proprio navegador do usuario; o Playwright so le a pagina resultante.
 *
 * O clique no "Confirme que e humano" e sempre do usuario. Nada aqui tenta
 * resolver o desafio.
 */

/**
 * Seletores mapeados na sessao de 12/08/2026, contra a tela real.
 *
 * Onde ha texto visivel, ele vem primeiro: "Consultar" e "Visualizar tudo" sao
 * o rotulo que o usuario le, e sobrevivem a remontagem do ASP.NET.
 *
 * Onde nao ha (os campos de data), o ID gerado e a unica ancora — mas casado
 * pelo SUFIXO (`[id$="txtSelDataInicio"]`) em vez do ID inteiro. O prefixo
 * `ctl00_ContentPlaceHolder1_` descreve onde o controle esta na arvore de
 * master pages e muda se a pagina for reorganizada; o sufixo e o nome que o
 * programador deu ao campo, e esse so muda se o campo mudar de proposito.
 */
const SEL = {
  // `>> visible=true` obrigatorio: a tela de login carrega um "Logout"
  // escondido no cabecalho, e sem o filtro ele responde por "sessao viva"
  // estando justamente na pagina que prova o contrario. Ver src/login.js.
  loggedIn: 'text=/Sair|Logout|Bem.?vindo/i >> visible=true',
  dateFrom: 'input[id$="txtSelDataInicio"]',
  dateTo: 'input[id$="txtSelDataFim"]',
  consultar: 'input[value="Consultar"]',
  visualizarTudo: 'input[value="Visualizar tudo"]',
  resumoCard: 'div.div-item',
  // Ancorado na tabela de resultados de proposito: durante um postback do
  // UpdatePanel chegou a haver um `section.conteudo` do render anterior ainda
  // solto no DOM. Preso ao grid, sobra nao entra na conta.
  publicacaoCard: 'table[id$="gdvPublicacoes"] section.conteudo',
  cabecalhoCard: 'span[id$="lblPublicacaoTitulo"]',
  textoCard: 'span[id$="lblPublicacaoTexto"]',
};

/**
 * A lista pagina de 10 em 10 por __doPostBack, com links numerados ("1 2 3 4
 * 5 ..."), sem botao "Proximo". Clicar no numero seguinte funcionaria enquanto
 * ele estivesse visivel — mas a partir da 6a pagina o pager troca a janela de
 * numeros por "...", e um laco que procura "o proximo numero" trava ali.
 * Chamar o postback direto pede qualquer pagina, visivel ou nao.
 */
const PAGER = 'ctl00$ContentPlaceHolder1$ListaPublicacaoResultado$gdvPublicacoes';
const POR_PAGINA = 10;

const CAMPOS = {
  dataDisponibilizacao: 'Data de disponibilização',
  dataPublicacao: 'Data de publicação',
  jornal: 'Jornal',
  tribunal: 'Tribunal',
  caderno: 'Caderno',
  vara: 'Vara',
  titulo: 'Título',
  numeroProcesso: 'Número do processo',
  pagina: 'Página',
};

/**
 * @param {string} dataBR dd/mm/aaaa
 * @returns {Promise<{publicacoes: import('../merge.js').Publicacao[], avisos: string[], completo: boolean}>}
 *   `completo` e false quando a extracao trouxe menos do que o proprio portal
 *   declarou ter — o dia continua "em aberto" e os retries voltam a tentar.
 */
export async function buscarNoPortal(dataBR) {
  const { browser, page } = await conectarChromeAberto();

  try {
    let esperado = await consultarDia(page, dataBR);

    // Zero merece segunda opiniao.
    //
    // A tela nao distingue "nenhuma publicacao neste dia" de "a consulta nao
    // renderizou": nos dois casos nao ha card nenhum para contar. E o portal
    // erra assim de verdade — em 13/08/2026, logo apos um timeout de
    // navegacao, uma consulta ao dia 12/08 devolveu 0 onde as outras quatro
    // devolveram 7.
    //
    // Zero e justamente o resultado que nao pode estar errado: ele vira "dia
    // vazio", e dia vazio e aceito como completo. Entao confirma-se antes.
    if (esperado === 0) {
      log.info('Portal: zero no primeiro passe — conferindo de novo antes de aceitar.');
      esperado = await consultarDia(page, dataBR);
    }

    log.info(`Portal: resumo do dia indica ${esperado} publicacao(oes).`);
    if (esperado === 0) return { publicacoes: [], avisos: [], completo: true, screenshotPath: null };

    await page.locator(SEL.visualizarTudo).first().click();
    // Espera a LISTA aparecer, nao a rede sossegar: o "Visualizar tudo" e um
    // postback de UpdatePanel, e "networkidle" volta na hora porque a pagina ja
    // estava parada. Medido: 125ms entre o clique e a leitura, com a lista
    // ainda vazia — o robo lia zero publicacao num dia de sete e so o
    // guard-rail de contagem denunciava.
    await page
      .locator(SEL.publicacaoCard)
      .first()
      .waitFor({ state: 'visible', timeout: config.navTimeoutMs });

    const publicacoes = await extrairPublicacoes(page);
    const screenshotPath = await salvarScreenshot(page, dataBR);

    // Este e o unico guard-rail de contagem que ainda e independente: o resumo
    // do dia e contado pelo proprio portal, antes de qualquer coisa nossa. Se a
    // extracao trouxe menos, faltou publicacao — e isso precisa chegar ao
    // advogado (aviso) e aos retries (completo: false), nao morrer num log.
    const avisos = [];
    const completo = publicacoes.length >= esperado;
    if (!completo) {
      const faltam = esperado - publicacoes.length;
      const aviso =
        `DIVERGÊNCIA NO PORTAL: o resumo do dia soma ${esperado} publicação(ões), ` +
        `mas só ${publicacoes.length} foram extraídas — ${faltam} pode(m) estar faltando. ` +
        `Confira no portal da OAB antes de contar prazo.`;
      log.warn(aviso);
      avisos.push(aviso);
    } else if (publicacoes.length > esperado) {
      log.info(`Portal: resumo dizia ${esperado}, extraidas ${publicacoes.length}.`);
    }
    return { publicacoes, avisos, completo, screenshotPath };
  } finally {
    // Só desconecta: a janela é do usuário e continua aberta para a próxima vez.
    await browser.close().catch(() => {});
  }
}

/**
 * Um passe completo: abre a tela, confere a sessao, filtra o dia e conta.
 *
 * Fica junto num lugar so porque o passe inteiro precisa ser repetivel — ver a
 * confirmacao de zero em buscarNoPortal.
 *
 * @returns {Promise<number>} soma dos contadores dos cards do dia
 */
async function consultarDia(page, dataBR) {
  // Navega ANTES de conferir sessao. Perguntar "esta logado?" na aba em que o
  // Chrome calhou de estar nao responde nada: se ela estiver no site
  // institucional, ou numa aba qualquer que o usuario deixou aberta, a resposta
  // e sempre "nao" — e o robo acusa sessao caida com a sessao viva.
  await irParaPublicacoesPorData(page);

  if (await desafioCloudflarePersiste(page)) {
    throw new Error(
      'O portal está mostrando o desafio da Cloudflare e ele não passou sozinho. ' +
        'Clique em "Confirme que é humano" na janela do Chrome e rode de novo.',
    );
  }
  // Sessão caída não é mais motivo de parar: garantirSessao refaz o login pelo
  // mesmo caminho que o usuário faz a mão (menu > INTIMAÇÕES > senha salva).
  // Só depois de o login falhar é que a fonte cai — e aí a mensagem diz o que
  // fazer na janela.
  if (!(await page.locator(SEL.loggedIn).count())) {
    await garantirSessao(page);
    await irParaPublicacoesPorData(page);
    if (!(await page.locator(SEL.loggedIn).count())) {
      throw new Error('Sessão do portal caiu e o login automático não pegou. Entre na janela do Chrome aberta.');
    }
  }
  if (!(await page.locator(SEL.dateFrom).count())) {
    throw new Error('Cheguei em "Publicacoes por Data" mas nao achei os campos de data.');
  }

  await filtrarPorDia(page, dataBR);
  return somarCardsDoDia(page, dataBR);
}

/**
 * Vai direto pela URL, em vez de clicar no menu — a tela e um .aspx com
 * endereco proprio e estavel, e percorrer o menu seria mais seletor para
 * quebrar sem ganho nenhum.
 *
 * Tenta duas vezes: o portal e lento em hora cheia e estourou o timeout de
 * navegacao duas vezes em dez minutos na manha de 13/08/2026. Uma lentidao
 * momentanea nao deveria derrubar a fonte do dia inteiro.
 */
async function irParaPublicacoesPorData(page, tentativas = 2) {
  for (let i = 1; ; i++) {
    try {
      await page.goto(config.urls.publicacoes, { waitUntil: 'domcontentloaded' });
      return;
    } catch (e) {
      if (i >= tentativas) throw e;
      log.warn(`Portal: navegacao falhou (${e.message.split('\n')[0]}) — tentando de novo.`);
      await page.waitForTimeout(3000);
    }
  }
}

async function filtrarPorDia(page, dataBR) {
  // Mesmo dia nos dois campos: a tela consulta por intervalo, e o robo trabalha
  // sempre com um dia fechado.
  await page.locator(SEL.dateFrom).fill(dataBR);
  await page.locator(SEL.dateTo).fill(dataBR);
  // O filtro de estado fica em "Todos", que e o padrao — e o que traz MG e
  // Uniao, a razao de existir desta fonte.
  await page.locator(SEL.consultar).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
}

/**
 * Soma os contadores de TODOS os cards do dia.
 * O mesmo dia costuma ter mais de um card (07/08/2026 tem "DJ MG (2)" e
 * "DJ SP (5)"): somar so o primeiro perde as de outro estado.
 */
async function somarCardsDoDia(page, dataBR) {
  let total = 0;
  for (const card of await page.locator(SEL.resumoCard).all()) {
    const texto = (await card.innerText()).replace(/\s+/g, ' ').trim();
    if (!texto.includes(dataBR)) continue;
    for (const m of texto.matchAll(/\((\d+)\)/g)) total += Number(m[1]);
    log.info(`  card do dia: ${texto}`);
  }
  return total;
}

/**
 * Percorre todas as paginas da lista ("Exibindo resultados de 1 a 10").
 *
 * O numero de paginas sai do total declarado pela propria tela, nao de "existe
 * link para a proxima?": e o mesmo motivo de a paginacao ser feita por
 * postback direto — nao depender de qual numero esta visivel no pager.
 */
async function extrairPublicacoes(page) {
  const publicacoes = [];
  const declarado = await lerTotalDeclarado(page);
  const paginas = declarado === null ? 1 : Math.ceil(declarado / POR_PAGINA);

  for (let pagina = 1; pagina <= paginas; pagina++) {
    if (pagina > 1) {
      const mudou = await irParaPagina(page, pagina);
      if (!mudou) {
        log.warn(`Portal: a pagina ${pagina} nao carregou — parando com ${publicacoes.length}.`);
        break;
      }
    }
    for (const card of await page.locator(SEL.publicacaoCard).all()) {
      publicacoes.push(await extrairCard(card));
    }
  }
  return publicacoes;
}

/**
 * Pede uma pagina pelo postback do GridView e confirma que ela trocou.
 *
 * A confirmacao existe porque o postback e assincrono e nao devolve promessa:
 * sem comparar o conteudo antes/depois, uma pagina que nao carregou seria lida
 * de novo e as publicacoes sairiam duplicadas em vez de faltando — que e o
 * erro mais dificil de perceber dos dois.
 */
async function irParaPagina(page, numero) {
  const antes = await page.locator(SEL.publicacaoCard).first().innerText().catch(() => '');

  await page.evaluate(
    ([alvo, n]) => window.__doPostBack(alvo, `Page$${n}`),
    [PAGER, numero],
  );

  try {
    await page.waitForFunction(
      ([seletor, texto]) => {
        const primeiro = document.querySelector(seletor);
        return primeiro && primeiro.innerText !== texto;
      },
      [SEL.publicacaoCard, antes],
      { timeout: config.navTimeoutMs },
    );
  } catch {
    return false;
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  return true;
}

async function lerTotalDeclarado(page) {
  const texto = await page.locator('body').innerText();
  const m = texto.match(/pesquisa\s+retornou\s+(\d+)\s+publica/i);
  return m ? Number(m[1]) : null;
}

/**
 * Le uma publicacao.
 *
 * Cabecalho e corpo saem de dois spans distintos, e nao de um recorte do texto
 * do card inteiro. A versao anterior separava os dois cortando em "Intimação" —
 * o que quebra justamente nas publicacoes cujo TITULO e "Intimação" (metade
 * delas): o corte caia no cabecalho e o corpo vinha picado.
 */
/** "Número do processo" -> "numero do processo": casa rotulo sem depender de acento. */
function chaveRotulo(texto = '') {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

async function extrairCard(card) {
  const corpo = await card.locator(SEL.textoCard).innerText().catch(() => '');

  // Cada campo e um <li> proprio, e e assim que sao lidos — um por um.
  //
  // Ler o cabecalho inteiro e recortar por regex NAO funciona: os <li> ficam
  // dentro de um <span>, que e inline, entao o innerText nao poe quebra de
  // linha entre eles. Um "(.*)" apos o rotulo engolia todos os campos
  // seguintes: "Numero do processo" saia como "1000000-00.2024.8.26.0100
  // Pagina: 00001", e nenhuma publicacao casava com a mesma vinda da API.
  const valores = new Map();
  for (const item of await card.locator(`${SEL.cabecalhoCard} li`).allInnerTexts()) {
    const corte = item.indexOf(':');
    if (corte < 0) continue;
    valores.set(chaveRotulo(item.slice(0, corte)), item.slice(corte + 1).trim());
  }

  const pub = { fonte: 'Portal' };
  for (const [chave, rotulo] of Object.entries(CAMPOS)) {
    pub[chave] = valores.get(chaveRotulo(rotulo)) ?? '';
  }

  pub.intimacao = corpo.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // O mesmo numero que a API do CNJ devolve como "id" — e o que faz o dedupe
  // entre as duas fontes casar de verdade, em vez de depender de similaridade
  // de texto. Nem toda publicacao tem (as que nao vem do DJEN nao tem).
  pub.identificador = corpo.match(/Identificador do documento:\s*(\d+)/i)?.[1] ?? '';
  return pub;
}

/**
 * Print da tela. NUNCA lanca — devolve o caminho, ou null se nao deu.
 *
 * O "nunca lanca" e a regra inteira desta funcao, e ela nasceu de um prejuizo
 * real. Ate 14/08/2026 o print era `page.screenshot({ fullPage: true })` seco,
 * herdando o timeout padrao da page (config.navTimeoutMs). Com "Visualizar
 * tudo" aberto a pagina fica altissima — um dia de 5 publicacoes ja estourou os
 * 45s montando a imagem — e a excecao subia por buscarNoPortal, que a essa
 * altura JA TINHA as publicacoes extraidas na mao. Elas iam para o lixo junto:
 * coletar.js registrava "Fonte Portal falhou" e a fonte entrava como zero.
 *
 * Duas vezes em 14/08 o dia foi enviado com Portal=0 por causa disso, com o
 * portal funcionando perfeitamente. Trocar a publicacao do advogado por uma
 * imagem ilustrativa e a pior troca possivel: o print e conferencia, a
 * publicacao e prazo.
 *
 * Timeout proprio e curto pelo mesmo motivo — este e o passo mais dispensavel
 * da coleta e nao pode segurar o envio. Se a pagina inteira nao sai, vale a
 * tela visivel; se nem essa sai, vale seguir sem print.
 */
const SHOT_FULL_MS = 20000;
const SHOT_VIEWPORT_MS = 10000;

async function salvarScreenshot(page, dataBR) {
  const dir = path.join(config.paths.out, brToISO(dataBR));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'portal.png');
  const motivo = (e) => String(e?.message ?? e).split('\n')[0];

  try {
    await page.screenshot({ path: file, fullPage: true, timeout: SHOT_FULL_MS });
    return file;
  } catch (e) {
    log.warn(`Portal: print da pagina inteira falhou (${motivo(e)}) — tentando so a tela visivel.`);
  }

  try {
    await page.screenshot({ path: file, timeout: SHOT_VIEWPORT_MS });
    log.info('Portal: print salvo apenas da tela visivel.');
    return file;
  } catch (e) {
    log.warn(`Portal: sem print nesta execucao (${motivo(e)}). As publicacoes nao foram afetadas.`);
    return null;
  }
}
