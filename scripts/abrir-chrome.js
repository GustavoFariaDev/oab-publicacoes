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

console.log(`
────────────────────────────────────────────────────────────────
 Chrome aberto na porta ${porta}, com perfil próprio.

 Na janela que abriu:
   1. Clique em "Confirme que é humano" (Cloudflare), se aparecer
   2. Faça o login no portal da OAB
   3. DEIXE A JANELA ABERTA

 Depois disso o robô consegue ler o portal:
   npm run dry
────────────────────────────────────────────────────────────────
`);
