/**
 * A inscricao consta como ADVOGADO na publicacao?
 *
 * As duas fontes acham publicacao por criterios diferentes: a API do CNJ e
 * consultada por inscricao, o portal recorta por NOME. Casos reais de
 * 12/08/2026 (dados anonimizados aqui) mostraram o portal trazendo processos
 * em que a pessoa e PARTE, um deles com outro advogado constituido.
 */
import { oabConstaComoAdvogado } from '../src/merge.js';

let ok = 0;
let mal = 0;
const eq = (nome, obtido, esperado) => {
  if (obtido === esperado) {
    ok++;
    console.log(`  ok    ${nome}`);
  } else {
    mal++;
    console.log(`  FALHA ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
  }
};

const OAB = '437271';

// --- Veio da API: a consulta e por inscricao, entao ele consta por definicao ---
eq(
  'publicacao da API conta como advogado',
  oabConstaComoAdvogado({ fontes: ['CNJ'], intimacao: 'texto sem OAB nenhuma' }, OAB),
  true,
);
eq(
  'publicacao das duas fontes tambem',
  oabConstaComoAdvogado({ fontes: ['CNJ', 'Portal'], intimacao: 'sem OAB' }, OAB),
  true,
);

// --- So do portal: depende do texto ---
const soPortal = (intimacao) => oabConstaComoAdvogado({ fontes: ['Portal'], intimacao }, OAB);

eq('acha "OAB SP437271"', soPortal('ADVOGADO(A) : FULANO DE TAL (OAB SP437271) ATO ORDINATORIO'), true);
eq('acha "OAB 437271/SP"', soPortal('ADV: FULANO DE TAL (OAB 437271/SP)'), true);
eq('acha "OAB: 437271"', soPortal('advogado inscrito na OAB: 437271'), true);

// O caso real: nome no polo ativo, OUTRO advogado constituido.
eq(
  'outro advogado constituido -> nao consta',
  soPortal('Intime-se. - ADV: OUTRA PESSOA (OAB 268348/SP) ||| POLO ATIVO: FULANO DE TAL'),
  false,
);
// O outro caso real: nome entre as partes, nenhuma OAB no texto.
eq(
  'nome entre as partes, sem OAB nenhuma -> nao consta',
  soPortal('Processo ... - Equivalencia salarial - Beltrano - - Fulano de Tal - - Sicrana - Vistos.'),
  false,
);

// --- Nao pode confundir com outra inscricao parecida ---
// 4372710 e a inscricao de OUTRO advogado, e contem 437271 como prefixo.
eq('inscricao maior com o mesmo prefixo nao conta', soPortal('ADV: ALGUEM (OAB 4372710/SP)'), false);
eq('inscricao com sufixo de letra ainda conta', soPortal('ADV: FULANO (OAB 437271-O/SP)'), true);
eq('numero solto sem "OAB" antes nao conta', soPortal('valor de R$ 437271,00 depositado'), false);

// --- Sem numero configurado, nao ha o que afirmar ---
eq('sem numero de OAB -> assume que consta', oabConstaComoAdvogado({ fontes: ['Portal'], intimacao: 'x' }, ''), true);
eq('publicacao sem texto -> nao consta', soPortal(''), false);

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
