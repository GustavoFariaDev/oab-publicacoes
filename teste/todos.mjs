/** Roda todas as suites e falha se qualquer uma falhar. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SUITES = ['prazo.mjs', 'merge.mjs', 'estado.mjs'];

let falhou = false;
const resumo = [];

for (const suite of SUITES) {
  console.log(`\n━━━ ${suite} ━━━`);
  const r = spawnSync(process.execPath, [path.join(AQUI, suite)], {
    encoding: 'utf8',
    // Log de INFO das suites so polui: o que interessa e a linha de cada teste.
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
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
