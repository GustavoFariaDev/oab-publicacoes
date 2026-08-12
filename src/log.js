import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO } from './config.js';

fs.mkdirSync(config.paths.logs, { recursive: true });
const logFile = path.join(config.paths.logs, `${todayISO()}.log`);

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
