/**
 * Abre a janela do Chrome que o robo usa para ler o portal da OAB.
 *
 * Por que um Chrome comum, e nao o do Playwright: o portal usa Cloudflare
 * Turnstile, e um navegador lancado pelo Playwright e reprovado no desafio
 * mesmo com um humano clicando na caixa — as marcas de automacao do lancador
 * entregam o navegador. Aqui o Chrome sobe como processo comum do sistema;
 * quem navega e clica e voce. O robo depois so se conecta e LE.
 *
 * O pipeline abre esta janela sozinho quando precisa (ver src/chrome.js), entao
 * este comando serve para o caso em que voce QUER a janela na frente: primeiro
 * login, refazer a sessao, ou conferir se o portal ainda esta acessivel.
 *
 *   npm run abrir-chrome
 */
import { garantirChrome, portaCDP, portaViva } from '../src/chrome.js';
import { conectarChromeAberto } from '../src/browser.js';
import { garantirSessao } from '../src/login.js';

const como = await garantirChrome();
const navegador = await portaViva();

// Tenta o login sozinho, pelo mesmo caminho que voce faria: menu sanduiche >
// INTIMACOES > senha salva > Entrar. Se nao der (Cloudflare, layout mudado),
// nao e erro deste comando — a janela fica aberta justamente para voce
// terminar a mao, que era o unico modo ate agora.
let sessao = 'não confirmada';
const { browser, page } = await conectarChromeAberto({ abrirSePreciso: false });
try {
  sessao = (await garantirSessao(page)) ? 'login feito agora' : 'já estava logado';
} catch (e) {
  sessao = `entre a mão nesta janela — ${String(e.message).split('\n')[0]}`;
} finally {
  await browser.close().catch(() => {});
}

console.log(`
────────────────────────────────────────────────────────────────
 ${navegador ?? 'Chrome'} na porta ${portaCDP()} — ${
   como === 'ja-estava' ? 'já estava aberto' : 'aberto agora'
 }.
 O robô CONSEGUE enxergar esta janela.
 Sessão: ${sessao}.

 Se o login não tiver saído sozinho, nesta janela:
   1. Clique em "Confirme que é humano" (Cloudflare), se aparecer
   2. Menu ☰ (3 barras, canto superior direito) > INTIMAÇÕES
   3. Entre com a senha salva
   4. Pode deixar aberta — mas se fechar, o robô reabre sozinho

 Atenção: o login do seu navegador do dia a dia (Brave, Edge, outra
 janela do Chrome) NÃO vale aqui — este é um perfil separado, de
 propósito. É uma vez só: a sessão fica salva em chrome-profile/.

 Para conferir a coleta agora:
   npm run dry
────────────────────────────────────────────────────────────────
`);
