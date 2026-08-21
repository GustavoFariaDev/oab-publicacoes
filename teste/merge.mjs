/** Uniao das fontes: o que funde, o que NAO funde, e qual texto sobrevive. */
import { unir, formatarPartes } from '../src/merge.js';

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

// Texto longo o bastante para passar do piso de MINIMO_PALAVRAS.
const CORPO =
  'fica a parte autora intimada para se manifestar sobre a certidao do oficial de justica ' +
  'no prazo legal sob pena de extincao do feito conforme decisao proferida nos autos em epigrafe ' +
  'com as advertencias legais pertinentes ao caso concreto ora analisado por este juizo';

const pub = (fonte, extra = {}) => ({
  fonte,
  identificador: '',
  numeroProcesso: '1000000-00.2024.8.26.0100',
  dataDisponibilizacao: '12/08/2026',
  intimacao: CORPO,
  ...extra,
});

// --- Mesmo identificador entre fontes e prova, nao indicio ---
{
  const r = unir({
    CNJ: [pub('CNJ', { identificador: '694327392', intimacao: 'texto totalmente diferente aqui' })],
    Portal: [pub('Portal', { identificador: '694327392' })],
  });
  eq('mesmo identificador funde mesmo com texto diferente', r.publicacoes.length, 1);
  eq('guarda o id das duas fontes', r.publicacoes[0].identificadores, {
    CNJ: '694327392',
    Portal: '694327392',
  });
}

// --- Contencao: o portal corta o texto, o Jaccard despencaria ---
{
  const cortado = `${CORPO.slice(0, 120)}...`;
  const r = unir({ CNJ: [pub('CNJ')], Portal: [pub('Portal', { intimacao: cortado })] });
  eq('previa cortada funde com o inteiro teor', r.publicacoes.length, 1);
  eq('fica o texto INTEIRO, nao o mais longo', r.publicacoes[0].intimacao, CORPO);
}

// --- Texto truncado maior nao ganha do inteiro menor (caso 4008232-46) ---
{
  const curtoInteiro = 'intimada a parte para ciencia do desarquivamento dos autos no prazo de cinco dias uteis';
  const longoCortado = `${CORPO}...`;
  const r = unir({
    CNJ: [pub('CNJ', { intimacao: curtoInteiro })],
    Portal: [pub('Portal', { intimacao: longoCortado })],
  });
  // Nao fundem (textos diferentes), mas o teste que importa e o de cima:
  // quando fundem, o inteiro ganha. Aqui so garantimos que nao some ninguem.
  eq('textos diferentes nao fundem', r.publicacoes.length, 2);
}

// --- DENTRO da mesma fonte nada funde, nem com texto identico ---
{
  const r = unir({ CNJ: [pub('CNJ'), pub('CNJ')] });
  eq('duas do mesmo processo e fonte continuam duas', r.publicacoes.length, 2);
}

// --- Processos diferentes nunca fundem ---
{
  const r = unir({
    CNJ: [pub('CNJ')],
    Portal: [pub('Portal', { numeroProcesso: '9999999-99.2024.8.26.0000' })],
  });
  eq('processos diferentes nao fundem', r.publicacoes.length, 2);
}

// --- Texto curto nao pode fundir por contencao ---
{
  const r = unir({
    CNJ: [pub('CNJ', { intimacao: 'ciencia as partes' })],
    Portal: [pub('Portal', { intimacao: 'ciencia as partes do inteiro teor da sentenca proferida' })],
  });
  eq('texto curto nao funde (piso de palavras)', r.publicacoes.length, 2);
}

// --- Campos vazios sao preenchidos pela outra fonte ---
{
  const r = unir({
    CNJ: [pub('CNJ', { identificador: 'x', dataPublicacao: '', vara: '' })],
    Portal: [pub('Portal', { identificador: 'x', dataPublicacao: '13/08/2026', vara: '9a Vara Civel' })],
  });
  eq('data de publicacao vem da fonte que tem', r.publicacoes[0].dataPublicacao, '13/08/2026');
  eq('vara vem da fonte que tem', r.publicacoes[0].vara, '9a Vara Civel');
}

// --- Listas vazias tambem sao preenchidas ([] e truthy) ---
{
  const r = unir({
    CNJ: [pub('CNJ', { identificador: 'y', partes: [] })],
    Portal: [pub('Portal', { identificador: 'y', partes: [{ nome: 'FULANO', polo: 'A' }] })],
  });
  eq('partes vazias sao preenchidas', r.publicacoes[0].partes.length, 1);
}

// --- Campos internos nao vazam para fora ---
{
  const r = unir({ CNJ: [pub('CNJ')] });
  eq('nada de _texto/_tokens no resultado', Object.keys(r.publicacoes[0]).filter((k) => k.startsWith('_')), []);
}

// --- Exclusividade de fonte vira aviso ---
{
  const r = unir({
    CNJ: [pub('CNJ', { identificador: 'a' })],
    Portal: [pub('Portal', { identificador: 'a' }), pub('Portal', { identificador: 'b', numeroProcesso: '5' })],
  });
  eq('avisa publicacao exclusiva de uma fonte', r.avisos.some((a) => a.includes('Portal')), true);
}

// --- resumoFontes conta o que entrou, nao o que sobrou ---
{
  const r = unir({ CNJ: [pub('CNJ', { identificador: 'z' })], Portal: [pub('Portal', { identificador: 'z' })] });
  eq('resumoFontes conta por fonte', r.resumoFontes, { CNJ: 1, Portal: 1 });
  eq('e o total unico e 1', r.publicacoes.length, 1);
}

// --- formatarPartes: ordem fixa Autor -> Reu ---
eq(
  'partes saem na ordem Autor -> Reu',
  formatarPartes([
    { nome: 'CIA X', polo: 'P' },
    { nome: 'FULANO', polo: 'A' },
  ]),
  ['Autor: FULANO', 'Réu: CIA X'],
);
eq('parte sem nome e ignorada', formatarPartes([{ nome: '', polo: 'A' }]), []);
eq('polo desconhecido passa cru', formatarPartes([{ nome: 'X', polo: 'T' }]), ['T: X']);

// --- Certidao oficial: so o CNJ tem, e ela nao pode se perder na uniao ---
{
  // O grupo e criado pelo PORTAL (que nao tem certidao) e so depois o CNJ
  // chega. Sem o campo na lista de merge, o link oficial sumia justamente nas
  // publicacoes que existem nas duas fontes.
  const r = unir({
    Portal: [pub('Portal', { identificador: 'x' })],
    CNJ: [pub('CNJ', { identificador: 'x', certidao: 'https://exemplo/certidao' })],
  });
  eq('as duas fontes viraram uma', r.publicacoes.length, 1);
  eq('a certidao do CNJ sobrevive a uniao', r.publicacoes[0].certidao, 'https://exemplo/certidao');
}

{
  // Publicacao que so existe no portal continua sem certidao — e isso e
  // correto: nao ha certidao do CNJ para um ato que nao passou pelo DJEN.
  const r = unir({ Portal: [pub('Portal', { identificador: 'y' })] });
  eq('portal sozinho nao inventa certidao', r.publicacoes[0].certidao ?? null, null);
}

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
