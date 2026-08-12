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

  timezone: process.env.TZ_APP || 'America/Sao_Paulo',
  // Nao existe modo headless: o portal so e acessado pela janela de Chrome que
  // o usuario abre e autentica (ver src/browser.js).
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 45000),

  // O portal so entra na coleta quando explicitamente ligado: ele depende de
  // uma sessao viva no Chrome real (Cloudflare Turnstile), e ficar tentando
  // sem sessao so gera ruido. A API do CNJ funciona sempre.
  portalHabilitado: process.env.PORTAL === '1',
  cdpEndpoint: process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222',

  urls: {
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
    logs: path.join(ROOT, 'logs'),
    state: path.join(ROOT, 'state.json'),
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
