/**
 * Reconhecimento da Fase 1, sem interacao.
 *
 * Despeja em out/recon/ tudo que serve para fechar os seletores marcados
 * TODO(fase-1) em src/sources/portal.js: HTML das telas, screenshots e um
 * inventario de inputs/botoes/links visiveis.
 *
 * Pre-requisito: `npm run abrir-chrome`, Cloudflare clicado e login feito.
 * Este script le a janela que voce deixou aberta — nao abre navegador proprio
 * nem faz login (ver a nota em src/browser.js sobre o Turnstile).
 *
 *   node scripts/explorar.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { log } from '../src/log.js';
import { conectarChromeAberto, isCloudflareChallenge } from '../src/browser.js';

const RECON = path.join(config.paths.out, 'recon');
fs.mkdirSync(RECON, { recursive: true });

/** Salva HTML + screenshot + inventario de elementos da tela atual. */
async function registrar(page, nome) {
  const html = await page.content();
  fs.writeFileSync(path.join(RECON, `${nome}.html`), html);
  await page.screenshot({ path: path.join(RECON, `${nome}.png`), fullPage: true });

  const inventario = await page.evaluate(() => {
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return [...document.querySelectorAll('input, button, select, textarea, a[href]')]
      .filter(visivel)
      .slice(0, 150)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        cls: (el.className || '').toString().slice(0, 60),
        href: (el.getAttribute('href') || '').slice(0, 80),
        texto: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 50),
      }));
  });

  fs.writeFileSync(
    path.join(RECON, `${nome}.elementos.json`),
    JSON.stringify({ url: page.url(), titulo: await page.title(), inventario }, null, 2),
  );

  log.info(`[recon] ${nome} -> ${page.url()} (${inventario.length} elementos)`);
  return inventario;
}

const { browser, page } = await conectarChromeAberto();

try {
  // O Turnstile ("Confirme que e humano") e um desafio interativo: quem clica e
  // voce, na janela do abrir-chrome. Nada aqui tenta resolve-lo.
  if (await isCloudflareChallenge(page)) {
    throw new Error(
      'A janela do Chrome esta no desafio da Cloudflare. ' +
        'Clique em "Confirme que e humano" nela e rode de novo.',
    );
  }
  if (!(await page.locator('text=/Sair|Logout|Bem.?vindo/i').count())) {
    throw new Error(
      'A janela nao esta logada no portal. Faca o login nela (npm run abrir-chrome) e rode de novo.',
    );
  }

  await registrar(page, '01-sessao');

  // --- Procurar o caminho ate as publicacoes ---
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a, button, [onclick]')]
      .map((el) => ({
        texto: (el.innerText || el.value || '').trim(),
        href: el.getAttribute('href') || '',
        onclick: (el.getAttribute('onclick') || '').slice(0, 120),
      }))
      .filter((x) => /public|intima|hist[oó]ric|di[aá]rio|processo|andamento/i.test(x.texto + x.href)),
  );
  fs.writeFileSync(path.join(RECON, 'candidatos-menu.json'), JSON.stringify(links, null, 2));
  log.info(`[recon] ${links.length} candidatos de menu para "publicacoes".`);

  log.info(`Pronto. Artefatos em: ${RECON}`);
} catch (e) {
  log.error('Recon falhou:', e.message);
  await registrar(page, '99-erro').catch(() => {});
  process.exitCode = 1;
} finally {
  // Só desconecta: a janela é do usuário e continua aberta para a próxima vez.
  await browser.close().catch(() => {});
}
