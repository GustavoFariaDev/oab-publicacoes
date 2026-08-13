import { chromium } from 'playwright';
import { config } from './config.js';
import { garantirChrome } from './chrome.js';

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

/** Detecta a tela de desafio da Cloudflare. */
export async function isCloudflareChallenge(page) {
  const title = await page.title().catch(() => '');
  if (/just a moment|um momento/i.test(title)) return true;
  return page.locator('#challenge-running, #cf-challenge-running').count().then((n) => n > 0);
}
