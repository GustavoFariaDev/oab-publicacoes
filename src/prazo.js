import { config } from './config.js';

/**
 * Contagem de prazo a partir da data de disponibilizacao.
 *
 * Regras (buscadordjen.com.br/wiki, que cita o CPC):
 *   1. Disponibilizacao: o dia em que o ato apareceu no DJe.
 *   2. Publicacao: PRIMEIRO DIA UTIL seguinte a disponibilizacao (art. 224, §2o).
 *   3. Inicio da contagem: primeiro dia util seguinte a publicacao.
 *   4. Cada dia e conferido contra feriado e recesso; o prazo fatal que cair em
 *      dia nao util anda para o proximo dia util.
 *   5. Recesso forense de 20/12 a 20/01, inclusive: prazo suspenso (art. 220).
 *
 * O QUE ESTA CONTA NAO SABE — e por isso todo numero que sai daqui viaja com
 * "estimativa" grudado nele:
 *
 *   - Feriados estaduais, municipais e forenses (o Dia da Justica, a semana da
 *     criacao dos cursos juridicos, o aniversario da cidade). Nao existe fonte
 *     offline confiavel disso; o buscador usa API do IBGE e um JSON por
 *     tribunal. Aqui entram a mao por FERIADOS_EXTRA no .env.
 *   - Suspensoes especificas do tribunal (greve, migracao de sistema, portaria).
 *   - Prazo em dobro (Fazenda, DP, litisconsortes com procuradores distintos).
 *   - Se o prazo do ato e processual (dias uteis, art. 219) ou material/penal
 *     (dias corridos). O texto da intimacao as vezes diz; quando nao diz,
 *     assumimos uteis, que e a regra do CPC para prazo processual.
 *
 * Por isso a direcao do erro importa: uma data ESTIMADA mais tarde que a real
 * faz perder prazo. Todo lugar que exibe isso diz que e estimativa e manda
 * conferir — nunca substitui a conferencia do prazo no processo.
 */

/** Feriados nacionais de data fixa (dd-mm). 20/11 e nacional desde 2024. */
const FIXOS = ['01-01', '21-04', '01-05', '07-09', '12-10', '02-11', '15-11', '20-11', '25-12'];

/** Data em UTC ao meio-dia: imune a fuso e a horario de verao na aritmetica. */
function utc(ano, mes, dia) {
  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

const chave = (d) => d.toISOString().slice(0, 10);
const somarDias = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * "12/08/2026" -> Date; null se nao for uma data valida.
 *
 * Aceita tambem "2026-08-12": a API do CNJ fala ISO nos parametros de consulta,
 * e um dia pode passar a devolver ISO no corpo. Sem isso, a data viraria null,
 * o bloco de prazo sumiria e ninguem saberia por que — enquanto ISO e formato
 * sem ambiguidade nenhuma, dd/mm ou mm/dd nao entra aqui de graca.
 */
export function deBR(data = '') {
  const texto = String(data).trim();
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!br && !iso) return null;

  const [dd, mm, yyyy] = br ? [br[1], br[2], br[3]] : [iso[3], iso[2], iso[1]];
  const d = utc(Number(yyyy), Number(mm), Number(dd));
  // Rejeita 31/02: o Date rola para marco e o dia deixa de bater.
  return d.getUTCDate() === Number(dd) && d.getUTCMonth() === Number(mm) - 1 ? d : null;
}

/** Date -> "12/08/2026". */
export function paraBR(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Domingo de Pascoa (Meeus/Jones/Butcher) — base dos feriados moveis, que no
 * foro pesam tanto quanto os fixos: nenhum tribunal conta prazo no carnaval.
 */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(ano, mes, dia);
}

const cacheFeriados = new Map();

/**
 * Feriados nacionais de um ano: os fixos e os moveis derivados da Pascoa.
 *
 * So o que e regra, nunca o que vem do .env — por isso da para guardar em
 * cache sem medo. Feriado de configuracao entra por chavesLocais(), que le o
 * ambiente na hora: guardar aquilo aqui faria a primeira chamada congelar o
 * valor e o resto do processo enxergar uma lista velha.
 */
export function feriados(ano) {
  if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);

  const set = new Set(FIXOS.map((dm) => `${ano}-${dm.slice(3)}-${dm.slice(0, 2)}`));
  const p = pascoa(ano);
  // Carnaval e Corpus Christi nao sao feriado nacional por lei, mas sao feriado
  // forense em todo tribunal — ignora-los inventaria dias uteis que nao existem.
  for (const n of [-48, -47, -2, 60]) set.add(chave(somarDias(p, n)));

  cacheFeriados.set(ano, set);
  return set;
}

