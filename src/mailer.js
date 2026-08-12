import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { config } from './config.js';
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
            (p) => `<li style="margin-bottom:12px">
              <strong>${escapeHtml(p.titulo || 'Publicação')}</strong><br>
              Processo: ${escapeHtml(p.numeroProcesso)}<br>
              ${escapeHtml(p.vara)}<br>
              <span style="color:#666">${escapeHtml(p.jornal)}</span>
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
