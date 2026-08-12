/**
 * Abre uma janela do Chrome NORMAL, com porta de depuracao, para o portal da OAB.
 *
 * Por que assim: o Chrome lancado pelo Playwright e reprovado pelo Cloudflare
 * Turnstile mesmo com um humano clicando na caixa — as marcas de automacao do
 * lancador entregam o navegador. Aqui o Chrome e iniciado como um processo
 * comum do sistema; quem navega e clica e voce. O robo depois so se conecta a
 * essa janela para LER a pagina que voce ja autenticou.
 *
 *   npm run abrir-chrome
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';

const CANDIDATOS = [
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
];

const chrome = CANDIDATOS.find((p) => p && fs.existsSync(p));
if (!chrome) {
  console.error('Chrome nao encontrado. Instale o Google Chrome.');
  process.exit(1);
}

// Perfil dedicado: o Chrome recusa a porta de depuracao no perfil padrao, e
// manter separado evita mexer nas suas abas e senhas do dia a dia.
const perfil = path.join(config.paths.root, 'chrome-profile');
fs.mkdirSync(perfil, { recursive: true });

const porta = new URL(config.cdpEndpoint).port || '9222';

const filho = spawn(
  chrome,
  [
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    config.urls.login,
  ],
  { detached: true, stdio: 'ignore' },
);
filho.unref();

/**
 * Confirma que a porta de depuracao subiu de verdade.
 *
 * Sem isso, "abri o Chrome" e "o robo enxerga o Chrome" viram a mesma frase na
 * cabeca de quem esta usando — e nao sao: uma janela normal do navegador (ou
 * outro navegador) nao tem porta nenhuma, e a diferenca so aparece muito
 * depois, na forma de "nao achei um Chrome aberto".
 */
async function esperarPorta(tentativas = 20) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return (await r.json()).Browser;
    } catch {
      /* ainda subindo */
    }
    await new Promise((s) => setTimeout(s, 500));
  }
  return null;
}

const navegador = await esperarPorta();

if (!navegador) {
  console.error(`
────────────────────────────────────────────────────────────────
 O Chrome abriu, mas a porta ${porta} não respondeu.

 Causa mais comum: já havia uma janela do Chrome aberta com ESTE
 mesmo perfil, e a nova só virou uma aba dela — sem porta.
 Feche todas as janelas do Chrome e rode de novo.
────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

console.log(`
────────────────────────────────────────────────────────────────
 ${navegador} aberto na porta ${porta}, com perfil próprio.
 O robô CONSEGUE enxergar esta janela.

 Nela:
   1. Clique em "Confirme que é humano" (Cloudflare), se aparecer
   2. Faça o login no portal da OAB
   3. DEIXE A JANELA ABERTA

 Atenção: o login do seu navegador do dia a dia (Brave, Edge, outra
 janela do Chrome) NÃO vale aqui — este é um perfil separado, de
 propósito. É uma vez só: a sessão fica salva em chrome-profile/.

 Depois disso:
   npm run dry
────────────────────────────────────────────────────────────────
`);
