import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node 21+ tem loadEnvFile embutido — sem dependencia de dotenv.
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} no .env. Copie .env.example para .env e preencha (veja PLANO.md).`,
    );
  }
  return value;
}

export const config = {
  oab: {
    get user() {
      return required('OAB_USER');
    },
    get pass() {
      return required('OAB_PASS');
    },
    // Usados na consulta a API do CNJ (que e por inscricao, nao por login).
    get numero() {
      return process.env.OAB_NUMERO || required('OAB_USER');
    },
    get uf() {
      return process.env.OAB_UF || 'SP';
    },
  },
  smtp: {
    get user() {
      return required('SMTP_USER');
    },
    get pass() {
      return required('SMTP_PASS');
    },
  },
  get mailTo() {
    return required('MAIL_TO')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get whatsappTo() {
    return required('WHATSAPP_TO').replace(/\D/g, '');
  },
  // Canais de envio ligados, em ordem de tentativa. O e-mail depende de uma
  // Senha de app do Google; enquanto ela nao existe, "whatsapp" sozinho mantem
  // a automacao de pe. Voltar a ter os dois e so por "whatsapp,email" no .env —
  // nenhuma linha de codigo muda.
  get canais() {
    const raw = process.env.CANAIS || 'whatsapp,email';
    const lista = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const invalido = lista.find((c) => c !== 'email' && c !== 'whatsapp');
    if (invalido || lista.length === 0) {
      throw new Error(
        `CANAIS invalido: "${raw}". Use "whatsapp", "email" ou "whatsapp,email".`,
      );
    }
    return new Set(lista);
  },

  /**
   * Quantos dias uteis para tras a revisao reconfere na API do CNJ antes de
   * cuidar do dia corrente (ver src/revisao.js). 0 desliga.
   *
   * O padrao e 1 — o dia util anterior — porque e ele que pode ter recebido
   * publicacao depois do ultimo retry das 17h. Numeros maiores custam uma
   * consulta a mais por dia cada um (e mais risco de 429), e so pagam se a
   * maquina tiver ficado dias desligada; nesse caso vale subir por uns dias e
   * voltar ao padrao.
   */
  get revisaoDias() {
    const raw = process.env.REVISAO_DIAS;
    if (raw === undefined || raw.trim() === '') return 1;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      throw new Error(`REVISAO_DIAS invalido: "${raw}". Use um inteiro de 0 a 10.`);
    }
    return n;
  },

  // Varre as variantes de sufixo da inscricao (123456-O, -A, ...) em TODA
  // execucao. Custa 6 consultas extras e o risco de HTTP 429 na API do CNJ, e
  // nesta inscricao nenhuma delas devolveu nada — por isso o padrao e desligado
  // e a varredura acontece so quando a base vem vazia (ver src/sources/cnj.js).
  // Ligue por uns dias se suspeitar que ha publicacao gravada com sufixo.
  varrerVariantesOab: process.env.VARIANTES_OAB === '1' || process.argv.includes('--variantes'),

  // Feriados que a conta de prazo nao tem como saber sozinha: estaduais,
  // municipais e forenses (Dia da Justica, aniversario da comarca, portaria de
  // suspensao). dd/mm/aaaa separados por virgula. Sem isso, um prazo estimado
  // pode cair um dia adiantado — e o aviso de "estimativa" existe por isso.
  get feriadosExtra() {
    return (process.env.FERIADOS_EXTRA || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  /**
   * Feriados que valem em UMA comarca so — aniversario da cidade, padroeira.
   *
   * Formato: "0100:20/08/2026,15/09/2026;0200:08/04/2026", onde o codigo sao os
   * 4 ultimos digitos do numero CNJ do processo (a unidade de origem).
   *
   * Separado do FERIADOS_EXTRA por necessidade, nao por organizacao: o
   * aniversario de uma cidade nao e feriado na comarca vizinha, e aplicar a
   * data em todo mundo empurraria o vencimento dos processos das outras para
   * frente — exatamente a direcao que faz perder prazo.
   *
   * @returns {Map<string, string[]>} codigo da comarca -> datas dd/mm/aaaa
   */
  get feriadosPorComarca() {
    const mapa = new Map();
    for (const bloco of (process.env.FERIADOS_COMARCA || '').split(';')) {
      const [codigo, datas] = bloco.split(':');
      if (!codigo?.trim() || !datas) continue;
      mapa.set(
        codigo.trim(),
        datas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
    return mapa;
  },

  timezone: process.env.TZ_APP || 'America/Sao_Paulo',
  // Nao existe modo headless: o portal so e acessado pela janela de Chrome que
  // o usuario abre e autentica (ver src/browser.js).
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 45000),

  /**
   * Quanto esperar o Turnstile nao-interativo passar sozinho antes de dizer
   * que o desafio travou.
   *
   * Era 15s, e 15s era pouco: de 18 a 20/08/2026 TODA execucao das 14h morreu
   * em exatamente 15s com "desafio da Cloudflare", e o run das 16h — mesmo
   * navegador, mesma sessao — entrava sem desafio nenhum. Medido a mao em
   * 21/08 com o navegador ja aquecido, o mesmo desafio saiu em 3,4s.
   *
   * O custo de esperar mais e limitado ao caso que HOJE ja fracassa: quem
   * passa, passa em segundos e volta na hora. Quem nao passa perde meio minuto
   * a mais numa coleta que ia perder o portal de qualquer jeito.
   */
  cloudflareEsperaMs: Number(process.env.CLOUDFLARE_ESPERA_MS || 45000),

  // O portal so entra na coleta quando explicitamente ligado: ele depende de
  // uma sessao viva no Chrome real (Cloudflare Turnstile), e ficar tentando
  // sem sessao so gera ruido. A API do CNJ funciona sempre.
  portalHabilitado: process.env.PORTAL === '1',
  cdpEndpoint: process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222',

  urls: {
    // Site institucional. E por aqui que o login comeca: menu sanduiche >
    // INTIMACOES (ver src/login.js). O endereco abaixo (`login`) e o que esse
    // link do menu carrega hoje — conferido em 15/08/2026 —, mas quem manda e
    // o href lido da pagina; este aqui e a rede de seguranca se o menu mudar.
    site: 'https://www.oabsp.org.br/',
    login:
      'https://www2.oabsp.org.br/asp/dotnet/LoginSite/LoginMain.aspx?ReturnUrl=%2fasp%2fdotnet%2fLoginSite%2fAcessoRestrito%2fgateway.aspx%3fop%3d1&op=1',
    // "Historico > Publicacoes por Data". Endereco proprio e estavel: o robo
    // vai direto, em vez de percorrer o menu e depender de mais seletores.
    publicacoes: 'https://recortedigital.oabsp.org.br/Historico/historicodata.aspx',
  },

  paths: {
    root: ROOT,
    chromeProfile: path.join(ROOT, 'chrome-profile'),
    out: path.join(ROOT, 'out'),
    // LOG_DIR existe pelo mesmo motivo do STATE_PATH: sem ele, `npm run teste`
    // despejava as linhas das suites dentro do log do dia (172 delas, medidas
    // em 12/08). O log e o registro forense de quando a tarefa das 14h quebra —
    // misturar ruido de teste ali estraga justamente o que se vai ler no pior
    // momento.
    logs: process.env.LOG_DIR || path.join(ROOT, 'logs'),
    // STATE_PATH existe para o teste: as regras de estado decidem se um dia e
    // reenviado ou esquecido, e ate agora so davam para exercitar escrevendo no
    // state.json de producao (com backup a mao). Em producao fica no padrao.
    state: process.env.STATE_PATH || path.join(ROOT, 'state.json'),
  },
};

/** Data de "hoje" no fuso configurado, como { dd, mm, yyyy }. */
export function today(tz = config.timezone) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { dd: get('day'), mm: get('month'), yyyy: get('year') };
}

/** "11/08/2026" — formato que o portal usa nos campos de data. */
export function todayBR(tz) {
  const { dd, mm, yyyy } = today(tz);
  return `${dd}/${mm}/${yyyy}`;
}

/** "2026-08-11" — formato usado para nomear pastas em out/. */
export function todayISO(tz) {
  const { dd, mm, yyyy } = today(tz);
  return `${yyyy}-${mm}-${dd}`;
}

/** Converte "11/08/2026" em "2026-08-11". */
export function brToISO(br) {
  const [dd, mm, yyyy] = br.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Le a data alvo dos argumentos de linha de comando.
 * Uso: npm run once -- --data=07/08/2026
 * Sem o argumento, devolve hoje.
 */
export function targetDateBR(argv = process.argv) {
  const arg = argv.find((a) => a.startsWith('--data='));
  if (!arg) return todayBR();
  const value = arg.slice('--data='.length).trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    throw new Error(`--data invalida: "${value}". Use o formato dd/mm/aaaa.`);
  }
  return value;
}

/** true quando rodando com --dry (gera arquivos, nao envia nada). */
export function isDryRun(argv = process.argv) {
  return argv.includes('--dry');
}