/** Recesso forense: 20/12 a 20/01, inclusive (art. 220 do CPC). */
export function emRecesso(d) {
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return (mes === 12 && dia >= 20) || (mes === 1 && dia <= 20);
}

/**
 * Codigo da comarca de origem: os 4 ultimos digitos do numero CNJ.
 * "1000000-00.2024.8.26.0100" -> "0100".
 */
export function comarcaDoProcesso(numeroProcesso = '') {
  const digitos = String(numeroProcesso).replace(/\D/g, '');
  return digitos.length >= 4 ? digitos.slice(-4) : '';
}

/** Datas de uma lista dd/mm/aaaa como Set de "aaaa-mm-dd" (so as validas). */
function comoChaves(datas = []) {
  const set = new Set();
  for (const bruto of datas) {
    const d = deBR(bruto);
    if (d) set.add(chave(d));
  }
  return set;
}

const cacheLocais = new Map();

/**
 * Feriados locais que valem para uma comarca: os globais + os dela.
 *
 * Guardado em cache por comarca, mas a chave inclui o valor cru das variaveis
 * de ambiente: um prazo de 30 dias uteis chama ehDiaUtil algumas centenas de
 * vezes, e sem cache cada uma reconstruia os conjuntos do zero. Prender a
 * chave ao ambiente evita o problema que o cache de feriados() ja teve — o de
 * congelar a lista da primeira chamada e ignorar mudanca de configuracao.
 */
function chavesLocais(comarca = '') {
  const chaveCache = `${comarca}|${process.env.FERIADOS_EXTRA ?? ''}|${process.env.FERIADOS_COMARCA ?? ''}`;
  const guardado = cacheLocais.get(chaveCache);
  if (guardado) return guardado;

  const set = comoChaves(config.feriadosExtra);
  for (const data of config.feriadosPorComarca.get(comarca) ?? []) {
    const d = deBR(data);
    if (d) set.add(chave(d));
  }

  cacheLocais.set(chaveCache, set);
  return set;
}

/**
 * Sabado ou domingo.
 *
 * Separado de ehDiaUtil porque responde outra pergunta: nao "conta prazo?", e
 * sim "o Diario circula?". Feriado e recesso sao dia sem prazo mas com
 * publicacao possivel; fim de semana nao tem nem uma coisa nem outra, e e o
 * unico caso em que vale nem ligar o robo (ver src/index.js).
 */
export function ehFimDeSemana(d) {
  const semana = d.getUTCDay();
  return semana === 0 || semana === 6;
}

/**
 * Dia util para fim de prazo: nao e fim de semana, feriado nem recesso.
 *
 * `comarca` muda o resultado so quando ha feriado municipal configurado para
 * ela — o aniversario da cidade nao suspende expediente na comarca vizinha.
 */
export function ehDiaUtil(d, comarca = '') {
  if (ehFimDeSemana(d)) return false;
  if (feriados(d.getUTCFullYear()).has(chave(d))) return false;
  if (chavesLocais(comarca).has(chave(d))) return false;
  return !emRecesso(d);
}

/**
 * Feriados LOCAIS que caem dentro de um intervalo (inclusive).
 *
 * Serve para a saida poder dizer de onde veio a data. Feriado local e a unica
 * parte da conta que vem de configuracao humana, e e a parte cujo erro empurra
 * o vencimento para FRENTE — o lado que faz perder prazo. Um feriado nacional
 * errado seria bug meu; um feriado local errado e uma linha do .env que
 * ninguem lembra de conferir. Entao ele aparece.
 */
export function feriadosLocaisNoIntervalo(inicio, fim, comarca = '') {
  const locais = chavesLocais(comarca);
  if (!locais.size) return [];

  const achados = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
    if (locais.has(chave(d))) achados.push(paraBR(d));
  }
  return achados;
}

/** Primeiro dia util a partir de (e incluindo) a data dada. */
export function diaUtilSeguinte(d, { incluirHoje = false, comarca = '' } = {}) {
  let atual = incluirHoje ? d : somarDias(d, 1);
  // Teto: o recesso ja come 32 dias corridos; 60 cobre recesso + feriados na
  // borda sem risco de laco infinito se FERIADOS_EXTRA vier com bobagem.
  for (let i = 0; i < 60; i++) {
    if (ehDiaUtil(atual, comarca)) return atual;
    atual = somarDias(atual, 1);
  }
  return atual;
}

