/**
 * Revisao do dia anterior: quais dias ela olha, e o que ela grava quando acha
 * publicacao atrasada.
 *
 * Roda contra um state.json descartavel (STATE_PATH) — nunca o de producao. Nao
 * bate na API do CNJ: pendentesDoDia depende de rede e e exercitada na mao com
 * `npm run dry`; o que se testa aqui e a parte que decide reenvio.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oab-teste-')), 'state.json');
process.env.STATE_PATH = arquivo;
process.env.CANAIS = 'whatsapp,email';
// Sem feriado de configuracao: a lista de dias tem que sair da regra, nao do
// .env de quem roda o teste.
process.env.FERIADOS_EXTRA = '';
process.env.FERIADOS_COMARCA = '';

const { diasParaRevisar, temHistorico } = await import('../src/revisao.js');
const { recordComplemento, recordError, recordSuccess } = await import('../src/state.js');

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
const ler = () => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const pub = (id, proc = '123', data = '14/08/2026') => ({
  identificador: id,
  identificadores: { CNJ: id },
  numeroProcesso: proc,
  dataDisponibilizacao: data,
});

// --- Quais dias entram na revisao ---
// Terca revisa segunda.
eq('dia util revisa a vespera', diasParaRevisar('18/08/2026', 1), ['17/08/2026']);
// Segunda revisa a SEXTA: sabado e domingo o Diario nao circula, e olhar para
// eles gastaria a unica consulta da revisao num dia garantidamente vazio.
eq('segunda pula o fim de semana', diasParaRevisar('17/08/2026', 1), ['14/08/2026']);
eq(
  'dois dias, do mais recente ao mais antigo',
  diasParaRevisar('17/08/2026', 2),
  ['14/08/2026', '13/08/2026'],
);
// Feriado NAO e pulado: tem publicacao, o robo roda nele de proposito, e nao ha
// lista confiavel de feriado forense. 08/09/2026 e terca; 07/09 (segunda) e
// feriado nacional e mesmo assim entra.
eq('feriado nao e pulado', diasParaRevisar('08/09/2026', 1), ['07/09/2026']);
eq('quantidade 0 desliga', diasParaRevisar('18/08/2026', 0), []);
eq('data ilegivel nao gera dia', diasParaRevisar('bobagem', 1), []);

// --- Instalacao nova nao tem passado ---
limpar();
eq('estado vazio -> sem historico', temHistorico(), false);
recordSuccess('2026-08-14', {
  esperado: 5,
  extraido: 5,
  publicacoes: [pub('a'), pub('b'), pub('c'), pub('d'), pub('e')],
  completo: true,
  entregues: new Set(['whatsapp', 'email']),
});
eq('com um dia gravado -> ha historico', temHistorico(), true);

// --- Complemento: o caso que motivou tudo ---
// 14/08 saiu com 5; a revisao do dia seguinte acha a 6a na API.
recordComplemento('2026-08-14', { publicacoes: [pub('f')], completo: true });
const d14 = () => ler().days['2026-08-14'];
eq('id novo entra na lista', d14().ids.includes('f'), true);
eq('ids nao se perdem', d14().ids.length, 6);
eq('esperado sobe junto', d14().esperado, 6);
eq('extraido sobe junto', d14().extraido, 6);
eq('marca quando foi revisado', Boolean(d14().revisadoEm), true);

// Rodar de novo com a MESMA publicacao nao pode inflar a contagem: o id ja esta
// la, entao nao entrou nada.
recordComplemento('2026-08-14', { publicacoes: [pub('f')], completo: true });
eq('complemento repetido nao infla esperado', d14().esperado, 6);
eq('complemento repetido nao infla ids', d14().ids.length, 6);

// --- O que o complemento NAO pode reescrever ---
// Dia fechado com o portal caido: uma revisao que so olhou a API do CNJ nao tem
// como absolver o portal.
recordSuccess('2026-08-13', {
  esperado: 11,
  extraido: 11,
  publicacoes: [pub('x', '999', '13/08/2026')],
  completo: false,
  entregues: new Set(['whatsapp', 'email']),
});
recordComplemento('2026-08-13', { publicacoes: [pub('y', '999', '13/08/2026')], completo: true });
eq('nao promove "completo" de um dia que ja tinha registro', ler().days['2026-08-13'].completo, false);

// Dia SEM registro nenhum (o robo nao rodou): ai sim vale a opiniao da revisao.
recordComplemento('2026-08-12', { publicacoes: [pub('z', '888', '12/08/2026')], completo: false });
eq('dia sem registro herda o "completo" da revisao', ler().days['2026-08-12'].completo, false);
eq('dia sem registro nasce com a contagem do lote', ler().days['2026-08-12'].extraido, 1);
eq(
  'dia sem registro registra os canais',
  ler().days['2026-08-12'].canaisEntregues.sort(),
  ['email', 'whatsapp'],
);

// lastError e do dia corrente e roda ANTES da revisao. Se o complemento o
// limpasse, o retry das 16h nao saberia que ficou servico.
recordError('envio', new Error('zap caiu hoje'));
recordComplemento('2026-08-14', { publicacoes: [pub('g')], completo: true });
eq('complemento NAO limpa o lastError', ler().lastError?.stage, 'envio');

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
