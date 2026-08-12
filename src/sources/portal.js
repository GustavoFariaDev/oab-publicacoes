import path from 'node:path';
import fs from 'node:fs';
import { config, brToISO } from '../config.js';
import { log } from '../log.js';
import { conectarChromeAberto, isCloudflareChallenge } from '../browser.js';

/**
 * Fonte 2: portal da OAB SP (Historico > Publicacoes por Data).
 *
 * Fonte MAIS COMPLETA que a API do CNJ: agrega tambem os diarios de MG e da
 * Uniao. Medido em 01/07-11/08/2026: portal ~179 publicacoes contra 152 da API.
 *
 * Por que ele se conecta a um Chrome ja aberto em vez de abrir o proprio:
 * o portal usa Cloudflare Turnstile, e um Chrome lancado pelo Playwright e
 * reprovado no desafio mesmo com um humano clicando na caixa — as marcas de
 * automacao do lancador entregam o navegador. Conectando por CDP a uma janela
 * de Chrome normal (aberta por scripts/abrir-chrome.js), quem navega e o
 * proprio navegador do usuario; o Playwright so le a pagina resultante.
 *
 * O clique no "Confirme que e humano" e sempre do usuario. Nada aqui tenta
 * resolver o desafio.
 */

/**
 * TODO(fase-1): SELETORES A CONFIRMAR COM O PORTAL ABERTO.
 * Preencher com scripts/explorar.js rodando contra a sessao ja autenticada.
 * Prefira sempre texto visivel (getByRole/getByText) a ID do ASP.NET.
 */
const SEL = {
  loggedIn: 'text=/Sair|Logout|Bem.?vindo/i',
  dateFrom: 'TODO(fase-1)',
  dateTo: 'TODO(fase-1)',
  consultar: 'TODO(fase-1)',
  visualizarTudo: 'TODO(fase-1)',
  resumoCard: 'TODO(fase-1)',
  publicacaoCard: 'TODO(fase-1)',
  proximaPagina: 'TODO(fase-1)',
};

const CAMPOS = {
  dataDisponibilizacao: 'Data de disponibilização',
  dataPublicacao: 'Data de publicação',
  jornal: 'Jornal',
  tribunal: 'Tribunal',
  caderno: 'Caderno',
  vara: 'Vara',
  titulo: 'Título',
  numeroProcesso: 'Número do processo',
  pagina: 'Página',
};

/**
 * @param {string} dataBR dd/mm/aaaa
 * @returns {Promise<{publicacoes: import('../merge.js').Publicacao[], avisos: string[], completo: boolean}>}
 *   `completo` e false quando a extracao trouxe menos do que o proprio portal
 *   declarou ter — o dia continua "em aberto" e os retries voltam a tentar.
 */
export async function buscarNoPortal(dataBR) {
  const { browser, page } = await conectarChromeAberto();

  try {
    if (await isCloudflareChallenge(page)) {
      throw new Error(
        'O portal está mostrando o desafio da Cloudflare. ' +
          'Clique em "Confirme que é humano" na janela do Chrome e rode de novo.',
      );
    }
    if (!(await page.locator(SEL.loggedIn).count())) {
      throw new Error('Sessão do portal caiu. Faça o login na janela do Chrome aberta.');
    }

    await irParaPublicacoesPorData(page);
    await filtrarPorDia(page, dataBR);

    const esperado = await somarCardsDoDia(page, dataBR);
    log.info(`Portal: resumo do dia indica ${esperado} publicacao(oes).`);
    if (esperado === 0) return { publicacoes: [], avisos: [], completo: true };

    await page.locator(SEL.visualizarTudo).first().click();
    await page.waitForLoadState('networkidle');

    const publicacoes = await extrairPublicacoes(page);
    await salvarScreenshot(page, dataBR);

    // Este e o unico guard-rail de contagem que ainda e independente: o resumo
    // do dia e contado pelo proprio portal, antes de qualquer coisa nossa. Se a
    // extracao trouxe menos, faltou publicacao — e isso precisa chegar ao
    // advogado (aviso) e aos retries (completo: false), nao morrer num log.
    const avisos = [];
    const completo = publicacoes.length >= esperado;
    if (!completo) {
      const faltam = esperado - publicacoes.length;
      const aviso =
        `DIVERGÊNCIA NO PORTAL: o resumo do dia soma ${esperado} publicação(ões), ` +
        `mas só ${publicacoes.length} foram extraídas — ${faltam} pode(m) estar faltando. ` +
        `Confira no portal da OAB antes de contar prazo.`;
      log.warn(aviso);
      avisos.push(aviso);
    } else if (publicacoes.length > esperado) {
      log.info(`Portal: resumo dizia ${esperado}, extraidas ${publicacoes.length}.`);
    }
    return { publicacoes, avisos, completo };
  } finally {
    // Só desconecta: a janela é do usuário e continua aberta para a próxima vez.
    await browser.close().catch(() => {});
  }
}