/** Soma N dias uteis a partir do inicio (que ja deve ser dia util). */
function somarDiasUteis(inicio, dias, comarca = '') {
  let atual = inicio;
  let contados = 1; // o proprio dia de inicio e o 1o dia do prazo
  while (contados < dias) {
    atual = diaUtilSeguinte(atual, { comarca });
    contados++;
  }
  return atual;
}

/**
 * Numerais escritos, que e como o prazo aparece na maior parte das intimacoes:
 * "no prazo de quinze dias", nao "de 15 dias". Medido nas publicacoes de
 * 12/08/2026: o unico ato com prazo dizia "quinze dias" por extenso, e a
 * versao anterior desta leitura (so digitos) achou zero prazo em cinco atos.
 */
const NUMERAIS = {
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14,
  catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, noventa: 90,
};

const UNIDADES = Object.keys(NUMERAIS).join('|');

/**
 * Todos os prazos declarados no texto da intimacao.
 *
 * So aceita o que esta escrito. Nao existe tabela de "prazo tipico por tipo de
 * ato" aqui: chutar 15 dias num ato de 5 e a diferenca entre ter prazo e nao
 * ter. "No prazo legal" continua sem numero de proposito.
 *
 * @returns {{quantidade: number, unidade: 'dias'|'horas', tipo: 'uteis'|'corridos'}[]}
 */
export function prazosDeclarados(texto = '') {
  const achados = [];
  const re = new RegExp(
    // "prazo de 15 (quinze) dias uteis", "prazo de quinze dias", "em dez dias",
    // "no prazo de 48 horas", "prazo sucessivo de 5 dias", "Prazo 15 dias"
    //
    // O \b inicial nao e enfeite: sem ele, o "em" final de qualquer verbo serve
    // de gatilho — "manifestem 5 dias" e "totalizem 30 dias de atraso" viravam
    // prazo do nada.
    String.raw`\b(?:prazos?\s+(?:sucessivo\s+)?(?:de\s+|em\s+)?|em\s+|dentro\s+de\s+)` +
      String.raw`(\d{1,3}|${UNIDADES})\s*` +
      String.raw`(?:\([^)]{0,30}\)\s*)?` +
      String.raw`(dias?|horas?)` +
      String.raw`(\s+[uú]teis|\s+corridos)?`,
    'gi',
  );

  for (const m of texto.matchAll(re)) {
    const cru = m[1].toLowerCase();
    const quantidade = /^\d+$/.test(cru) ? Number(cru) : NUMERAIS[cru];
    if (!quantidade || quantidade > 365) continue;

    const unidade = /hora/i.test(m[2]) ? 'horas' : 'dias';
    const qualificador = (m[3] || '').toLowerCase();
    // Sem qualificador vale a regra do art. 219: prazo processual em dias uteis.
    const tipo = qualificador.includes('corrido') ? 'corridos' : 'uteis';
    // O trecho ANTERIOR ao prazo, que e onde mora o sujeito da frase
    // ("o perito devera ... em cinco dias"). Ver sujeitoDoPrazo.
    const contexto = texto.slice(Math.max(0, m.index - JANELA_SUJEITO), m.index);
    achados.push({ quantidade, unidade, tipo, contexto });
  }
  return achados;
}

/**
 * Quanto texto antes do prazo vale a pena olhar para achar o sujeito.
 *
 * ~300 caracteres e da ordem de 50 palavras: pega a oracao em que o prazo esta
 * e a anterior, sem atravessar o paragrafo inteiro e capturar um figurante que
 * nada tem a ver com aquele prazo.
 */
const JANELA_SUJEITO = 300;

/**
 * Auxiliares do juizo — gente que NUNCA e o advogado constituido.
 *
 * A lista e curta de proposito. "Reu", "autor", "requerido", "executado" ficam
 * DE FORA: qualquer um deles pode ser o seu cliente, e marcar "parece ser do
 * reu" numa intimacao que e sua seria transformar a rede de seguranca em
 * ruido — e alerta ruidoso e alerta ignorado. Aqui so entra quem, se for o
 * sujeito do prazo, com certeza nao e voce.
 */
