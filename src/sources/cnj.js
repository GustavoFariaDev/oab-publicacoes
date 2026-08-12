import { log } from '../log.js';
import { brToISO, config } from '../config.js';

/**
 * Fonte 1: API publica de Comunicacoes Processuais do CNJ (DJEN).
 *
 * https://comunicaapi.pje.jus.br/api/v1/comunicacao
 *
 * Publica, sem autenticacao e sem Cloudflare — e por isso a fonte confiavel
 * do dia a dia. Porem NAO e completa: cobre o DJEN, e o portal da OAB agrega
 * tambem os diarios de MG e da Uniao. Medido em 01/07-11/08/2026: portal ~179,
 * API 152 (~15% a menos). Por isso ela e unida ao portal, nao usada sozinha.
 */
const BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

/**
 * 50 e o teto real, e passar dele nao da erro: a API devolve lista VAZIA em
 * silencio. Estava em 100 aqui — funcionava so porque nos dias testados o total
 * do dia era menor que uma pagina. Num dia cheio isso seria "nenhuma
 * publicacao hoje" sem nenhum sinal de problema.
 */
const POR_PAGINA = 50;

/**
 * Sufixos com que os tribunais gravam a inscricao da OAB.
 *
 * O mesmo advogado aparece como "123456", "123456-O", "123456-A"..., e a busca
 * e por igualdade exata: consultando so o numero base, publicacao gravada com
 * sufixo fica invisivel. E o achado principal da skill
 * rvsanches/skills-datajud-djen, medida em producao (~90% invisiveis).
 *
 * POR QUE NAO VARREMOS OS 7 EM TODA EXECUCAO. Medido nesta inscricao
 * (dias 11 e 12/08/2026): so a variante base devolve algo, as outras
 * seis vem vazias. E sete consultas em rajada tomam HTTP 429 da API — o limite
 * dela e indocumentado e baixo. Com o CNJ sendo a unica fonte ligada, tomar 429
 * nao custa "menos publicacoes": custa o dia inteiro.
 *
 * Entao a varredura acontece onde ela realmente paga:
 *   - sempre que a base vier VAZIA (o caso em que "nenhuma publicacao hoje"
 *     poderia ser, na verdade, "publicacao gravada com sufixo");
 *   - quando pedida de proposito (--variantes ou VARIANTES_OAB=1), para
 *     reconferir de vez em quando se esta inscricao passou a ter sufixo.
 */
const SUFIXOS_EXTRA = ['-O', '-A', '-N', '-B', '-S', '-E'];

/** Uma pagina vazia no meio da paginacao costuma ser transitoria. */
const MAX_RETRY_PAGINA = 2;
const MAX_PAGINAS = 200;

/**
 * O limite de requisicao da API e indocumentado e baixo: variantes em rajada
 * tomam 429 na hora. Pausa entre variantes e espera crescente custam segundos
 * numa tarefa que roda 1x por dia — perder o dia custa prazo.
 */
const PAUSA_ENTRE_VARIANTES_MS = 1500;
const MAX_RETRY_HTTP = 4;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET com retentativa nos erros que passam: 429 (limite) e 5xx (instabilidade).
 * 403 e 404 nao se resolvem esperando e sobem na hora.
 */
async function buscarComRetry(url, { rotulo }) {
  for (let tentativa = 1; ; tentativa++) {
    const resposta = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    if (resposta.ok) return resposta;

    if (resposta.status === 403) {
      // A API bloqueia IP de fora do Brasil. Vale dizer o motivo: o 403 seco
      // parece problema de credencial numa API que nem pede credencial.
      throw new Error(
        'API do CNJ respondeu HTTP 403. Ela recusa requisicao de IP fora do Brasil — ' +
          'se houver VPN ou proxy ligado, desligue.',
      );
    }

    const vaiPassar = resposta.status === 429 || resposta.status >= 500;
    if (!vaiPassar || tentativa > MAX_RETRY_HTTP) {
      throw new Error(`API do CNJ respondeu HTTP ${resposta.status} (${rotulo}).`);
    }

    // Retry-After, quando vem, e a propria API dizendo quanto esperar.
    const pedido = Number(resposta.headers.get('retry-after'));
    const espera = Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : 3000 * 2 ** (tentativa - 1);
    log.warn(`CNJ: HTTP ${resposta.status} em ${rotulo} — esperando ${espera}ms e tentando de novo.`);
    await dormir(espera);
  }
}

