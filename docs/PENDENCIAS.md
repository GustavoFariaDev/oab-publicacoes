# O que falta para funcionar 100%

Estado em **12/08/2026, 15h30**. Cada item diz o que é, o que custa deixar como está, e o que fazer.

## Resolvido neste dia

- **Portal da OAB** — mapeado e ligado (`PORTAL=1`). O dia 12/08 passou de 5 para 7 publicações. Testado com paginação (06/08) e com o diário de MG (07/08).
- **E-mail** — Senha de app gerada, `CANAIS=whatsapp,email`. Autenticação verificada e envio real confirmado. Acabou o ponto cego de canal único.
- **Agendador** — rodou às 14:00 com resultado `0`.
- **Contagem de prazo** — saiu em produção pelos dois canais.

---

## 1. O prazo não aparece no corpo do e-mail

**Estado:** as datas calculadas saem no WhatsApp e no PDF anexo. O corpo do e-mail lista título, processo, vara e jornal — sem prazo.

**O que custa:** o e-mail é o canal mais confiável dos dois (SMTP puro, sem biblioteca não-oficial, com autenticação de verdade). Quem lê só o corpo do e-mail não vê vencimento nenhum, e o PDF exige abrir o anexo.

**O que fazer:** `src/mailer.js` já recebe as publicações; falta chamar `calcularPrazo` e imprimir com a mesma ressalva do WhatsApp. **Custo baixo.**

---

## 2. A janela do Chrome precisa estar aberta às 14h, todo dia

**Estado:** o portal é lido por um Chrome que **você** abriu com `npm run abrir-chrome`. Se a janela estiver fechada às 14h — PC reiniciado, janela fechada sem querer — o portal falha.

**O que custa:** não quebra a automação (o aviso "FONTE INDISPONÍVEL" sai junto com o que o CNJ trouxer, e o dia fica em aberto para os retries), mas aquele dia sai sem MG, sem União e sem as publicações que só o portal tem — que em 12/08 foram 2 de 7.

**O que fazer:** uma tarefa agendada às 13h50 que abra o Chrome se a porta 9222 não estiver respondendo. A sessão fica salva em `chrome-profile/`, então normalmente sobe já logada, sem clique humano. Se o Cloudflare pedir o desafio de novo, aí sim precisa de você — e é bom que o aviso apareça.

---

## ~~3. Feriados locais fora da conta de prazo~~ — PREENCHIDO em 12/08/2026

Calendário do TJSP conferido na fonte, comarca de **São Bernardo do Campo**. Das 19 datas do Provimento CSM 2.813/2025, o código já cobria 10 (nacionais fixos + móveis da Páscoa); as outras 9 entraram no `.env`.

**Uma delas não podia entrar junto com as outras.** `20/08/2026 — ANIVERSÁRIO DA CIDADE` é a única da lista sem referência ao Provimento: vale só em São Bernardo. Como o `FERIADOS_EXTRA` é global, colá-la ali trataria 20/08 como feriado também nos processos de Campinas, Sumaré e da capital — empurrando o vencimento deles para frente, a direção que perde prazo.

Por isso existe agora `FERIADOS_COMARCA`, que amarra a data ao código de origem do processo (os 4 últimos dígitos do número CNJ):

```env
FERIADOS_EXTRA=02/04/2026,20/04/2026,05/06/2026,09/07/2026,10/07/2026,28/10/2026,07/12/2026,08/12/2026
FERIADOS_COMARCA=0564:20/08/2026
```

Medido: 15 dias úteis a partir de 14/08 vencem **04/09 em São Bernardo** e **03/09 em Campinas**. Mesma publicação, mesma regra, datas diferentes — como tem que ser.

**Em janeiro de 2027:** repetir o processo (novo Provimento, novas pontes) e acrescentar a comarca de Santo André (`0554`), que ainda não foi conferida.

---

## 3b. As demais comarcas ainda não foram conferidas

**Estado:** só São Bernardo (`0564`) tem calendário conferido. Os processos de Santo André (`0554`), Campinas (`0114`), Sumaré (`0604`) e da capital (`0100`, `0002`) contam apenas com os feriados estaduais.

**O que custa:** um feriado municipal dessas comarcas não é considerado → o vencimento sai **um dia adiantado**. É a direção segura, e a ressalva já está em toda saída — mas é ruído evitável.

**O que fazer:** mesma receita do item acima, uma comarca por vez, acrescentando ao `FERIADOS_COMARCA` separado por `;`.

---

## 3c. Sobre o `FERIADOS_EXTRA` em geral

**Estado:** preenchido com dado conferido.

**O que a conta já sabe:** feriados nacionais fixos, os móveis derivados da Páscoa (carnaval, Sexta-feira Santa, Corpus Christi) e o recesso de 20/12 a 20/01.

**O que ela não tem como saber:** feriado estadual, municipal e forense. Não existe fonte offline confiável.

**A assimetria, que é o ponto todo:**

