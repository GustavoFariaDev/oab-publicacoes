/**
 * Segunda via: reenvia um dia JA ENVIADO, a pedido.
 *
 *   node scripts/segunda-via.js            -> hoje
 *   node scripts/segunda-via.js 18/08/2026 -> aquele dia
 *
 * Nao escreve em state.json de proposito. O dia ja esta gravado; reenvio a
 * pedido nao e fato novo do pipeline, e mexer no estado para "forcar" um envio
 * corromperia justamente o registro que decide o que ainda falta entregar.
 *
 * Tambem nao usa `complemento: true`. Complemento quer dizer "o que nao estava
 * no envio anterior", e aqui e o oposto: vai o dia INTEIRO, e tudo ja foi
 * entregue uma vez. A distincao sai escrita no topo do PDF e da mensagem,
 * porque quem recebe precisa saber de cara que nao ha prazo novo aqui.
 */
import fs from 'node:fs';
import { coletar } from '../src/coletar.js';
import { gerarPDF } from '../src/pdf.js';
import { enviarWhatsApp } from '../src/whatsapp.js';
import { log } from '../src/log.js';

const hojeBR = () =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const dataBR = process.argv[2] || hojeBR();

if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dataBR)) {
  console.error(`Data invalida: ${dataBR}. Use dd/mm/aaaa.`);
  process.exit(1);
}

const coleta = await coletar(dataBR);
if (!coleta.publicacoes.length) {
  log.warn(`Segunda via de ${dataBR}: nao ha publicacao nenhuma para reenviar.`);
  process.exit(0);
}

const avisos = [
  `SEGUNDA VIA de ${dataBR} — reenvio a pedido. Estas ${coleta.publicacoes.length} ` +
    `publicação(ões) JÁ FORAM enviadas; não há nada novo nem prazo novo aqui.`,
  ...coleta.avisos,
];

// O PDF do dia fica onde esta. Ele e o registro do que saiu na hora certa, e a
// segunda via nao pode apaga-lo — gerarPDF sem sufixo escreveria por cima.
const original = `out/${dataBR.split('/').reverse().join('-')}/publicacoes-${dataBR.split('/').reverse().join('-')}.pdf`;
const guardado = fs.existsSync(original) ? fs.readFileSync(original) : null;

const gerado = await gerarPDF({ dataBR, publicacoes: coleta.publicacoes, avisos });
const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
const pdfPath = gerado.replace(/\.pdf$/, `-segunda-via-${hhmm}.pdf`);
fs.renameSync(gerado, pdfPath);
if (guardado) fs.writeFileSync(original, guardado);

await enviarWhatsApp({ dataBR, publicacoes: coleta.publicacoes, avisos, pdfPath });
log.info(`Segunda via de ${dataBR} enviada por WhatsApp. PDF: ${pdfPath}`);
