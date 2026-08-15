import { config } from './config.js';
import { log } from './log.js';
import { isCloudflareChallenge } from './browser.js';

/**
 * Faz o login no portal pelo caminho que o usuario faz a mao:
 *
 *   www.oabsp.org.br  ->  menu sanduiche (as 3 barras, canto superior direito)
 *   ->  INTIMACOES  ->  formulario  ->  Entrar
 *
 * Por que passar pelo menu em vez de abrir o formulario direto: o link de
 * INTIMACOES carrega a `ReturnUrl` que devolve ao Recorte Digital depois de
 * autenticar. Indo direto ao LoginMain.aspx com uma ReturnUrl colada a mao, o
 * gateway ja mandou para a area errada — e o scraper caia em "sessao caiu" com
 * o login recem-feito.
 *
 * A senha vem, nesta ordem: a que o Chrome ja preencheu sozinho (a salva no
 * perfil), e, se o campo vier vazio, OAB_PASS do .env. As duas existem porque
 * dependem de coisas diferentes: o autofill depende do perfil em
 * chrome-profile/, que pode ser recriado; o .env depende de o usuario ter
 * preenchido. O que estiver de pe resolve.
 *
 * Nada aqui tenta resolver o Cloudflare. Se o desafio aparecer no meio do
 * caminho, o login para e avisa — o clique em "Confirme que e humano" e sempre
 * do usuario, na janela que ja esta aberta na frente dele.
 */

const SEL = {
  loggedIn: 'text=/Sair|Logout|Bem.?vindo/i',
  /**
   * O botao do menu nao tem texto — e um icone. Sem rotulo visivel para ancorar,
   * vai por candidatos, do mais especifico ao mais generico, e o teste de
   * sucesso e o proprio efeito: o link de INTIMACOES ficou visivel. Errar o
   * candidato nao quebra nada, so tenta o proximo.
   */
  menu: [
    'header [aria-label*="menu" i]',
    '[aria-label*="menu" i]',
    'button[class*="menu" i]',
    'a[class*="menu" i]',
    '[class*="hamburg" i]',
    'button[class*="toggle" i]',
    '.navbar-toggler',
  ],
  // Casa por texto e sem depender do acento: "INTIMAÇÕES" aparece assim no
  // painel do menu, mas o rotulo ja veio com e sem caixa alta em partes
  // diferentes do site.
  intimacoes: 'a:has-text("INTIMA"), a:has-text("Intima")',
  usuario: 'input[type="text"]:visible, input[type="email"]:visible',
  senha: 'input[type="password"]:visible',
  /**
   * O submit e procurado DENTRO do formulario da senha, e por rotulo antes de
   * por tipo.
   *
   * Um `input[type=submit]` solto na pagina nao serve: a tela de login tem a
   * busca do site, e o botao dela tambem e submit. Em 15/08/2026 foi
   * exatamente ele que o robo tentou clicar por 45s — `aria-label="Search"`,
   * fora da viewport, enquanto o "Entrar" preenchido esperava do lado.
   */
  formSenha: 'form:has(input[type="password"])',
  entrarRotulo: 'input[value="Entrar" i], input[value="Acessar" i], button:has-text("Entrar")',
  entrarTipo: 'input[type="submit"], button[type="submit"]',
  busca: '[aria-label*="search" i], [aria-label*="busca" i]',
};

const ESPERA_CURTA = 5000;

/**
 * Garante uma sessao viva. Nao faz nada se ja estiver logado.
 *
 * @param {import('playwright').Page} page aba do Chrome ja aberto
 * @returns {Promise<boolean>} true se logou agora, false se ja estava logado
 * @throws se o login nao completou — com o que o usuario precisa fazer na janela
 */
export async function garantirSessao(page) {
  if (await estaLogado(page)) return false;

  log.info('Portal: sem sessao — entrando pelo menu do site (INTIMACOES).');
  await entrarPeloMenu(page);
  return true;
}

async function estaLogado(page) {
  return (await page.locator(SEL.loggedIn).count()) > 0;
}

async function entrarPeloMenu(page) {
  await page.goto(config.urls.site, { waitUntil: 'domcontentloaded' });
  await recusarCloudflare(page);

  await abrirMenu(page);

  // LE o endereco do link em vez de clicar nele.
  //
  // Clicar falhou de verdade, em 15/08/2026: o painel do menu e um overlay mais
  // alto que a janela, e "Intimações" fica fora da viewport. O Playwright rola
  // ate ele, confirma "visible, enabled and stable", e mesmo assim recusa —
  // "element is outside of the viewport" — 92 vezes ate estourar os 45s. E o
  // link ainda e target="_blank", entao o clique que desse certo abriria uma
  // aba solta para administrar.
  //
  // O href resolve as duas coisas de uma vez. E ele continua sendo o do MENU,
  // lido da pagina: o caminho e o mesmo que o do clique, so que sem depender de
  // onde o overlay parou na tela.
  const href = await page.locator(SEL.intimacoes).first().getAttribute('href');
  await page.goto(href ?? config.urls.login, { waitUntil: 'domcontentloaded' });

  await recusarCloudflare(page);
  await preencherEEntrar(page);
}