| Erro | Efeito na contagem | Consequência |
|---|---|---|
| **Faltou** um feriado real | conta um dia que não existia → vencimento **mais cedo** | você age antes. Seguro |
| **Sobrou** um feriado falso | pula um dia útil real → vencimento **mais tarde** | acha que tem tempo. **Perde o prazo** |

Por isso não se cola lista de feriado sem conferir. Chegou a haver `08/12/2026` aqui (Dia da Justiça) e uma sugestão de sete datas de ponte atribuídas ao Provimento CSM — todas plausíveis pelo padrão (segunda antes de feriado na terça, sexta depois de feriado na quinta), **nenhuma confirmada na fonte**. Foram retiradas: a página do TJSP carrega o calendário por JavaScript e por município, e não deu para ler.

**O que fazer** (10 minutos, uma vez por ano):

1. Abrir o [Expediente Forense do TJSP](https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense)
2. Selecionar **a sua comarca** (São Bernardo, Santo André — cada uma tem as suas)
3. Copiar as datas de 2026 sem expediente
4. Preencher `FERIADOS_EXTRA=dd/mm/aaaa,dd/mm/aaaa` no `.env`

**Rede de segurança já implementada:** todo vencimento que dependeu de uma data do `FERIADOS_EXTRA` sai dizendo isso — no WhatsApp, no e-mail e no PDF, com a frase *"se não for feriado na comarca, o vencimento real é ANTES do exibido"*. Data errada deixou de ser invisível.

---

## 4. O WhatsApp entrega, mas não confirma que entregou

**Apurado em 12/08/2026.** `client.sendMessage()` devolve `undefined` em vez de um `Message` com id:

```js
return sentMsg ? new Message(this, sentMsg) : undefined;   // Client.js
```

Na mesma sessão, `getChats()` e `getChatById()` estouram com erro minificado: é a construção dos modelos de retorno que está quebrada contra o WhatsApp Web atual.

**O envio em si funciona** — mensagens de teste com retorno vazio chegaram no aparelho de destino, e as 7 publicações do dia saíram. Vale registrar o caminho errado percorrido: o retorno vazio foi lido como "não enviou", e por meia hora o diagnóstico foi de canal morto. **Retorno vazio não é prova de não-entrega — é ausência de prova.**

**O que ficou:** `enviarConferindo()` registra aviso no log e **não** lança erro. Tratar "sem confirmação" como "não enviou" derrubaria o canal, e o custo desse engano é o dia inteiro sem publicação.

**O que NÃO resolve:** `1.34.7` é a última do npm (abril/2026) e o `main` do GitHub (julho/2026) tem o mesmo comportamento — os dois testados.

**Caminho de verdade:** trocar para [Baileys](https://github.com/WhiskeySockets/Baileys), que fala o protocolo direto, sem navegador, e devolve `ack` de verdade. Significa reescrever `src/whatsapp.js` e parear de novo. Com o e-mail funcionando, deixou de ser urgente.

---

## 5. Publicação que só existe no portal sai com texto cortado

O portal corta a intimação em ~986 caracteres. Quando a publicação também vem da API, a união fica com o texto inteiro. Quando só existe no portal, sai a prévia cortada — em 12/08 foi 1 das 7. Ver item 3b de `docs/MELHORIAS.md`.

---

## ~~6. Silêncio indistinguível de falha~~ — RESOLVIDO em 12/08/2026

Uma tarefa às **18h** (`npm run checar`) lê o estado do dia e avisa se ele não fechou: sem entrega registrada, canal configurado faltando, fonte incompleta, contagem que não bate, ou erro recente. Dia certo não gera mensagem — alerta diário de "está tudo bem" vira ruído, e ruído é o que faz um alerta ser ignorado no dia em que importa.

Ele confere os canais **configurados**, não um canal fixo: com `CANAIS=whatsapp` não alerta por falta de e-mail, e um canal novo no `.env` entra na conferência sozinho.

**Limite honesto:** o vigia mora na mesma máquina que ele vigia. PC desligado = não roda na hora (a tarefa tem `StartWhenAvailable`, então dispara quando a máquina voltar — tarde, mas dispara). E se **todos** os canais estiverem mortos, o aviso também não sai. Vigia interno cobre falha de parte; falha total só um vigia de fora cobriria.

---

## 7. Falta a primeira execução completa de ponta a ponta

Nunca aconteceu um 14h com **tudo junto**: dia zerado, portal ligado desde o início e dois canais. A de 12/08 rodou com o portal desligado e o dia já entregue.

**O que olhar amanhã depois das 14h:** se chegou pelos dois canais, se o `state.json` fechou com `canaisEntregues: ["whatsapp","email"]`, e se o e-mail caiu na caixa principal ou no spam.

---

## O limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), mas um ato com prazo único dirigido ao perito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva — e o motivo de "100%" aqui significar "coleta e entrega confiáveis", nunca "pode confiar na data sem conferir".
