/**
 * Feriado local (FERIADOS_EXTRA): entra na conta E aparece na saida.
 *
 * Suite separada de proposito: `feriados(ano)` guarda o resultado em cache, e
 * config.feriadosExtra le o ambiente. Mexer no FERIADOS_EXTRA no meio de outra
 * suite daria resultado dependente da ordem dos testes — o tipo de teste que
 * passa sozinho e falha em conjunto.
 */
process.env.FERIADOS_EXTRA = '17/08/2026';

const { calcularPrazo, ehDiaUtil, deBR, resumirPrazo, feriadosLocaisNoIntervalo } = await import(
  '../src/prazo.js'
);
const { escreverPrazo } = await import('../src/pdf.js');

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

eq('data do .env vira dia nao util', ehDiaUtil(deBR('17/08/2026')), false);
eq('dia vizinho continua util', ehDiaUtil(deBR('18/08/2026')), true);

// Disp. 12/08 (qua) -> pub. 13/08 -> inicio 14/08 (sex).
// 5 uteis SEM o feriado: 14, 17, 18, 19, 20 -> 20/08.
// 5 uteis COM 17/08 fora:  14, 18, 19, 20, 21 -> 21/08.
const p = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 5 dias' });
eq('feriado local empurra o vencimento', p.fatal, '21/08/2026');
eq('e a saida diz qual data usou', p.feriadosLocais, ['17/08/2026']);

const linha = resumirPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 5 dias' });
eq('resumo do zap mostra o feriado local', linha.includes('feriado local: 17/08/2026'), true);

// Prazo que termina ANTES do feriado nao foi influenciado por ele — e nao pode
// carregar um aviso que nao se aplica. 1 dia util a partir de 14/08 vence no
// proprio 14/08, sem alcancar 17/08.
// (2 dias NAO serve de exemplo: sem o feriado venceria em 17/08, entao ele
// empurra para 18/08 e o aviso e devido — foi o que este teste descobriu.)
const curto = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 1 dia' });
eq('prazo que nao alcanca o feriado nao o cita', curto.feriadosLocais, []);
eq('e vence no proprio dia de inicio', curto.fatal, '14/08/2026');

// Ja um prazo de 2 dias E empurrado: sem o feriado venceria 17/08.
const empurrado = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 2 dias' });
eq('prazo empurrado vence depois', empurrado.fatal, '18/08/2026');
eq('e cita o feriado que o empurrou', empurrado.feriadosLocais, ['17/08/2026']);

eq('intervalo sem feriado local devolve vazio', feriadosLocaisNoIntervalo(deBR('01/09/2026'), deBR('30/09/2026')), []);

// PDF avisa a origem da data
const escrito = [];
const doc = new Proxy(
  {
    text(t) {
      escrito.push(String(t));
      return doc;
    },
  },
  { get: (a, k) => (k in a ? a[k] : () => doc) },
);
escreverPrazo(doc, { dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 5 dias' });
const texto = escrito.join(' ');
eq('PDF mostra o vencimento', texto.includes('Vence em 21/08/2026'), true);
eq('PDF avisa que usou feriado local', texto.includes('feriado local configurado à mão: 17/08/2026'), true);
eq('PDF diz para que lado o erro cai', texto.includes('vencimento real é ANTES'), true);

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
