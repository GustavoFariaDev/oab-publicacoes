import { calcularPrazo, diaUtilSeguinte, deBR, paraBR, ehDiaUtil, prazosDeclarados, resumirPrazo } from '../src/prazo.js';
import { htmlParaTexto } from '../src/sources/cnj.js';

let ok = 0;
let mal = 0;
const eq = (nome, obtido, esperado) => {
  if (obtido === esperado) { ok++; console.log(`  ok    ${nome}`); }
  else { mal++; console.log(`  FALHA ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`); }
};

// --- Feriados e dias uteis (2026: Pascoa 05/04; carnaval 16-17/02; C.Christi 04/06) ---
eq('sabado nao e dia util', ehDiaUtil(deBR('15/08/2026')), false);
eq('domingo nao e dia util', ehDiaUtil(deBR('16/08/2026')), false);
eq('quarta comum e dia util', ehDiaUtil(deBR('12/08/2026')), true);
eq('carnaval (terca) nao e util', ehDiaUtil(deBR('17/02/2026')), false);
eq('sexta-feira santa nao e util', ehDiaUtil(deBR('03/04/2026')), false);
eq('corpus christi nao e util', ehDiaUtil(deBR('04/06/2026')), false);
eq('7 de setembro nao e util', ehDiaUtil(deBR('07/09/2026')), false);
eq('20 de novembro nao e util', ehDiaUtil(deBR('20/11/2026')), false);
eq('recesso: 26/12 nao e util', ehDiaUtil(deBR('26/12/2026')), false);
eq('recesso: 20/01 nao e util', ehDiaUtil(deBR('20/01/2026')), false);
eq('21/01 volta a ser util', ehDiaUtil(deBR('21/01/2026')), true);

// --- Art. 224, §2o: publicacao = 1o dia util seguinte ---
eq('disp. quarta -> pub. quinta', paraBR(diaUtilSeguinte(deBR('12/08/2026'))), '13/08/2026');
eq('disp. sexta -> pub. segunda', paraBR(diaUtilSeguinte(deBR('14/08/2026'))), '17/08/2026');

// --- Fluxo completo. 15 dias uteis desde sexta 14/08/2026:
// 14,17,18,19,20,21,24,25,26,27,28,31/08 (12) + 01,02,03/09 (15) -> 03/09.
const p1 = calcularPrazo({
  dataDisponibilizacao: '12/08/2026',
  intimacao: 'Fica intimado para, no prazo de 15 (quinze) dias, manifestar-se.',
});
eq('pub. calculada', p1.publicacao, '13/08/2026');
eq('inicio = 1o util apos a pub.', p1.inicio, '14/08/2026');
eq('15 dias uteis desde 14/08', p1.fatal, '03/09/2026');
eq('quantidade lida do texto', p1.quantidade, 15);
eq('tipo padrao = uteis', p1.tipo, 'uteis');

// 5 corridos desde 14/08: 14,15,16,17,18 -> 18/08 (terca, util).
const p2 = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'prazo de 5 dias corridos' });
eq('corridos: 5 dias de 14/08 -> 18/08', p2.fatal, '18/08/2026');
eq('corridos detectado', p2.tipo, 'corridos');

// Corridos terminando em dia nao util anda (art. 224, §1o): inicio 07/08 (sex),
// 2 corridos = 07 e 08/08 (sabado) -> 10/08 (segunda).
const p3 = calcularPrazo({ dataDisponibilizacao: '05/08/2026', intimacao: 'prazo de 2 dias corridos' });
eq('corridos terminando no sabado anda para segunda', p3.fatal, '10/08/2026');

// --- Data de publicacao informada pela fonte manda ---
const p4 = calcularPrazo({ dataDisponibilizacao: '12/08/2026', dataPublicacao: '20/08/2026', intimacao: 'prazo de 15 dias' });
eq('pub. informada e respeitada', p4.publicacao, '20/08/2026');
eq('pub. informada marcada', p4.publicacaoInformada, true);
eq('inicio segue a informada', p4.inicio, '21/08/2026');