const AUXILIARES = [
  [/\bperit[oa]s?\b|\bexpert[oa]\b/i, 'do perito'],
  [/minist[ée]rio\s+p[úu]blico|\bpromotor|\bprocurador(?:a)?\s+de\s+justi[çc]a|\bparquet\b/i, 'do Ministério Público'],
  [/\bcontador(?:ia)?\s+judicial|\bcontadoria\b/i, 'da contadoria'],
  [/\bserventia\b|\bcart[óo]rio\b|\bescriv[ãa]o\b|\bchefe\s+de\s+secretaria\b/i, 'da serventia'],
  [/oficial\s+de\s+justi[çc]a/i, 'do oficial de justiça'],
  [/\bleiloeir[oa]\b/i, 'do leiloeiro'],
  [/administrador(?:a)?\s+judicial/i, 'do administrador judicial'],
  [/\bdepositári[oa]\b|\bdepositari[oa]\b/i, 'do depositário'],
  [/\bint[ée]rprete\b|\btradutor(?:a)?\b/i, 'do intérprete'],
  [/\bcurador(?:a)?\s+especial\b/i, 'do curador especial'],
];

/**
 * Partes e seus procuradores — qualquer um deles PODE ser voce.
 *
 * Nao servem para marcar nada; servem para CALAR a marcacao. Se o ator
 * mencionado mais perto do prazo e "as partes", o prazo pode perfeitamente ser
 * seu, e a ressalva de auxiliar mencionado la atras seria falso alarme.
 */
const PARTES = /\bpartes?\b|\baut(?:or|ora)\b|\br[ée]u\b|\br[ée]s\b|\brequerid[oa]s?\b|\brequerente\b|\bexequente\b|\bexecutad[oa]s?\b|\bembargante\b|\bembargad[oa]\b|\bapelante\b|\bapelad[oa]\b|\bagravante\b|\bagravad[oa]\b|\bimpetrante\b|\bpatron[oa]\b|\badvogad[oa]s?\b|\bprocurador(?:es)?\s+d[oae]s?\b|\bintimad[oa]\b|\bintime-se\b/i;

/**
 * De quem PARECE ser este prazo — quando parece ser de outra pessoa.
 *
 * Ataca o limite central do projeto: hoje um ato com prazo unico dirigido ao
 * perito sai com data de vencimento como se fosse seu. O caso real esta na
 * nota de calcularPrazo (despacho de 12/08/2026, quatro prazos, nenhum do
 * advogado) — aquele texto ja e protegido pela regra do prazo unico, mas um
 * despacho que so mande o perito entregar o laudo em trinta dias nao e.
 *
 * REGRA DE OURO, e o motivo desta funcao ser tao timida: ela MARCA DUVIDA,
 * nunca esconde. O retorno nao remove publicacao, nao apaga vencimento e nao
 * muda data nenhuma — vira uma linha a mais na saida. Um prazo classificado
 * como "do perito" e omitido seria exatamente o modo de falhar que o projeto
 * inteiro existe para evitar.
 *
 * Como decide: vence quem esta MAIS PERTO do prazo, nao quem aparece primeiro.
 * Em "o perito devera se manifestar em cinco dias ... apos o que as partes
 * serao intimadas no prazo de quinze dias", o sujeito do prazo de quinze e
 * "as partes" — e se o ator mais proximo for uma parte (ou um advogado), esta
 * funcao se cala, porque a parte pode ser o seu cliente.
 *
 * @param {string} contexto  o texto imediatamente anterior ao prazo
 * @returns {string|null} ex.: "do perito"; null quando nao da para dizer
 */
export function sujeitoDoPrazo(contexto = '') {
  let melhor = null;

  for (const [re, rotulo] of AUXILIARES) {
    const pos = ultimaPosicao(contexto, re);
    if (pos >= 0 && (!melhor || pos > melhor.pos)) melhor = { pos, rotulo };
  }
  if (!melhor) return null;

  // Alguma parte (ou o proprio advogado) e mencionada DEPOIS do auxiliar, mais
  // perto do prazo? Entao o prazo provavelmente e dela, e nao ha o que marcar.
  const posParte = ultimaPosicao(contexto, PARTES);
  if (posParte > melhor.pos) return null;

  return melhor.rotulo;
}

/** Posicao da ULTIMA ocorrencia do padrao no texto; -1 se nao houver. */
function ultimaPosicao(texto, re) {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let ultima = -1;
  for (const m of texto.matchAll(global)) ultima = m.index;
  return ultima;
}

