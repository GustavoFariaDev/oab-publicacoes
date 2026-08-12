import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO } from './config.js';

fs.mkdirSync(config.paths.logs, { recursive: true });
const logFile = path.join(config.paths.logs, `${todayISO()}.log`);

/**
 * Apaga log com mais de 90 dias.
 *
 * Um arquivo por dia, para sempre, e lixo que ninguem vai limpar a mao numa
 * automacao que roda sozinha. 90 dias cobre com folga a duvida realista
 * ("o que aconteceu naquele dia que o prazo passou?") sem virar arquivo morto.
 * Falha aqui e ignorada de proposito: faxina nao pode derrubar o envio do dia.
 */
function limparLogsAntigos(dias = 90) {
  const limite = Date.now() - dias * 86400000;
  try {
    for (const nome of fs.readdirSync(config.paths.logs)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(nome)) continue;
      const alvo = path.join(config.paths.logs, nome);
      if (fs.statSync(alvo).mtimeMs < limite) fs.unlinkSync(alvo);
    }
  } catch {
    /* faxina e best-effort */
  }
}

limparLogsAntigos();

function write(level, args) {
  const stamp = new Date().toISOString();
  const message = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const line = `[${stamp}] ${level.padEnd(5)} ${message}`;
  // A tarefa agendada roda sem terminal a vista: o arquivo e a fonte da verdade.
  fs.appendFileSync(logFile, line + '\n');
  console.log(line);
}

export const log = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
};
