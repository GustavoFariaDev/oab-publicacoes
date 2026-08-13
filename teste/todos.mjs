/** Roda todas as suites e falha se qualquer uma falhar. */
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Log das suites vai para pasta descartavel. Sem isto, rodar os testes despeja
// as linhas deles no log do dia — o mesmo arquivo que se le quando a execucao
// das 14h quebra.
const LOG_DESCARTAVEL = fs.mkdtempSync(path.join(os.tmpdir(), 'oab-log-'));
const SUITES = ['prazo.mjs', 'merge.mjs', 'estado.mjs', 'saude.mjs', 'feriado-local.mjs', 'advogado.mjs'];

let falhou = false;
const resumo = [];

for (const suite of SUITES) {
  console.log(`\n━━━ ${suite} ━━━`);
  const r = spawnSync(process.execPath, [path.join(AQUI, suite)], {
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1', LOG_DIR: LOG_DESCARTAVEL },
  });
  const saida = `${r.stdout}${r.stderr}`;
  const linhas = saida.split('\n').filter((l) => /^\s+(ok|FALHA)|falha\(s\)/.test(l));
  console.log(linhas.join('\n'));
  const placar = saida.match(/(\d+) ok, (\d+) falha/);
  resumo.push(`${suite}: ${placar ? `${placar[1]} ok, ${placar[2]} falha(s)` : 'NAO RODOU'}`);
  if (r.status !== 0) falhou = true;
}

console.log(`\n━━━ RESUMO ━━━\n${resumo.join('\n')}`);
console.log(falhou ? '\nHA FALHAS.' : '\nTudo verde.');
process.exitCode = falhou ? 1 : 0;
