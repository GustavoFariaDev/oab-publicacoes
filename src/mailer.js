import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { calcularPrazo } from './prazo.js';
import { formatarPartes } from './merge.js';
import { log } from './log.js';

function transporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Bloco de prazo de uma publicacao, no corpo do e-mail.
 *
 * O corpo do e-mail listava so titulo, processo, vara e jornal — a data de
 * vencimento existia apenas no WhatsApp e no PDF anexo. Como o e-mail e o canal
 * mais confiavel dos dois (SMTP com autenticacao de verdade, sem biblioteca
 * nao-oficial), quem lesse so ele nao via prazo nenhum sem abrir o anexo.
 *
 * Vermelho so quando ha data. Prazo ambiguo ou ausente fica em cinza: cor de
 * alarme em tudo e o mesmo que cor de alarme em nada.
 */
function linhaPrazo(pub) {
  const p = calcularPrazo(pub);
  if (!p) return '';

  const cinza = (t) => `<br><span style="color:#666;font-size:13px">${t}</span>`;

  if (p.fatal) {
    const tipo = p.tipo === 'corridos' ? 'corridos' : 'úteis';
    return (
      `<br><strong style="color:#b00020">⏳ Vence em ${p.fatal}</strong>` +
      `<span style="color:#666"> — ${p.quantidade} dias ${tipo}, contagem a partir de ${p.inicio}</span>` +
      cinza('Estimativa: não inclui feriado local/forense, suspensão do tribunal nem prazo em dobro.') +
      // Feriado local e a unica parte vinda de configuracao humana, e a unica
      // cujo erro joga o vencimento para FRENTE. Aparece quando influenciou.
      (p.feriadosLocais.length
        ? cinza(
            `⚠ Considera feriado local configurado à mão (${p.feriadosLocais.join(', ')}). ` +
              'Se não for feriado na comarca, o vencimento real é ANTES do exibido.',
          )
        : '')
    );
  }
  if (p.unidade === 'horas') {
    return (
      `<br><strong style="color:#b00020">⏳ Prazo de ${p.quantidade} horas</strong>` +
      cinza('Contado em horas a partir da intimação — sem data calculada. Confira no processo.')
    );
  }
  if (p.citados.length > 1) {
    const lista = p.citados.map((c) => `${c.quantidade} ${c.unidade}`).join(', ');
    return cinza(
      `⏳ Contagem começa ${p.inicio} — o texto cita ${p.citados.length} prazos (${lista}). ` +
        'Sem vencimento calculado: podem ser de partes diferentes. Confira qual é o seu.',
    );
  }
  return cinza(`⏳ Contagem começa ${p.inicio} — o texto não declara prazo.`);
}

/** E-mail do dia: resumo no corpo, inteiro teor no PDF anexo. */
export async function enviarEmail({
  dataBR,
  publicacoes,
  avisos = [],
  pdfPath,
  screenshotPath,
  complemento = false,
}) {
  const total = publicacoes.length;
  const oab = config.oab.numero;
  const subject =
    total === 0
      ? `OAB ${oab} — nenhuma publicação em ${dataBR}`
      : complemento
        ? `OAB ${oab} — complemento: +${total} publicação(ões) em ${dataBR}`
        : `OAB ${oab} — ${total} publicação(ões) em ${dataBR}`;

  const alerta = avisos
    .map(
      (a) =>
        `<p style="background:#fdecea;border-left:4px solid #b00020;padding:10px;margin:0 0 16px">
           <strong>⚠ Atenção:</strong> ${escapeHtml(a)}
         </p>`,
    )
    .join('');

  const lista =
    total === 0
      ? '<p>Nenhuma publicação encontrada para esta data.</p>'
      : `<ol>${publicacoes
          .map(
            (p) => `<li style="margin-bottom:16px">
              <strong>${escapeHtml(p.titulo || 'Publicação')}</strong><br>
              Processo: ${escapeHtml(p.numeroProcesso)}<br>
              ${formatarPartes(p.partes).map((l) => `${escapeHtml(l)}<br>`).join('')}
              ${escapeHtml(p.vara)}<br>
              <span style="color:#666">${escapeHtml(p.jornal)}</span>
              ${linhaPrazo(p)}
            </li>`,
          )
          .join('')}</ol>`;

  const attachments = [];
  if (pdfPath && fs.existsSync(pdfPath)) attachments.push({ path: pdfPath });
  if (screenshotPath && fs.existsSync(screenshotPath)) attachments.push({ path: screenshotPath });

  await transporter().sendMail({
    from: config.smtp.user,
    to: config.mailTo,
    subject,
    html: `${alerta}<h2>Publicações de ${dataBR}</h2>
           ${complemento ? '<p style="color:#666">Complemento de um envio anterior deste mesmo dia — abaixo só o que ainda não tinha sido enviado.</p>' : ''}
           ${lista}
           <p style="color:#888;font-size:12px">Enviado automaticamente. Inteiro teor no PDF anexo.</p>`,
    attachments,
  });

  log.info(`E-mail enviado para ${config.mailTo.join(', ')}.`);
}

/**
 * Aviso de falha. Mandado quando o pipeline quebra — sem isso, uma falha
 * silenciosa seria indistinguivel de um dia sem publicacao.
 */
export async function enviarEmailDeErro(stage, error) {
  try {
    await transporter().sendMail({
      from: config.smtp.user,
      to: config.mailTo,
      subject: `OAB ${config.oab.numero} — FALHA na automação (${stage})`,
      text:
        `A automação falhou na etapa "${stage}".\n\n` +
        `${error?.stack ?? error}\n\n` +
        `Confira o portal manualmente hoje. Detalhes em state.json (campo lastError) e em logs/.`,
    });
    log.info('E-mail de falha enviado.');
  } catch (e) {
    log.error('Nao consegui nem enviar o e-mail de falha:', e.message);
  }
}