/**
 * Calcula as datas de uma publicacao.
 *
 * SO projeta vencimento quando o texto declara UM prazo. Com mais de um, lista
 * os prazos citados e nao arrisca data — e a regra mais importante deste
 * arquivo, e veio de um caso real (DESPACHO de 12/08/2026, processo
 * 4000000-00.2026.8.26.0000). Aquele texto cita quatro prazos, e NENHUM deles
 * era do advogado na data da publicacao:
 *
 *   "o perito devera se manifestar ... em cinco dias"      -> do perito
 *   "Laudo em trinta dias"                                  -> do perito
 *   "as partes serao intimadas ... no prazo de quinze dias" -> futuro, depois
 *                                                              da entrega do laudo
 *   "prestar esclarecimentos ... em dez dias"               -> do perito
 *
 * Uma versao anterior desta funcao escolhia o MENOR prazo, com o argumento de
 * que antecipar e mais seguro do que atrasar. Nesse texto ela teria estampado
 * "vence 20/08/2026" — data de ninguem. Data falsa nao e conservadora: ela
 * gasta a confianca no aviso, e no dia em que o vencimento for verdadeiro ele
 * vai parecer mais um palpite. Saber de QUEM e o prazo exige ler a frase, nao
 * casar um numero.
 *
 * @param {{dataDisponibilizacao?: string, dataPublicacao?: string, intimacao?: string}} pub
 * @returns {{
 *   publicacao: string, inicio: string, fatal: string|null, quantidade: number|null,
 *   unidade: 'dias'|'horas'|null, tipo: 'uteis'|'corridos'|null,
 *   publicacaoInformada: boolean, citados: {quantidade: number, unidade: string}[],
 * }|null} null quando nem a data de disponibilizacao deu para ler.
 */
export function calcularPrazo(pub) {
  const disp = deBR(pub.dataDisponibilizacao);
  if (!disp) return null;

  // Se a fonte informou a data de publicacao, ela manda: e o dado oficial, e a
  // nossa conta e so o substituto para quando ele nao vem (a API do CNJ nao
  // devolve esse campo).
  // O feriado municipal so vale na comarca do processo (ver config.feriadosPorComarca).
  const comarca = comarcaDoProcesso(pub.numeroProcesso);
  const informada = deBR(pub.dataPublicacao);
  const publicacao = informada ?? diaUtilSeguinte(disp, { comarca });
  const inicio = diaUtilSeguinte(publicacao, { comarca });

  const declarados = prazosDeclarados(pub.intimacao);
  // Distintos: o mesmo prazo repetido no texto ("no prazo de 15 dias" citado
  // duas vezes) continua sendo UM prazo, e nao deve cair na regra da ambiguidade.
  // O tipo entra na chave: "15 dias uteis" e "15 dias corridos" sao prazos
  // DIFERENTES e terminam em datas diferentes — fundir os dois faria a contagem
  // sair pelo tipo de quem apareceu primeiro, sem ninguem notar.
  const distintos = [
    ...new Map(declarados.map((p) => [`${p.quantidade}|${p.unidade}|${p.tipo}`, p])).values(),
  ];
  const unico = distintos.length === 1 ? distintos[0] : null;

  // De quem PARECE ser o prazo. So faz sentido perguntar quando ha um prazo
  // unico — que e justamente o caso em que uma data e estampada como se fosse
  // sua. Se o mesmo prazo aparece mais de uma vez com sujeitos diferentes
  // ("o perito ... em 15 dias" e "as partes ... em 15 dias"), a funcao se cala:
  // marcar o sujeito errado e pior do que nao marcar nenhum.
  const sujeito = unico ? sujeitoUnanime(declarados, unico) : null;

  let fatal = null;
  // Prazo em horas nao ganha data calculada nem quando e unico: a contagem corre
  // em horas a partir da intimacao, nao em dias a partir do inicio.
  if (unico?.unidade === 'dias') {
    fatal =
      unico.tipo === 'corridos'
        ? // Prazo em dias corridos que termine em dia nao util corre para o
          // proximo util (art. 224, §1o).
          diaUtilSeguinte(somarDias(inicio, unico.quantidade - 1), { incluirHoje: true, comarca })
        : somarDiasUteis(inicio, unico.quantidade, comarca);
  }

  return {
    publicacao: paraBR(publicacao),
    publicacaoInformada: Boolean(informada),
    inicio: paraBR(inicio),
    fatal: fatal ? paraBR(fatal) : null,
    quantidade: unico?.quantidade ?? null,
    unidade: unico?.unidade ?? null,
    tipo: unico?.tipo ?? null,
    citados: distintos.map(({ quantidade, unidade }) => ({ quantidade, unidade })),
    sujeito,
    // Do inicio da contagem ate o vencimento: e o trecho em que um feriado
    // local muda a data. Fora dele, ele nao influenciou nada.
    feriadosLocais: fatal ? feriadosLocaisNoIntervalo(inicio, fatal, comarca) : [],
  };
}