/** TODO(fase-1): mapear o caminho de menu ate a tela de publicacoes. */
async function irParaPublicacoesPorData(page) {
  throw new Error('TODO(fase-1): navegacao ate "Historico > Publicacoes por Data".');
}

async function filtrarPorDia(page, dataBR) {
  await page.locator(SEL.dateFrom).fill(dataBR);
  await page.locator(SEL.dateTo).fill(dataBR);
  await page.locator(SEL.consultar).first().click();
  await page.waitForLoadState('networkidle');
}

/**
 * Soma os contadores de TODOS os cards do dia.
 * O mesmo dia costuma ter mais de um card (07/08/2026 tem "DJ MG (2)" e
 * "DJ SP (5)"): somar so o primeiro perde as de outro estado.
 */
async function somarCardsDoDia(page, dataBR) {
  let total = 0;
  for (const card of await page.locator(SEL.resumoCard).all()) {
    const texto = (await card.innerText()).replace(/\s+/g, ' ').trim();
    if (!texto.includes(dataBR)) continue;
    for (const m of texto.matchAll(/\((\d+)\)/g)) total += Number(m[1]);
    log.info(`  card do dia: ${texto}`);
  }
  return total;
}

/**
 * O portal pagina de 10 em 10 ("Exibindo resultados de 1 a 10").
 *
 * Enquanto SEL.proximaPagina estiver TODO, o laco para na primeira pagina. Isso
 * nao passa despercebido: buscarNoPortal compara o resultado com o resumo do
 * dia e a diferenca vira aviso em destaque + dia incompleto.
 */
async function extrairPublicacoes(page) {
  const publicacoes = [];
  const declarado = await lerTotalDeclarado(page);
  const vistas = new Set();

  for (;;) {
    for (const card of await page.locator(SEL.publicacaoCard).all()) {
      publicacoes.push(await extrairCard(card));
    }
    if (declarado !== null && publicacoes.length >= declarado) break;

    const proxima = page.locator(SEL.proximaPagina).first();
    const temProxima = SEL.proximaPagina !== 'TODO(fase-1)' && (await proxima.count()) > 0;
    if (!temProxima || (await proxima.isDisabled().catch(() => false))) break;

    const marca = await page.locator(SEL.publicacaoCard).first().innerText();
    if (vistas.has(marca)) break;
    vistas.add(marca);

    await proxima.click();
    await page.waitForLoadState('networkidle');
  }
  return publicacoes;
}

async function lerTotalDeclarado(page) {
  const texto = await page.locator('body').innerText();
  const m = texto.match(/pesquisa\s+retornou\s+(\d+)\s+publica/i);
  return m ? Number(m[1]) : null;
}

async function extrairCard(card) {
  const texto = await card.innerText();
  const campo = (rotulo) => texto.match(new RegExp(`${rotulo}\\s*:\\s*(.+)`, 'i'))?.[1]?.trim() ?? '';

  const pub = { fonte: 'Portal' };
  for (const [chave, rotulo] of Object.entries(CAMPOS)) pub[chave] = campo(rotulo);

  pub.intimacao = texto.split(/Intima[cç][aã]o/i).slice(1).join('\n').replace(/\s+/g, ' ').trim();
  pub.identificador = pub.intimacao.match(/Identificador do documento:\s*(\d+)/i)?.[1] ?? '';
  return pub;
}

async function salvarScreenshot(page, dataBR) {
  const dir = path.join(config.paths.out, brToISO(dataBR));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'portal.png');
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
