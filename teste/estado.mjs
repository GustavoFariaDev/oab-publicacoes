/**
 * Regras de estado: quem decide se um dia e reenviado ou esquecido.
 *
 * Roda contra um state.json descartavel (STATE_PATH), nunca o de producao.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oab-teste-')), 'state.json');
process.env.STATE_PATH = arquivo;

const { canaisEntregues, dayRecord, filterNew, isDayComplete, publicationIds, recordError, recordSuccess } =
  await import('../src/state.js');

let ok = 0;
let mal = 0;
const eq = (nome, obtido, esperado) => {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok    ${nome}`);
  } else {
    mal++;
    console.log(`  FALHA ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
  }
};

const limpar = () => fs.writeFileSync(arquivo, JSON.stringify({ days: {} }));
const pub = (id, proc = '123', data = '12/08/2026') => ({
  identificador: id,
  identificadores: id ? { CNJ: id } : {},
  numeroProcesso: proc,
  dataDisponibilizacao: data,
});
const CANAIS = new Set(['whatsapp', 'email']);
const dia = (d = '2026-08-12') => JSON.parse(fs.readFileSync(arquivo, 'utf8')).days[d];

// --- Identidade de uma publicacao ---
eq('id da fonte e usado', publicationIds(pub('694296017')), ['694296017']);
eq(
  'sem id nenhum, cai para processo|data',
  publicationIds(pub('', '1007861-69', '12/08/2026')),
  ['1007861-69|12/08/2026'],
);
eq(
  'ids de VARIAS fontes contam todos',
  publicationIds({ identificadores: { CNJ: 'a', Portal: 'b' }, identificador: 'a' }).sort(),
  ['a', 'b'],
);
// Duas intimacoes distintas do mesmo processo no mesmo dia (caso real do TRT2):
// cada uma tem id proprio, e o fallback processo|data NAO pode entrar junto,
// senao a segunda pareceria "ja enviada" por compartilhar processo e data.
eq(
  'com id, o fallback processo|data nao entra',
  publicationIds(pub('33005', '1000130-40', '11/08/2026')),
  ['33005'],
);

// --- Dedupe ---
limpar();
recordSuccess('2026-08-12', {
  esperado: 2,
  extraido: 2,
  publicacoes: [pub('a'), pub('b')],
  completo: true,
  entregues: new Set(['whatsapp']),
});
eq('filterNew tira o que ja foi', filterNew('2026-08-12', [pub('a'), pub('c')]).length, 1);
eq('filterNew mantem o novo', filterNew('2026-08-12', [pub('a'), pub('c')])[0].identificador, 'c');
eq('dia sem registro: tudo e novo', filterNew('2026-08-99', [pub('a')]).length, 1);
eq('ids nao duplicam ao regravar', dia().ids.length, 2);

// --- Canal faltando deixa o dia em aberto ---
eq('canal pendente -> dia em aberto', isDayComplete('2026-08-12', CANAIS), false);
eq('pendente e o email', [...CANAIS].filter((c) => !canaisEntregues(dia(), CANAIS).has(c)), ['email']);
eq('so whatsapp ligado -> resolvido', isDayComplete('2026-08-12', new Set(['whatsapp'])), true);

recordSuccess('2026-08-12', {
  esperado: 2,
  extraido: 2,
  publicacoes: [pub('a'), pub('b')],
  completo: true,
  entregues: new Set(['whatsapp', 'email']),
});
eq('canais completos -> resolvido', isDayComplete('2026-08-12', CANAIS), true);

// --- Fonte incompleta segura o dia mesmo com tudo entregue ---
recordSuccess('2026-08-13', {
  esperado: 2,
  extraido: 2,
  publicacoes: [pub('x')],
  completo: false,
  entregues: new Set(['whatsapp', 'email']),
});
eq('fonte incompleta -> dia em aberto', isDayComplete('2026-08-13', CANAIS), false);

// --- Registro antigo, gravado antes dos campos novos ---
fs.writeFileSync(
  arquivo,
  JSON.stringify({ days: { '2026-08-10': { esperado: 5, extraido: 5, enviadoEm: 'x', ids: [] } } }),
);
eq(
  'legado: assume canais entregues (nao reenvia em massa)',
  [...canaisEntregues(dia('2026-08-10'), CANAIS)].sort(),
  ['email', 'whatsapp'],
);
eq(
  'legado: sem "completo" o dia NAO e dado por resolvido',
  isDayComplete('2026-08-10', CANAIS),
  false,
);

// --- Contagem que nao bate segura o dia ---
limpar();
recordSuccess('2026-08-14', {
  esperado: 7,
  extraido: 5,
  publicacoes: [pub('z')],
  completo: true,
  entregues: new Set(['whatsapp', 'email']),
});
eq('extraido < esperado -> dia em aberto', isDayComplete('2026-08-14', CANAIS), false);

// --- lastError ---
recordError('envio', new Error('canal caiu'));
eq('recordError grava a etapa', JSON.parse(fs.readFileSync(arquivo, 'utf8')).lastError.stage, 'envio');
recordSuccess('2026-08-15', {
  esperado: 1,
  extraido: 1,
  publicacoes: [pub('w')],
  completo: true,
  entregues: new Set(['whatsapp']),
});
eq('sucesso limpa o lastError', JSON.parse(fs.readFileSync(arquivo, 'utf8')).lastError, null);

// --- Poda: dia velho sai, dia recente fica ---
const velho = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
const recente = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
const s = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
s.days[velho] = { ids: [], enviadoEm: 'x' };
s.days[recente] = { ids: [], enviadoEm: 'x' };
fs.writeFileSync(arquivo, JSON.stringify(s));
recordError('coleta', new Error('forca uma gravacao'));
const depois = JSON.parse(fs.readFileSync(arquivo, 'utf8')).days;
eq('poda apaga dia de 200 dias atras', velho in depois, false);
eq('poda mantem dia de 10 dias atras', recente in depois, true);

// --- Arquivo corrompido nao derruba o processo ---
fs.writeFileSync(arquivo, '{ isso nao e json');
eq('state.json corrompido -> comeca do zero', dayRecord('2026-08-12'), null);

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
