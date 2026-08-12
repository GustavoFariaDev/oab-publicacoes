import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

/**
 * Sobe (ou reaproveita) o Chrome com porta de depuracao.
 *
 * Este arquivo existe para a automacao NAO depender de alguem lembrar de abrir
 * o navegador. A janela e um insumo do robo como qualquer outro: se nao esta
 * de pe as 14h, ele levanta sozinho. O que continua sendo humano e so o que
 * nao da para automatizar — o desafio da Cloudflare e o login, cuja sessao
 * fica salva em chrome-profile/ e normalmente sobrevive por semanas.
 */

const CANDIDATOS = [
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
];

export function acharChrome() {
  return CANDIDATOS.find((p) => p && fs.existsSync(p)) ?? null;
}

export const portaCDP = () => new URL(config.cdpEndpoint).port || '9222';

/** Responde na porta de depuracao? Devolve o nome do navegador, ou null. */
export async function portaViva(timeoutMs = 1000) {
  try {
    const r = await fetch(`http://127.0.0.1:${portaCDP()}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? (await r.json()).Browser : null;
  } catch {
    return null;
  }
}

/**
 * Garante uma janela de pe. Devolve como ela ficou disponivel.
 *
 * @returns {Promise<'ja-estava'|'aberto-agora'>}
 * @throws se o Chrome nao existir ou a porta nao subir
 */
export async function garantirChrome({ esperaMs = 15000 } = {}) {
  const vivo = await portaViva();
  if (vivo) return 'ja-estava';

  const chrome = acharChrome();
  if (!chrome) {
    throw new Error('Chrome nao encontrado nos caminhos padrao. Instale o Google Chrome.');
  }

  // Perfil dedicado: o Chrome recusa a porta de depuracao no perfil padrao, e
  // manter separado evita mexer nas abas e senhas do dia a dia do usuario.
  fs.mkdirSync(config.paths.chromeProfile, { recursive: true });

  log.info('Chrome nao estava aberto — abrindo com a sessao salva.');
  const filho = spawn(
    chrome,
    [
      `--remote-debugging-port=${portaCDP()}`,
      `--user-data-dir=${config.paths.chromeProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Sem isto, uma janela reaberta apos fechamento abrupto (que e a regra
      // aqui: o robo mata o processo, nao fecha pelo X) sobe com o balao "O
      // Chrome nao foi encerrado corretamente" por cima da pagina, e o scraper
      // le a caixa de dialogo em vez do portal.
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      config.urls.publicacoes,
    ],
    { detached: true, stdio: 'ignore' },
  );
  filho.unref();

  const limite = Date.now() + esperaMs;
  while (Date.now() < limite) {
    if (await portaViva()) return 'aberto-agora';
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `O Chrome foi iniciado mas a porta ${portaCDP()} nao respondeu em ${esperaMs / 1000}s. ` +
      'Causa comum: ja havia uma janela aberta com este mesmo perfil e a nova virou aba dela. ' +
      'Feche todas as janelas do Chrome e tente de novo.',
  );
}