async function abrirMenu(page) {
  const intimacoes = page.locator(SEL.intimacoes).first();
  if (await intimacoes.isVisible().catch(() => false)) return;

  for (const seletor of SEL.menu) {
    for (const botao of await page.locator(seletor).all()) {
      if (!(await botao.isVisible().catch(() => false))) continue;
      await botao.click({ timeout: ESPERA_CURTA }).catch(() => {});
      if (await intimacoes.isVisible({ timeout: 1500 }).catch(() => false)) {
        return;
      }
    }
  }

  throw new Error(
    'Nao consegui abrir o menu do site da OAB para chegar em INTIMACOES. ' +
      'Na janela do Chrome aberta: clique nas 3 barras (canto superior direito), ' +
      'depois em INTIMACOES, entre com a senha e rode de novo.',
  );
}

/**
 * Preenche o que faltar e submete.
 *
 * O `fill` so acontece em campo VAZIO: se o Chrome ja preencheu com a senha
 * salva, sobrescrever com o .env trocaria uma credencial que funciona por uma
 * que pode estar desatualizada.
 */
async function preencherEEntrar(page) {
  const senha = page.locator(SEL.senha).first();
  await senha.waitFor({ state: 'visible', timeout: config.navTimeoutMs }).catch(() => {});

  if (!(await senha.count())) {
    // Sem formulario e sem marca de sessao: o site mudou de caminho.
    if (await estaLogado(page)) return;
    throw new Error(
      'Cheguei em INTIMACOES mas nao achei o campo de senha. ' +
        'Faca o login a mao na janela do Chrome aberta e rode de novo.',
    );
  }

  await preencherSeVazio(page.locator(SEL.usuario).first(), config.oab.user);
  await preencherSeVazio(senha, config.oab.pass);

  await submeter(page);
  await page.waitForLoadState('networkidle').catch(() => {});

  await recusarCloudflare(page);
  if (!(await estaLogado(page))) {
    throw new Error(
      'Enviei o login mas a pagina nao voltou autenticada. ' +
        'Confira OAB_USER/OAB_PASS no .env, ou entre a mao na janela do Chrome aberta.',
    );
  }
  log.info('Portal: login concluido.');
}

/**
 * Aperta o "Entrar".
 *
 * O clique e disparado no DOM (`el.click()`) em vez do clique real do
 * Playwright. Nao e atalho: o layout deste site poe elementos legitimos fora da
 * viewport — foi assim com "Intimações" no menu e com o submit da busca —, e o
 * clique real recusa por posicao mesmo com o elemento visivel e habilitado. O
 * DOM nao tem essa objecao, e aqui nao ha nada a simular: o portal so precisa
 * do postback do botao.
 */
async function submeter(page) {
  const form = page.locator(SEL.formSenha).first();
  const escopo = (await form.count()) ? form : page;

  for (const seletor of [SEL.entrarRotulo, SEL.entrarTipo]) {
    for (const botao of await escopo.locator(seletor).all()) {
      // A busca do site tambem e submit deste mesmo form (ASP.NET envolve a
      // pagina inteira num <form> so).
      if (await botao.locator(SEL.busca).count()) continue;
      const rotuloProprio = (await botao.getAttribute('aria-label')) ?? '';
      if (/search|busca|pesquis/i.test(rotuloProprio)) continue;
      if (!(await botao.isVisible().catch(() => false))) continue;

      await botao.evaluate((el) => el.click());
      return;
    }
  }

  throw new Error(
    'Preenchi o login mas nao achei o botao "Entrar". ' +
      'Entre a mao na janela do Chrome aberta e rode de novo.',
  );
}

async function preencherSeVazio(campo, valor) {
  if (!(await campo.count())) return;
  const atual = await campo.inputValue().catch(() => '');
  if (atual.trim()) return; // o Chrome ja preencheu com a credencial salva
  await campo.fill(valor);
}

async function recusarCloudflare(page) {
  if (await isCloudflareChallenge(page)) {
    throw new Error(
      'O portal esta mostrando o desafio da Cloudflare. ' +
        'Clique em "Confirme que e humano" na janela do Chrome e rode de novo.',
    );
  }
}