// --- Recesso: prazo suspenso 20/12 a 20/01 (art. 220) ---
const p5 = calcularPrazo({ dataDisponibilizacao: '17/12/2026', intimacao: 'prazo de 5 dias' });
eq('disp. 17/12 -> pub. 18/12', p5.publicacao, '18/12/2026');
eq('inicio pula o recesso todo', p5.inicio, '21/01/2027');

// --- Sem prazo no texto ---
const p6 = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'Ciencia as partes.' });
eq('sem prazo declarado -> fatal null', p6.fatal, null);
eq('mas inicio ainda e calculado', p6.inicio, '14/08/2026');

// --- NUMERAIS ESCRITOS: o caso real de 12/08/2026 ---
const p7 = calcularPrazo({
  dataDisponibilizacao: '12/08/2026',
  intimacao: 'as partes serão intimadas para que se manifestem, no prazo de quinze dias.',
});
eq('le "prazo de quinze dias"', p7.quantidade, 15);
eq('e calcula a data', p7.fatal, '03/09/2026');
eq('le "em dez dias"', prazosDeclarados('esclarecimentos devidos, em dez dias')[0]?.quantidade, 10);
eq('le "cinco dias"', prazosDeclarados('no prazo de cinco dias')[0]?.quantidade, 5);
eq('"prazo legal" nao inventa numero', prazosDeclarados('manifeste-se no prazo legal').length, 0);

// --- MAIS DE UM PRAZO: nao projeta data, lista os prazos ---
const p8 = calcularPrazo({
  dataDisponibilizacao: '12/08/2026',
  intimacao: 'o perito deverá se manifestar em cinco dias ... Laudo em trinta dias ... as partes serão intimadas no prazo de quinze dias ... esclarecimentos em dez dias',
});
eq('com varios prazos nao calcula vencimento', p8.fatal, null);
eq('lista todos os prazos citados', p8.citados.length, 4);
eq('resumo diz quantos prazos ha', resumirPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'manifestar em cinco dias e laudo em trinta dias' }).includes('cita 2 prazos'), true);
eq('resumo com varios prazos nao diz vence', resumirPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'em cinco dias e em trinta dias' }).includes('vence'), false);
eq('prazo repetido continua sendo um', calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'no prazo de 15 dias ... reitere no prazo de 15 dias' }).fatal, '03/09/2026');

// --- Prazo em horas: nao inventa data ---
const p9 = calcularPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'no prazo de 48 horas' });
eq('horas detectadas', p9.quantidade, 48);
eq('horas nao ganham data fatal', p9.fatal, null);
eq('resumo de horas nao diz vence', resumirPrazo({ dataDisponibilizacao: '12/08/2026', intimacao: 'no prazo de 48 horas' }).includes('vence'), false);

// --- Numero absurdo e ignorado ---
eq('ignora 999 dias', prazosDeclarados('prazo de 999 dias').length, 0);

// --- Data invalida nao explode ---
eq('data vazia -> null', calcularPrazo({ dataDisponibilizacao: '' }), null);
eq('data impossivel -> null', calcularPrazo({ dataDisponibilizacao: '31/02/2026' }), null);
eq('formato ISO nao passa por BR', calcularPrazo({ dataDisponibilizacao: '2026-08-12' }), null);

// --- HTML do DJEN vira texto legivel ---
const html = 'e quesitos e indica&ccedil;&atilde;o de assistente t&eacute;cnico, no prazo legal (art. 465, &sect; 1&ordm;, do CPC). <strong>O peticionamento</strong><p>outro par&aacute;grafo</p>';
const texto = htmlParaTexto(html);
eq('decodifica entidades', texto.includes('indicação de assistente técnico'), true);
eq('decodifica §  e ordinal', texto.includes('§ 1º'), true);
eq('remove tags', /<[^>]+>/.test(texto), false);
eq('paragrafo vira quebra', texto.includes('\n'), true);
eq('script sai inteiro', htmlParaTexto('a<script>alert(1)</script>b'), 'a b');
eq('prazo e lido depois de decodificar', prazosDeclarados(htmlParaTexto('no prazo de 15 (quinze) dias&nbsp;&uacute;teis'))[0]?.tipo, 'uteis');

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