/**
 * O sujeito do prazo, se TODAS as ocorrencias dele apontarem para o mesmo.
 * Divergiu, ou alguma ficou sem sujeito reconhecido: devolve null.
 */
function sujeitoUnanime(declarados, unico) {
  const mesmas = declarados.filter(
    (p) => p.quantidade === unico.quantidade && p.unidade === unico.unidade && p.tipo === unico.tipo,
  );
  const sujeitos = mesmas.map((p) => sujeitoDoPrazo(p.contexto));
  const primeiro = sujeitos[0] ?? null;
  return sujeitos.every((s) => s === primeiro) ? primeiro : null;
}

/**
 * Ordena as publicacoes por urgencia: quem tem data de vencimento primeiro, e
 * entre essas, a que vence antes.
 *
 * ORDENA, NAO ESCONDE — nada sai da lista, e a numeracao do PDF, do e-mail e
 * do WhatsApp continua sendo a mesma porque todos recebem este mesmo array (a
 * ordenacao acontece uma vez so, na coleta).
 *
 * Motivo: um ato meramente ordinatorio ("ciencia as partes") ocupa na tela do
 * celular o mesmo espaco de um despacho que vence em tres dias. Quem le de
 * cima para baixo tem que encontrar primeiro o que tem hora marcada.
 *
 * A ordem entre as faixas: vencimento calculado > prazo em horas > prazo
 * ambiguo (mais de um no texto) > sem prazo declarado > data ilegivel. As tres
 * ultimas nao tem data para comparar, e ficam na ordem em que ja estavam
 * (Array.prototype.sort e estavel).
 */
export function ordenarPorUrgencia(publicacoes = []) {
  const faixa = (p) => {
    if (!p) return 4;
    if (p.fatal) return 0;
    if (p.unidade === 'horas') return 1;
    if (p.citados.length > 1) return 2;
    return 3;
  };

  return publicacoes
    .map((pub, i) => ({ pub, i, prazo: calcularPrazo(pub) }))
    .sort((a, b) => {
      const fa = faixa(a.prazo);
      const fb = faixa(b.prazo);
      if (fa !== fb) return fa - fb;
      if (fa === 0) {
        // Comparacao por Date, nao pelo texto: "03/09" e "21/08" em dd/mm/aaaa
        // se ordenam ao contrario como string.
        const da = deBR(a.prazo.fatal);
        const db = deBR(b.prazo.fatal);
        if (da && db && da.getTime() !== db.getTime()) return da - db;
      }
      return a.i - b.i;
    })
    .map(({ pub }) => pub);
}

/** "15 dias úteis", "48 horas" — como se le, com acento. */
function porExtenso({ quantidade, unidade, tipo }) {
  if (unidade === 'horas') return `${quantidade} horas`;
  return `${quantidade} dias ${tipo === 'corridos' ? 'corridos' : 'úteis'}`;
}

/** Uma linha para o zap: "⏳ 15 dias úteis — vence 03/09/2026 (estimativa)". */
export function resumirPrazo(pub) {
  const p = calcularPrazo(pub);
  if (!p) return null;

  // A ressalva de sujeito acompanha QUALQUER linha de prazo, e nunca no lugar
  // da data: ela e uma duvida a mais, nao uma publicacao a menos.
  const dono = p.sujeito ? `
❓ Este prazo parece ser ${p.sujeito}, não seu — confira de quem é.` : '';

  if (p.fatal) {
    const local = p.feriadosLocais.length
      ? ` [considera feriado local: ${p.feriadosLocais.join(', ')}]`
      : '';
    return `⏳ ${porExtenso(p)} — vence ${p.fatal} (estimativa, confira)${local}${dono}`;
  }
  if (p.unidade === 'horas') {
    return `⏳ ${p.quantidade} horas a contar da intimação — contagem começa ${p.inicio} (confira)${dono}`;
  }
  if (p.citados.length > 1) {
    // Sem data: o texto tem mais de um prazo e nenhum deles e assumido como seu.
    const lista = p.citados.map((c) => `${c.quantidade} ${c.unidade}`).join(', ');
    return `⏳ Contagem começa ${p.inicio} — o texto cita ${p.citados.length} prazos (${lista}), confira qual é o seu`;
  }
  return `⏳ Contagem começa ${p.inicio} (o texto não declara prazo)`;
}
