/**
 * Aquecimento da sessao do portal — para o run das 14h nao encostar na Cloudflare.
 *
 * O PROBLEMA QUE ELE RESOLVE. O desafio da Cloudflare nao mora no portal: mora
 * no LOGIN. `recortedigital.oabsp.org.br` responde direto; quem cobra Turnstile
 * e `www`/`www2`, por onde o robo so passa quando precisa relogar. E ele
 * precisa relogar toda tarde por um motivo bobo: a sessao envelhece. Medido em
 * 18/08/2026 — ela sobrevive a fechar e reabrir o Chrome, mas ~19h depois ja
 * morreu, e as 14h do dia seguinte ela tem exatamente essa idade.
 *
 * Dai o padrao que os logs de 18, 19 e 20/08 mostram sem excecao: as 14h o
 * portal cai no desafio, as 16h entra limpo em 7 segundos.
 *
 * O QUE ISTO FAZ. Toca o portal de manha e, se a sessao tiver morrido, reloga
 * ali — cedo, quando ainda ha o dia inteiro para resolver, e nao as 14h, em
 * cima da hora do envio. Se o cookie for de expiracao deslizante (o padrao do
 * ASP.NET, e compativel com o que ja foi medido), o toque sozinho ja empurra o
 * relogio e nem login havera.
 *
 * O QUE ISTO NAO E. Nao e um jeito de burlar a Cloudflare — nada aqui resolve,
 * forja ou contorna desafio nenhum. E o contrario: e passar pelo login no
 * horario em que uma pessoa pode clicar, se clique for preciso. Quando o
 * desafio for do tipo que EXIGE clique, avisa pelos canais ligados; quando for
 * do tipo que passa sozinho, fica quieto e deixa passar.
 *
 *   node scripts/aquecer-sessao.js
 */
import { conectarChromeAberto, desafioPedeClique, isCloudflareChallenge } from '../src/browser.js';
import { garantirSessao } from '../src/login.js';
import { config } from '../src/config.js';
import { log } from '../src/log.js';
import { enviarEmailDeErro } from '../src/mailer.js';
import { enviarWhatsAppDeErro } from '../src/whatsapp.js';

if (!config.portalHabilitado) {
  log.info('Aquecimento: portal desligado (PORTAL != 1) — nada a fazer.');
  process.exit(0);
}

const { browser, context } = await conectarChromeAberto();

// Aba PROPRIA, e nao a que conectarChromeAberto devolve.
//
// Dois motivos. O primeiro e educacao: a aba do portal pode estar na frente do
// usuario, e navegar por baixo dele e feio. O segundo e corrida — se qualquer
// outra coisa estiver usando aquela aba (uma coleta manual, por exemplo), as
// duas navegacoes se atropelam e o goto morre com ERR_ABORTED. Medido em
// 21/08/2026, exatamente assim.
const page = await context.newPage();
page.setDefaultTimeout(config.navTimeoutMs);
page.setDefaultNavigationTimeout(config.navTimeoutMs);

try {
  // O toque e no portal, nao no site institucional: e a pagina que renova a
  // sessao, e a unica que nao tem Cloudflare na frente.
  await page.goto(config.urls.publicacoes, { waitUntil: 'domcontentloaded' });

  const logouAgora = await garantirSessao(page);
  log.info(
    logouAgora
      ? 'Aquecimento: a sessao tinha caido e foi refeita agora — as 14h o portal entra direto.'
      : 'Aquecimento: a sessao ja estava viva; o toque renova o relogio dela.',
  );
} catch (e) {
  log.error('Aquecimento falhou:', e.message);

  const naCloudflare = await isCloudflareChallenge(page).catch(() => false);
  const pedeClique = naCloudflare && (await desafioPedeClique(page).catch(() => false));

  if (pedeClique) {
    // O UNICO caso em que ha o que alguem fazer — e a hora certa de dizer.
    // Avisar aqui vale justamente porque chega de manha: as 14h o mesmo aviso
    // so serviria para contar que ja deu errado.
    await notificar(
      new Error(
        'O desafio da Cloudflare apareceu no login do portal e e do tipo que espera uma PESSOA. ' +
          'Clique em "Confirme que e humano" na janela do Chrome que esta aberta. ' +
          'Feito isso antes das 14h, a coleta de hoje entra no portal normalmente; ' +
          'senao, os diarios de MG e da Uniao so chegam no retry das 16h.',
      ),
    );
  } else if (naCloudflare) {
    // Passa sozinho, so demorou mais que a espera. Nao ha o que pedir a
    // ninguem, e mandar mensagem aqui seria ruido diario — e ruido diario e o
    // jeito mais rapido de ensinar alguem a ignorar o aviso que importa.
    log.warn('Aquecimento: desafio nao-interativo nao passou a tempo — ninguem precisa clicar, so demorou.');
  } else {
    log.warn('Aquecimento: falhou por outro motivo — a coleta das 14h tentara por conta propria.');
  }
} finally {
  // A aba criada aqui sai; a sessao aquecida nao mora nela, e sim no perfil do
  // Chrome (chrome-profile/), que continua de pe.
  await page.close().catch(() => {});
  // Só desconecta: a janela é do usuário e continua aberta para a próxima vez.
  await browser.close().catch(() => {});
}

/**
 * Avisa por todo canal ligado, cada um em try proprio (mesmo padrao de
 * notificarFalha em src/index.js): o canal caido nao pode levar junto o aviso
 * que ainda tinha como sair pelo outro.
 */
async function notificar(erro) {
  for (const [canal, enviar] of [
    ['email', enviarEmailDeErro],
    ['whatsapp', enviarWhatsAppDeErro],
  ]) {
    if (!config.canais.has(canal)) continue;
    try {
      await enviar('aquecimento-da-sessao', erro);
    } catch (e) {
      log.error(`Aquecimento: nao consegui avisar por ${canal}:`, e.message);
    }
  }
}
