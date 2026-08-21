import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from './config.js';
import { garantirChrome } from './chrome.js';
import { log } from './log.js';

/**
 * Conecta ao Chrome com porta de depuracao — abrindo-o se preciso.
 *
 * Este e o UNICO caminho de acesso ao portal em todo o projeto — scraper,
 * recon e sessao exploratoria usam esta mesma funcao de proposito. Um Chrome
 * lancado pelo Playwright (launch/launchPersistentContext) e reprovado pelo
 * Cloudflare Turnstile mesmo com um humano clicando na caixa: as marcas de
 * automacao do lancador entregam o navegador. Ter dois caminhos para o mesmo
 * chrome-profile/ tambem confundia qual sessao ficava "salva" — por isso o
 * lancador do Playwright foi removido em vez de mantido como alternativa.
 *
 * Abrir por conta propria (garantirChrome) nao contradiz isso: quem sobe a
 * janela e um spawn de chrome.exe comum, o mesmo que o usuario faria a mao.
 * O Playwright continua so LENDO a pagina.
 *
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function conectarChromeAberto({ abrirSePreciso = true } = {}) {
  if (abrirSePreciso) await garantirChrome();

  let browser;
  try {
    browser = await chromium.connectOverCDP(config.cdpEndpoint);
  } catch {
    throw new Error(
      `Nao achei um Chrome aberto em ${config.cdpEndpoint}. ` +
        'Rode "npm run abrir-chrome", faça o login no portal e deixe a janela aberta.',
    );
  }

  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome conectado, mas sem nenhuma aba aberta.');

  // Escolhe a aba pelo HOST do portal, nao por "contem oabsp.org.br".
  //
  // Medido em 13/08/2026: havia duas abas abertas, o site institucional
  // (www.oabsp.org.br) e o portal (recortedigital.oabsp.org.br). O casamento
  // largo pegava a institucional, que obviamente nao tem "Sair" nem "Bem-vindo"
  // — e o scraper concluia "sessao do portal caiu" com a sessao intacta. Erro
  // de diagnostico e pior que erro de execucao: manda consertar o que nao esta
  // quebrado.
  const host = new URL(config.urls.publicacoes).host;
  const paginas = context.pages();
  const page =
    paginas.find((p) => p.url().includes(host)) ?? paginas[0] ?? (await context.newPage());
  page.setDefaultTimeout(config.navTimeoutMs);
  page.setDefaultNavigationTimeout(config.navTimeoutMs);
  return { browser, context, page };
}

/** Detecta a tela de desafio da Cloudflare NESTE instante. */
export async function isCloudflareChallenge(page) {
  const title = await page.title().catch(() => '');
  if (/just a moment|um momento/i.test(title)) return true;
  return page.locator('#challenge-running, #cf-challenge-running').count().then((n) => n > 0);
}

/**
 * Espera o desafio da Cloudflare passar sozinho. So diz que persiste se ele
 * ainda estiver na tela depois da espera.
 *
 * Por que esperar em vez de desistir na primeira olhada: o desafio tem dois
 * tipos, e so um precisa do usuario. O interativo ("Confirme que e humano")
 * fica ate alguem clicar; o nao-interativo se resolve sozinho em alguns
 * segundos e segue para a pagina. Quem olha uma vez so nao distingue os dois —
 * chama os dois de bloqueio e manda o usuario clicar numa caixa que ja nao
 * existe mais.
 *
 * Foi o que aconteceu de 13 a 19/08/2026: TODA execucao agendada (17h, 19h,
 * 20h) morreu em ~1s com "desafio da Cloudflare", e toda execucao que o
 * usuario disparou a mao logo em seguida passou em ~6s. A diferenca nao era o
 * Cloudflare estar mais bravo no horario agendado — era o navegador estar
 * frio. O robo abre o Chrome, vai em www.oabsp.org.br e dali salta para
 * www2.oabsp.org.br: host diferente, desafio proprio, e o `domcontentloaded`
 * do goto devolve JA na tela do desafio. Quando o usuario roda a mao, ele
 * acabou de navegar nos dois hosts e nenhum desafio aparece.
 *
 * Isto nao tenta resolver nem burlar o desafio: quem resolve e a propria
 * Cloudflare, ou o usuario. Aqui so se para de confundir "ainda carregando"
 * com "bloqueado".
 *
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs quanto esperar antes de considerar que travou
 * @returns {Promise<boolean>} true se o desafio AINDA esta na tela
 */
export async function desafioCloudflarePersiste(page, timeoutMs = config.cloudflareEsperaMs) {
  if (!(await isCloudflareChallenge(page))) return false;

  const t0 = Date.now();
  const limite = t0 + timeoutMs;
  while (Date.now() < limite) {
    await page.waitForTimeout(500);
    if (!(await isCloudflareChallenge(page))) {
      log.info(`Cloudflare: o desafio passou sozinho em ${Date.now() - t0}ms.`);
      // Passou sozinho. Deixa a pagina de destino assentar antes de devolver:
      // o desafio sai por navegacao, e quem chamou vai procurar seletores.
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return false;
    }
  }

  await registrarDesafio(page, Date.now() - t0);
  return true;
}

/**
 * O desafio na tela pede CLIQUE de gente?
 *
 * O Turnstile tem dois tipos e a diferenca decide quem resolve: o interativo
 * mostra a caixa "Confirme que e humano" e espera o usuario; o nao-interativo
 * nao tem nada em que clicar e passa sozinho em alguns segundos. Sao problemas
 * diferentes — um pede alguem, o outro pede tempo — e trata-los igual foi o
 * que fez o robo mandar o usuario clicar numa caixa que nao existia.
 */
export async function desafioPedeClique(page) {
  return (
    (await page
      .locator('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, #cf-turnstile')
      .count()) > 0
  );
}

/**
 * Guarda o que se via na tela quando o desafio nao passou.
 *
 * Existe porque a falha das 14h nao deixava rastro nenhum: o log dizia
 * "desafio da Cloudflare" e acabava ali, sem dizer em que endereco, em que
 * tipo de desafio, nem se havia caixa para alguem clicar. Sem isso, todo
 * conserto vira palpite — foi assim que "esperar mais" passou tres dias sendo
 * hipotese em vez de medida.
 *
 * Best-effort de proposito: um erro AQUI nao pode substituir o erro real da
 * coleta, que e o que o retry e o guarda-noturno leem.
 */
async function registrarDesafio(page, esperouMs) {
  const dados = { url: page.url(), esperouMs };
  try {
    dados.titulo = await page.title();
    // O interativo tem a caixa "Confirme que e humano" (widget do Turnstile);
    // o nao-interativo nao tem nada em que clicar. Sao problemas diferentes:
    // um espera o usuario, o outro so espera. Dizer qual e os separa.
    dados.interativo = await desafioPedeClique(page);
  } catch (e) {
    dados.erroLeitura = e.message;
  }

  try {
    const dir = path.join(config.paths.out, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    const carimbo = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const print = path.join(dir, `cloudflare-${carimbo}.png`);
    await page.screenshot({ path: print, fullPage: false });
    dados.print = print;
    // O HTML responde o que o print nao responde: qual desafio, que cookie
    // faltou, que script travou.
    const html = path.join(dir, `cloudflare-${carimbo}.html`);
    fs.writeFileSync(html, await page.content(), 'utf8');
    dados.html = html;
  } catch (e) {
    dados.erroPrint = e.message;
  }

  log.warn(`Cloudflare: desafio NAO passou — ${JSON.stringify(dados)}`);
}
