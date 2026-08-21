/** Completar o texto cortado do portal: quando aceita, e quando se cala. */
import { completarInteiroTeor } from '../src/inteiro-teor.js';

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

const cortada = (extra = {}) => ({
  fonte: 'Portal',
  fontes: ['Portal'],
  numeroProcesso: '1000000-00.2026.8.26.0100',
  dataDisponibilizacao: '19/08/2026',
  intimacao: 'inicio do texto que o portal entregou pela metade...',
  ...extra,
});

/** Fabrica um "buscar" de mentira, e conta quantas vezes foi chamado. */
const stub = (resposta) => {
  const chamadas = [];
  const fn = async (proc, data) => {
    chamadas.push([proc, data]);
    return typeof resposta === 'function' ? resposta(proc, data) : resposta;
  };
  fn.chamadas = chamadas;
  return fn;
};

const semPausa = (buscar) => ({ buscar, pausaMs: 0 });

// --- O caso feliz ---
{
  const pub = cortada();
  const buscar = stub([{ intimacao: 'texto inteiro do DJEN', certidao: 'https://exemplo/certidao' }]);
  const r = await completarInteiroTeor([pub], semPausa(buscar));
  eq('texto cortado e completado', pub.intimacao, 'texto inteiro do DJEN');
  eq('a certidao vem junto', pub.certidao, 'https://exemplo/certidao');
  eq('e fica registrado de onde veio', pub.textoCompletadoPor, 'DJEN (consulta por processo)');
  eq('sem aviso de corte quando completou', r.avisos.length, 0);
  // O detalhe que protege o "sua OAB nao aparece no texto": a consulta foi por
  // PROCESSO, e nao prova que a inscricao advoga ali.
  eq('fontes NAO ganha CNJ', pub.fontes, ['Portal']);
}

// --- Quem nao deve ser consultado ---
{
  const jaTemCNJ = cortada({ fontes: ['Portal', 'CNJ'] });
  const buscar = stub([{ intimacao: 'nao deveria ser usado' }]);
  await completarInteiroTeor([jaTemCNJ], semPausa(buscar));
  eq('publicacao que ja veio do CNJ nao e consultada', buscar.chamadas.length, 0);
}
{
  const inteira = cortada({ intimacao: 'texto completo, sem reticencias no fim.' });
  const buscar = stub([{ intimacao: 'x' }]);
  await completarInteiroTeor([inteira], semPausa(buscar));
  eq('texto nao cortado nao e consultado', buscar.chamadas.length, 0);
}
{
  const semProcesso = cortada({ numeroProcesso: '' });
  const buscar = stub([{ intimacao: 'x' }]);
  await completarInteiroTeor([semProcesso], semPausa(buscar));
  eq('sem numero de processo nao ha o que consultar', buscar.chamadas.length, 0);
}

// --- Ambiguidade: na duvida, NAO cola texto ---
{
  const pub = cortada();
  const original = pub.intimacao;
  const buscar = stub([{ intimacao: 'primeira intimacao' }, { intimacao: 'segunda intimacao' }]);
  const r = await completarInteiroTeor([pub], semPausa(buscar));
  eq('duas comunicacoes no mesmo dia: nao escolhe', pub.intimacao, original);
  eq('e avisa que o texto ficou cortado', r.avisos[0].includes('TEXTO CORTADO'), true);
}
{
  const pub = cortada();
  const original = pub.intimacao;
  const r = await completarInteiroTeor([pub], semPausa(stub([])));
  eq('nao esta no DJEN: mantem o que tinha', pub.intimacao, original);
  eq('e o aviso sai', r.avisos.length, 1);
}
{
  // O DJEN tambem cortado (nao deveria acontecer, mas se acontecer nao troca).
  const pub = cortada();
  const original = pub.intimacao;
  await completarInteiroTeor([pub], semPausa(stub([{ intimacao: 'tambem cortado...' }])));
  eq('texto cortado nao substitui texto cortado', pub.intimacao, original);
}

// --- Falha da API nao pode custar a publicacao ---
{
  const pub = cortada();
  const buscar = async () => {
    throw new Error('HTTP 429');
  };
  const r = await completarInteiroTeor([pub], semPausa(buscar));
  eq('erro de rede nao derruba a coleta', r.publicacoes.length, 1);
  eq('a publicacao continua la, cortada', pub.intimacao.endsWith('...'), true);
  eq('com aviso', r.avisos[0].includes('TEXTO CORTADO'), true);
}

// --- Teto de consultas: a fonte do dia vale mais que o conforto do texto ---
{
  const pubs = Array.from({ length: 8 }, (_, i) =>
    cortada({ numeroProcesso: `100000${i}-00.2026.8.26.0100` }),
  );
  const buscar = stub([]);
  const r = await completarInteiroTeor(pubs, semPausa(buscar));
  eq('nao passa de 5 consultas por execucao', buscar.chamadas.length, 5);
  eq('e diz que parou pelo limite', r.avisos.some((a) => a.includes('limite de consultas')), true);
}

// --- Lista vazia ---
{
  const r = await completarInteiroTeor([]);
  eq('lista vazia nao consulta nada', r.avisos.length, 0);
}

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
