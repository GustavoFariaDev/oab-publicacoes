import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config, brToISO } from './config.js';
import { formatarPartes } from './merge.js';

/** "1637" — hora local, para desempatar nomes de arquivo no mesmo dia. */
function horaHHmm() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(/\D/g, '');
}

/**
 * Monta o PDF a partir dos dados ja extraidos.
 *
 * Nao usamos page.pdf() do Playwright de proposito: ele so funciona em Chromium
 * headless, e a Cloudflare exige que rodemos com janela visivel. Montar aqui
 * tambem da controle sobre o layout — o texto da intimacao fica legivel em vez
 * de espremido no CSS do portal.
 *
 * @returns {Promise<string>} caminho do PDF gerado
 */
export function gerarPDF({ dataBR, publicacoes, avisos = [], complemento = false }) {
  const dir = path.join(config.paths.out, brToISO(dataBR));
  fs.mkdirSync(dir, { recursive: true });

  // Um retry parcial gera um PDF so com as publicacoes novas. Se ele reusasse
  // o mesmo nome, apagaria o PDF do lote original — e out/ existe justamente
  // para auditoria. Complemento ganha sufixo com a hora.
  const sufixo = complemento ? `-complemento-${horaHHmm()}` : '';
  const file = path.join(dir, `publicacoes-${brToISO(dataBR)}${sufixo}.pdf`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);

  // --- Capa ---
  doc.fontSize(20).text('Publicações do Diário da Justiça', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor('#444').text(`OAB ${config.oab.numero}/${config.oab.uf} — ${dataBR}`, { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(12)
    .text(
      complemento
        ? `Complemento: ${publicacoes.length} publicação(ões) que não estavam no envio anterior`
        : `${publicacoes.length} publicação(ões)`,
      { align: 'center' },
    )
    .fillColor('black');
  doc.moveDown(1.5);

  // Divergencia de contagem aparece antes de tudo, nao no rodape.
  for (const aviso of avisos) {
    doc.fontSize(11).fillColor('#b00020').text(`⚠ ${aviso}`, { align: 'left' });
    doc.fillColor('black').moveDown(1);
  }

  publicacoes.forEach((pub, i) => {
    if (i > 0) doc.addPage();

    doc.fontSize(14).fillColor('#0b5394').text(`${i + 1}. ${pub.titulo || 'Publicação'}`);
    doc.fillColor('black').moveDown(0.5);

    // Partes logo abaixo do processo: e por elas que se reconhece o caso ao
    // bater o olho, mais rapido do que pelo numero.
    const linhas = [
      ['Processo', pub.numeroProcesso],
      ...formatarPartes(pub.partes).map((linha) => {
        const corte = linha.indexOf(':');
        return [linha.slice(0, corte), linha.slice(corte + 2)];
      }),
      ['Vara', pub.vara],
      ['Tribunal', pub.tribunal],
      ['Jornal', pub.jornal],
      ['Caderno', pub.caderno],
      ['Disponibilização', pub.dataDisponibilizacao],
      ['Publicação', pub.dataPublicacao],
      ['Página', pub.pagina],
    ];

    doc.fontSize(10);
    for (const [rotulo, valor] of linhas) {
      if (!valor) continue;
      doc.font('Helvetica-Bold').text(`${rotulo}: `, { continued: true });
      doc.font('Helvetica').text(valor);
    }

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(11).text('Intimação');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).text(pub.intimacao || '(sem texto)', { align: 'justify' });
  });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(file));
    stream.on('error', reject);
  });
}
