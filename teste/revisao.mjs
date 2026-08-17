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
// Portal ligado: e a configuracao de producao, e ela muda o que a revisao pode
// afirmar sobre um dia que ela mesma criou (ver recordComplemento).
process.env.PORTAL = '1';
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
const TODOS = new Set(['whatsapp', 'email']);
const d14 = () => ler().days['2026-08-14'];
const enviadoOriginal = d14().enviadoEm;
recordComplemento('2026-08-14', { publicacoes: [pub('f')], completo: true, entregues: TODOS });
eq('id novo entra na lista', d14().ids.includes('f'), true);
eq('ids nao se perdem', d14().ids.length, 6);
eq('esperado sobe junto', d14().esperado, 6);
eq('extraido sobe junto', d14().extraido, 6);
eq('marca quando foi revisado', Boolean(d14().revisadoEm), true);
// enviadoEm e a auditoria de quando o dia saiu de verdade. A revisao acontece
// no dia seguinte; carimbar por cima apagaria o unico registro disso.
eq('enviadoEm original e preservado', d14().enviadoEm, enviadoOriginal);

// Rodar de novo com a MESMA publicacao nao pode inflar a contagem: o id ja esta
// la, entao nao entrou nada.
recordComplemento('2026-08-14', { publicacoes: [pub('f')], completo: true, entregues: TODOS });
eq('complemento repetido nao infla esperado', d14().esperado, 6);
eq('complemento repetido nao infla ids', d14().ids.length, 6);

// Uma publicacao vista por DUAS fontes carrega dois ids. A contagem tem que
// somar 1 — ela e uma publicacao so.
recordComplemento('2026-08-14', {
  publicacoes: [{ ...pub('h'), identificadores: { CNJ: 'h', Portal: 'h2' } }],
  completo: true,
  entregues: TODOS,
});
eq('publicacao com dois ids conta 1, nao 2', d14().esperado, 7);
eq('mas os dois ids ficam guardados', d14().ids.length, 8);

// --- Canal atrasado fica registrado como atrasado ---
// Complemento que saiu so por e-mail: o WhatsApp deixou de estar em dia com o
// dia, e e por essa lista que o proximo run sabe que precisa voltar nele.
recordComplemento('2026-08-14', {
  publicacoes: [pub('i')],
  completo: true,
  entregues: new Set(['email']),
});
eq('canal que falhou sai da lista', d14().canaisEntregues, ['email']);
eq('mas os ids foram gravados (nao reenvia tudo do zero)', d14().ids.includes('i'), true);

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
recordComplemento('2026-08-13', {
  publicacoes: [pub('y', '999', '13/08/2026')],
  completo: true,
  entregues: TODOS,
});
eq('nao promove "completo" de um dia que ja tinha registro', ler().days['2026-08-13'].completo, false);

// Dia SEM registro nenhum (o robo nao rodou naquele dia): a revisao cria o
// registro, e com o portal LIGADO ele nasce incompleto — o portal nunca foi
// consultado para aquela data, e so dia em aberto volta a ser conferido.
recordComplemento('2026-08-12', {
  publicacoes: [pub('z', '888', '12/08/2026')],
  completo: true,
  entregues: TODOS,
});
eq('dia criado pela revisao com portal ligado nasce incompleto', ler().days['2026-08-12'].completo, false);
eq('dia sem registro nasce com a contagem do lote', ler().days['2026-08-12'].extraido, 1);
eq(
  'dia sem registro registra os canais que receberam',
  ler().days['2026-08-12'].canaisEntregues.sort(),
  ['email', 'whatsapp'],
);
eq('dia sem registro ganha enviadoEm', Boolean(ler().days['2026-08-12'].enviadoEm), true);

// lastError e do dia corrente e roda ANTES da revisao. Se o complemento o
// limpasse, o retry das 16h nao saberia que ficou servico.
recordError('envio', new Error('zap caiu hoje'));
recordComplemento('2026-08-14', { publicacoes: [pub('g')], completo: true, entregues: TODOS });
eq('complemento NAO limpa o lastError', ler().lastError?.stage, 'envio');

// E o erro da revisao nao pode apagar o do dia corrente: e um slot so, e quem
// le o state.json as 16h precisa dos dois motivos.
recordError('revisao', new Error('revisao tambem falhou'), { preservar: true });
eq('erro da revisao junta com o do dia', ler().lastError.stage, 'envio+revisao');
eq(
  'e as duas mensagens sobrevivem',
  ler().lastError.message,
  'zap caiu hoje | revisao tambem falhou',
);

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