/** Numero do processo so com digitos — chave de comparacao entre as fontes. */
export function normalizarProcesso(numero = '') {
  return String(numero).replace(/\D/g, '');
}

/**
 * Busca as comunicacoes de um dia.
 * @param {string} dataBR  dd/mm/aaaa
 * @param {{numeroOab: string, ufOab: string}} oab
 * @returns {Promise<{publicacoes: import('../merge.js').Publicacao[], completo: boolean}>}
 *   `completo` e false quando a API entregou menos itens do que ela mesma
 *   declarou (corpo.count) — o dia continua em aberto para o retry, do mesmo
 *   jeito que o guard-rail do portal em src/sources/portal.js.
 */
export async function buscarNoCNJ(dataBR, { numeroOab, ufOab }) {
  const dataISO = brToISO(dataBR);
  const base = String(numeroOab).replace(/\D/g, '');

  // Chaveado por id: as variantes de sufixo se sobrepoem (a mesma comunicacao
  // pode voltar em mais de uma), e "quantas vieram" tem que contar comunicacao
  // unica, nao resposta de API.
  const porId = new Map();
  const porVariante = {};
  const guardar = (itens) => {
    for (const item of itens) {
      const id = String(item.id ?? item.hash ?? '');
      // Sem id nao ha como deduplicar; a chave cai para o texto, que ainda e
      // melhor do que descartar a comunicacao.
      const chave = id || `${item.numeroprocessocommascara}|${item.texto?.slice(0, 200)}`;
      if (!porId.has(chave)) porId.set(chave, item);
    }
  };

  // --- Variante base: obrigatoria. Se ela falha, nao ha coleta e o dia cai no
  // retry (o erro sobe). ---
  const raiz = await consultarVariante({ oab: base, ufOab, dataISO });
  let completo = raiz.completo;
  if (raiz.itens.length) porVariante[base] = raiz.itens.length;
  guardar(raiz.itens);

  // --- Variantes com sufixo: so quando pagam o preco (ver a nota em
  // SUFIXOS_EXTRA). Falha de uma delas nao derruba o dia: marca incompleto, o
  // aviso sai e o retry das 16h tenta de novo. ---
  const varrer = config.varrerVariantesOab || raiz.itens.length === 0;
  if (varrer) {
    log.info(
      raiz.itens.length === 0
        ? 'CNJ: base sem publicacao — varrendo as variantes de sufixo da inscricao.'
        : 'CNJ: varredura de variantes pedida.',
    );
    for (const sufixo of SUFIXOS_EXTRA) {
      const oab = `${base}${sufixo}`;
      await dormir(PAUSA_ENTRE_VARIANTES_MS);
      try {
        const r = await consultarVariante({ oab, ufOab, dataISO });
        if (!r.completo) completo = false;
        if (r.itens.length) {
          porVariante[oab] = r.itens.length;
          log.warn(`CNJ: a inscricao TEM publicacao gravada como ${oab} — ligue VARIANTES_OAB=1.`);
        }
        guardar(r.itens);
      } catch (e) {
        log.warn(`CNJ: variante ${oab} falhou (${e.message}) — dia segue incompleto.`);
        completo = false;
      }
    }
  }

  const todas = [...porId.values()];
  log.info(
    `CNJ: ${todas.length} comunicacao(oes) unica(s) em ${dataBR} ` +
      `(por variante: ${JSON.stringify(porVariante)}).`,
  );
  if (!completo) log.warn('CNJ: alguma variante entregou menos do que declarou.');

  return { publicacoes: todas.map(paraPublicacao), completo };
}

/**
 * Pagina uma variante de inscricao ate o fim.
 *
 * @returns {Promise<{itens: object[], completo: boolean}>}
 */
