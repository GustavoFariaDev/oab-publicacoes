import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { config, brToISO } from './config.js';
import { formatarPartes } from './merge.js';
import { calcularPrazo } from './prazo.js';

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
 * Bloco de datas da publicacao: disponibilizacao -> publicacao -> inicio ->
 * vencimento. Vem depois dos campos comuns e antes do texto da intimacao, que e
 * a ordem em que se le a publicacao para decidir o que fazer com ela.
 *
 * Sai em bloco proprio (e nao como mais duas linhas na lista) porque uma data
 * calculada por nos nao pode ter a mesma aparencia de um campo que veio da
 * fonte: as calculadas dizem de onde vieram, e o vencimento leva a ressalva.
 *
 * Exportada para teste: e o bloco onde um erro vira prazo perdido, e conferir
 * o texto dele por dentro de um PDF ja gerado e caro demais para se fazer
 * sempre. O teste passa um "doc" de mentira que so anota o que foi escrito.
 */
export function escreverPrazo(doc, pub) {
  const p = calcularPrazo(pub);

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(10).text('Prazo');
  doc.fontSize(9);

  const linha = (rotulo, valor, nota) => {
    if (!valor) return;
    doc.font('Helvetica-Bold').text(`  ${rotulo}: `, { continued: true });
    doc.font('Helvetica').text(valor, { continued: Boolean(nota) });
    if (nota) doc.fillColor('#666').text(`  ${nota}`).fillColor('black');
  };

  // Data ilegivel nao pode APAGAR a data: as duas datas da fonte saem cruas e o
  // resto do bloco nao existe. Quando estes campos moraram na lista de cima,
  // este caminho era so nao imprimir o bloco; agora seria perder o dado.
  if (!p) {
    linha('Disponibilização', pub.dataDisponibilizacao);
    linha('Publicação', pub.dataPublicacao);
    doc.font('Helvetica').fillColor('#666').fontSize(8);
    doc.text('  Sem contagem: a data de disponibilização não foi reconhecida.');
    doc.fillColor('black').fontSize(9);
    return;
  }

  linha('Disponibilização', pub.dataDisponibilizacao);
  linha(
    'Publicação',
    p.publicacao,
    p.publicacaoInformada ? '(informada pela fonte)' : '(1º dia útil seguinte — art. 224, §2º)',
  );
  linha('Contagem começa', p.inicio, '(1º dia útil após a publicação)');

  const ressalva = (texto) => {
    doc.font('Helvetica').fillColor('#666').fontSize(8).text(`  ${texto}`);
    doc.fillColor('black').fontSize(9);
  };

  if (p.fatal) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fillColor('#b00020');
    doc.text(`  Vence em ${p.fatal} — ${p.quantidade} dias ${p.tipo === 'corridos' ? 'corridos' : 'úteis'}`);
    ressalva(
      'Estimativa. Não inclui feriado estadual/municipal/forense, suspensão do tribunal' +
        ' nem prazo em dobro. Confira no processo.',
    );
  } else if (p.unidade === 'horas') {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fillColor('#b00020');
    doc.text(`  Prazo de ${p.quantidade} horas`);
    ressalva('Contado em horas a partir da intimação — sem data calculada aqui. Confira no processo.');
  } else if (p.citados.length > 1) {
    // Nao calcula vencimento aqui de proposito: com mais de um prazo no texto,
    // qualquer escolha nossa seria chute (ver a nota em calcularPrazo).
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fillColor('#8a6d00');
    doc.text(`  O texto cita ${p.citados.length} prazos: ${p.citados.map((c) => `${c.quantidade} ${c.unidade}`).join(', ')}`);
    ressalva(
      'Sem vencimento calculado: mais de um prazo no mesmo ato, e podem ser de partes' +
        ' diferentes (perito, Ministério Público) ou depender de evento futuro. Confira no processo.',
    );
  } else {
    ressalva('O texto da intimação não declara prazo — verifique o ato.');
  }
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
      ['Página', pub.pagina],
    ];

    doc.fontSize(10);
    for (const [rotulo, valor] of linhas) {
      if (!valor) continue;
      doc.font('Helvetica-Bold').text(`${rotulo}: `, { continued: true });
      doc.font('Helvetica').text(valor);
    }

    escreverPrazo(doc, pub);

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
