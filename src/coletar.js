import { config } from './config.js';
import { log } from './log.js';
import { unir } from './merge.js';
import { deBR, ehDiaUtil } from './prazo.js';
import { buscarNoCNJ } from './sources/cnj.js';
import { buscarNoPortal } from './sources/portal.js';

/**
 * Coleta o dia nas duas fontes e devolve a uniao.
 *
 * Cada fonte falha isolada: se uma cai, a outra ainda entrega, e a queda vira
 * um aviso em destaque — nunca um numero menor sem explicacao. Se as DUAS
 * caem, ai sim e erro, porque um "0 publicacoes" silencioso seria
 * indistinguivel de um dia realmente vazio.
 *
 * Devolve tambem `completo`: false quando alguma fonte LIGADA caiu ou trouxe
 * menos do que declarou. O dia entao nunca e dado por resolvido, e os retries
 * das 16h/17h voltam a tentar — o aviso conta o problema, o retry o conserta.
 * Portal desligado por configuracao (PORTAL != 1) nao conta como incompleto:
 * e uma escolha, nao uma falha, e senao todo retry rodaria para sempre.
 */
export async function coletar(dataBR) {
  const porFonte = {};
  const avisos = [];
  const falhas = [];
  let completo = true;

  // --- Fonte 1: API do CNJ (DJEN) ---
  try {
    const cnj = await buscarNoCNJ(dataBR, {
      numeroOab: config.oab.numero,
      ufOab: config.oab.uf,
      // Quem decide se vale varrer as variantes de inscricao quando a base vem
      // vazia. Num dia sem expediente, vazio e o esperado.
      diaUtil: ehDiaUtil(deBR(dataBR)),
    });
    porFonte.CNJ = cnj.publicacoes;
    if (!cnj.completo) {
      completo = false;
      avisos.push(
        `FONTE INCOMPLETA: a API do CNJ declarou mais publicações do que entregou. ` +
          `Pode estar faltando publicação — o retry tenta de novo.`,
      );
    }
  } catch (e) {
    porFonte.CNJ = [];
    falhas.push('CNJ');
    completo = false;
    avisos.push(`FONTE INDISPONÍVEL: a API do CNJ falhou (${e.message}).`);
    log.error('Fonte CNJ falhou:', e.message);
  }

  // --- Fonte 2: portal da OAB SP ---
  if (config.portalHabilitado) {
    try {
      const portal = await buscarNoPortal(dataBR);
      porFonte.Portal = portal.publicacoes;
      avisos.push(...portal.avisos);
      if (!portal.completo) completo = false;

      // Portal "genuinamente vazio" (esperado === 0) e sucesso, mas se o CNJ
      // achou publicacao pra esse mesmo dia, um portal zerado cheira mais a
      // filtro de data errado (dd/m/aaaa vs dd/mm/aaaa, por exemplo) do que a
      // coincidencia. Nao da pra ter certeza sem o seletor de paginacao
      // fechado, entao o retry tenta de novo em vez de aceitar calado.
      if (portal.publicacoes.length === 0 && porFonte.CNJ.length > 0) {
        completo = false;
        avisos.push(
          'DIVERGÊNCIA NO PORTAL: o portal não retornou nenhuma publicação para o dia, ' +
            'mas o CNJ encontrou. Pode ser filtro de data incorreto — confira manualmente.',
        );
      }
    } catch (e) {
      porFonte.Portal = [];
      falhas.push('Portal');
      completo = false;
      avisos.push(
        `FONTE INDISPONÍVEL: o portal da OAB falhou (${e.message}). ` +
          `Publicações que só existem nos diários de MG e da União podem estar faltando.`,
      );
      log.error('Fonte Portal falhou:', e.message);
    }
  } else {
    avisos.push(
      'Portal da OAB desligado nesta execução — só o DJEN (API do CNJ) foi consultado. ' +
        'Diários de MG e da União não entram nessa fonte.',
    );
  }

  if (falhas.length === Object.keys(porFonte).length) {
    throw new Error(`Todas as fontes falharam (${falhas.join(', ')}).`);
  }

  const resultado = unir(porFonte);
  return { ...resultado, avisos: [...avisos, ...resultado.avisos], completo, falhas };
}
