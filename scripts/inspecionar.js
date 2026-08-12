/**
 * Sessao exploratoria da Fase 1, na janela que VOCE ja abriu e autenticou.
 *
 * Pre-requisito: `npm run abrir-chrome`, clicar no "Confirme que e humano" e
 * fazer o login. Este script apenas se conecta aquela janela (CDP) e ajuda a
 * conferir ou refazer os seletores de src/sources/portal.js.
 *
 * Ele NAO abre navegador proprio, e nao faz login: o Chrome lancado pelo
 * Playwright e reprovado pelo Turnstile mesmo com um humano clicando na caixa,
 * e ter dois caminhos para o mesmo chrome-profile/ so gerava sessao "salva" no
 * lugar errado. Existe um caminho de entrada no portal, e e o abrir-chrome.
 */
import readline from 'node:readline/promises';
import { log } from '../src/log.js';
import { conectarChromeAberto, isCloudflareChallenge } from '../src/browser.js';

const { browser, page } = await conectarChromeAberto();

if (await isCloudflareChallenge(page)) {
  log.warn('A janela esta no desafio da Cloudflare. Clique em "Confirme que e humano" nela.');
}

log.info(`Conectado a janela aberta: ${page.url()}`);

console.log(`
────────────────────────────────────────────────────────────
 Navegue NA JANELA DO CHROME ate: Historico > Publicacoes por Data

 Comandos:
   dump   lista inputs/botoes da tela atual (para refazer seletores)
   url    mostra a URL atual
   sair   desconecta (a janela do Chrome continua aberta)
────────────────────────────────────────────────────────────
`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

for (;;) {
  const cmd = (await rl.question('> ')).trim().toLowerCase();
  if (cmd === 'sair' || cmd === 'exit') break;

  if (cmd === 'url') {
    console.log(page.url());
    continue;
  }

  if (cmd === 'dump') {
    const elementos = await page.evaluate(() =>
      [...document.querySelectorAll('input, button, select, a[href]')]
        .filter((el) => el.offsetParent !== null)
        .slice(0, 80)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          id: el.id || '',
          name: el.name || '',
          texto: (el.innerText || el.value || '').trim().slice(0, 40),
        })),
    );
    console.table(elementos);
    continue;
  }

  console.log('Comandos: dump | url | sair');
}

rl.close();
// Só desconecta: a janela é do usuário e precisa continuar aberta para o robô.
await browser.close().catch(() => {});
log.info('Desconectado. Deixe a janela do Chrome aberta.');
