import { chromium } from 'playwright';
import { config } from './config.js';

/**
 * Conecta ao Chrome que o usuario deixou aberto por `npm run abrir-chrome`.
 *
 * Este e o UNICO caminho de acesso ao portal em todo o projeto — scraper,
 * recon e sessao exploratoria usam esta mesma funcao de proposito. Um Chrome
 * lancado pelo Playwright (launch/launchPersistentContext) e reprovado pelo
 * Cloudflare Turnstile mesmo com um humano clicando na caixa: as marcas de
 * automacao do lancador entregam o navegador. Ter dois caminhos para o mesmo
 * chrome-profile/ tambem confundia qual sessao ficava "salva" — por isso o
 * lancador do Playwright foi removido em vez de mantido como alternativa.
 *
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function conectarChromeAberto() {
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

  // pages()[0] e a primeira aba da janela, nao necessariamente a do portal —
  // se o usuario tiver outra aba aberta na frente (ou a restaurada pelo Chrome
  // ao reabrir), pages()[0] pode ser qualquer coisa e o scraper leria a pagina
  // errada em vez de detectar sessao caida. Preferir a aba que ja esta no
  // dominio do portal quando existir.
  const paginas = context.pages();
  const page =
    paginas.find((p) => p.url().includes('oabsp.org.br')) ?? paginas[0] ?? (await context.newPage());
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
