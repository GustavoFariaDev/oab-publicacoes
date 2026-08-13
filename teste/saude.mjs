/** Guarda-noturno: quando alerta e, principalmente, quando fica calado. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oab-saude-')), 'state.json');
process.env.STATE_PATH = arquivo;

const { diagnosticarDia } = await import('../src/saude.js');

let ok = 0;
let mal = 0;
const eq = (nome, obtido, esperado) => {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok    ${nome}`);
  } else {
    mal++;
    console.log(`  FALHA ${nome}: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
  }
};

const DIA = '2026-08-12';
const CANAIS = new Set(['whatsapp', 'email']);
const gravar = (dia, lastError = null) =>
  fs.writeFileSync(arquivo, JSON.stringify({ lastError, days: dia ? { [DIA]: dia } : {} }));

const completo = {
  esperado: 7,
  extraido: 7,
  completo: true,
  canaisEntregues: ['whatsapp', 'email'],
  enviadoEm: new Date().toISOString(),
  ids: ['a'],
};

// --- CALA A BOCA quando esta tudo certo ---
gravar(completo);
eq('dia completo -> silencio', diagnosticarDia(DIA, CANAIS).ok, true);

// Dia vazio de verdade, entregue: nao e problema nenhum.
gravar({ ...completo, esperado: 0, extraido: 0, ids: [] });
eq('dia vazio mas entregue -> silencio', diagnosticarDia(DIA, CANAIS).ok, true);

// --- ALERTA quando nao houve entrega ---
gravar(null);
eq('sem registro do dia -> alerta', diagnosticarDia(DIA, CANAIS).ok, false);
eq(
  'e diz que nao houve entrega',
  diagnosticarDia(DIA, CANAIS).problemas[0].includes('nao registrou nenhuma entrega'),
  true,
);

gravar({ ...completo, enviadoEm: undefined });
eq('registro sem enviadoEm -> alerta', diagnosticarDia(DIA, CANAIS).ok, false);

// --- ALERTA quando falta canal ---
gravar({ ...completo, canaisEntregues: ['whatsapp'] });
const semEmail = diagnosticarDia(DIA, CANAIS);
eq('canal faltando -> alerta', semEmail.ok, false);
eq('e diz qual canal', semEmail.problemas.some((p) => p.includes('nao saiu por: email')), true);

// O MESMO estado, com so o whatsapp configurado, NAO pode alertar — senao
// quem roda com um canal so recebe alarme falso todo dia.
eq('canal nao configurado nao conta como faltando', diagnosticarDia(DIA, new Set(['whatsapp'])).ok, true);

// --- ALERTA quando a fonte veio incompleta ---
gravar({ ...completo, completo: false });
eq('fonte incompleta -> alerta', diagnosticarDia(DIA, CANAIS).ok, false);

gravar({ ...completo, extraido: 5, esperado: 7 });
eq('contagem que nao bate -> alerta', diagnosticarDia(DIA, CANAIS).ok, false);

// --- ALERTA com erro recente, e SILENCIO com erro velho ---
gravar(completo, { at: new Date().toISOString(), stage: 'envio', message: 'canal caiu' });
eq('erro recente -> alerta', diagnosticarDia(DIA, CANAIS).ok, false);

const ontem = new Date(Date.now() - 30 * 3600000).toISOString();
gravar(completo, { at: ontem, stage: 'envio', message: 'erro de ontem' });
eq('erro velho nao alerta', diagnosticarDia(DIA, CANAIS).ok, true);

// --- Estado corrompido nao derruba o vigia ---
fs.writeFileSync(arquivo, 'isso nao e json');
eq('estado corrompido -> alerta (nao explode)', diagnosticarDia(DIA, CANAIS).ok, false);

// --- Dia sem expediente nao gera alarme falso ---
// 08 e 09/08/2026 sao sabado e domingo. O pipeline nao envia nada nesses dias
// (nao ha publicacao), entao nao ha registro — e isso NAO e problema.
gravar(null);
eq('sabado sem registro -> silencio', diagnosticarDia('2026-08-08', CANAIS).ok, true);
eq('domingo sem registro -> silencio', diagnosticarDia('2026-08-09', CANAIS).ok, true);
eq('mas dia util sem registro -> alerta', diagnosticarDia('2026-08-13', CANAIS).ok, false);

// Erro no sabado ainda alerta: se o processo quebrou, e problema mesmo sem
// publicacao para entregar.
gravar(null, { at: new Date().toISOString(), stage: 'coleta', message: 'quebrou' });
eq('erro recente no sabado -> alerta', diagnosticarDia('2026-08-08', CANAIS).ok, false);

// Data ilegivel conta como dia util: na duvida o vigia fala.
gravar(null);
eq('data malformada -> alerta em vez de estourar', diagnosticarDia('nao-e-data', CANAIS).ok, false);

console.log(`\n${ok} ok, ${mal} falha(s)`);
process.exitCode = mal ? 1 : 0;