async function consultarVariante({ oab, ufOab, dataISO }) {
  const itens = [];
  let declarado = null;
  let retries = 0;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url =
      `${BASE}?numeroOab=${encodeURIComponent(oab)}&ufOab=${encodeURIComponent(ufOab)}` +
      `&dataDisponibilizacaoInicio=${dataISO}&dataDisponibilizacaoFim=${dataISO}` +
      `&pagina=${pagina}&itensPorPagina=${POR_PAGINA}`;

    const resposta = await buscarComRetry(url, { rotulo: `OAB ${oab}, pagina ${pagina}` });
    const corpo = await resposta.json();
    // O parametro de pagina e "pagina". Atencao: "page" e aceito e IGNORADO
    // silenciosamente — devolve sempre a primeira pagina.
    const pageItens = Array.isArray(corpo.items) ? corpo.items : [];
    if (declarado === null) declarado = corpo.count ?? pageItens.length;

    if (pageItens.length === 0) {
      // Pagina vazia no meio da paginacao e transitoria com frequencia: antes
      // isso encerrava o laco e truncava o dia calado. Agora insiste na MESMA
      // pagina com espera crescente, e so entrega incompleto se persistir.
      if (itens.length >= declarado) break;
      if (retries >= MAX_RETRY_PAGINA) {
        log.warn(`CNJ: OAB ${oab} parou na pagina ${pagina} com ${itens.length}/${declarado}.`);
        return { itens, completo: false };
      }
      retries++;
      await new Promise((r) => setTimeout(r, 1000 * retries));
      pagina--;
      continue;
    }

    retries = 0;
    itens.push(...pageItens);
    if (itens.length >= declarado) break;
  }

  return { itens, completo: itens.length >= (declarado ?? 0) };
}

/**
 * Entidades HTML que aparecem de fato no texto dos tribunais.
 * O que nao estiver aqui passa cru ("&rsquo;") em vez de sumir — feio, mas
 * visivel, que e melhor do que perder um pedaco do texto da intimacao.
 */
const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª',
  sect: '§', deg: '°', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×',
  uuml: 'ü', Uuml: 'Ü', ntilde: 'ñ', Ntilde: 'Ñ', copy: '©', reg: '®', euro: '€',
  aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', eacute: 'é', ecirc: 'ê',
  iacute: 'í', oacute: 'ó', otilde: 'õ', ocirc: 'ô', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Agrave: 'À', Atilde: 'Ã', Acirc: 'Â', Eacute: 'É', Ecirc: 'Ê',
  Iacute: 'Í', Oacute: 'Ó', Otilde: 'Õ', Ocirc: 'Ô', Uacute: 'Ú', Ccedil: 'Ç',
};

/**
 * O campo "texto" vem em HTML, de dezenas de tribunais diferentes: tags, e
 * entidades (`&ccedil;`, `&nbsp;`, `&sect;`). Sem converter, o PDF e o WhatsApp
 * mostram "indica&ccedil;&atilde;o ... <strong>" no lugar do texto da intimacao.
 *
 * Tira TODA tag em vez de permitir uma lista segura: aqui o destino e texto
 * puro (PDF, mensagem de zap), entao nao ha o que preservar — e de graca fica
 * imune ao problema que a skill do DJEN descreve, de HTML de terceiro
 * sobrepondo a interface. script/style saem com conteudo e tudo.
 */
export function htmlParaTexto(html = '') {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Tags de bloco viram quebra de linha: sem isso o texto todo vira um
    // paragrafao unico e ilegivel no PDF.
    .replace(/<br\s*\/?>/gi, '\n')
    // Abertura E fechamento de bloco: o texto do DJEN costuma vir como uma fila
    // de <p>, e converter so o fechamento cola o inicio de um paragrafo no fim
    // do anterior.
    .replace(/<(p|div|li|tr|h[1-6]|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (todo, nome) => ENTIDADES[nome] ?? todo)
    // Espacos e quebras: preserva a separacao de paragrafo, colapsa o resto.
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Converte o item da API para o formato comum das duas fontes. */
function paraPublicacao(item) {
  return {
    fonte: 'CNJ',
    identificador: String(item.id ?? item.hash ?? ''),
    dataDisponibilizacao: item.datadisponibilizacao || '',
    dataPublicacao: '',
    jornal: item.meiocompleto || 'Diário de Justiça Eletrônico Nacional',
    caderno: item.nomeClasse || '',
    tribunal: item.siglaTribunal || '',
    vara: item.nomeOrgao || '',
    titulo: item.tipoDocumento || item.tipoComunicacao || 'Publicação',
    pagina: '',
    numeroProcesso: item.numeroprocessocommascara || item.numero_processo || '',
    intimacao: htmlParaTexto(item.texto),
    link: item.link || '',
    // "polo" vem como A (ativo/autor) ou P (passivo/reu). Nem toda comunicacao
    // traz os dois lados — algumas so listam a parte intimada.
    partes: (item.destinatarios ?? [])
      .map((d) => ({ nome: (d.nome || '').trim(), polo: (d.polo || '').toUpperCase() }))
      .filter((p) => p.nome),
    advogados: (item.destinatarioadvogados ?? [])
      .map((d) => d.advogado?.nome)
      .filter(Boolean),
  };
}
