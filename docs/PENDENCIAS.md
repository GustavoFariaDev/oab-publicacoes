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

## 3. Feriados locais fora da conta de prazo

**Estado:** `FERIADOS_EXTRA` vazio.

**O que a conta já sabe:** feriados nacionais fixos, os móveis derivados da Páscoa (carnaval, Sexta-feira Santa, Corpus Christi) e o recesso de 20/12 a 20/01.

**O que ela não tem como saber:** feriado estadual, municipal e forense. Não existe fonte offline confiável.

**O que custa:** um vencimento estimado pode sair **um dia adiantado** — direção segura do erro, mas gera ruído.

**O que fazer:** preencher `FERIADOS_EXTRA` no `.env` com `dd/mm/aaaa` separados por vírgula. Para o resto de 2026, o que cai em dia útil:

| Data | Dia | O que é |
|---|---|---|
| 08/12/2026 | terça | Dia da Justiça (feriado forense) |
| — | — | Aniversários das comarcas onde você atua (São Bernardo, Santo André): **conferir no calendário do TJSP** |

01/11/2026 cai num domingo e 25/12/2026 já é nacional — nenhum dos dois muda nada.

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

## 6. Falta a primeira execução completa de ponta a ponta

Nunca aconteceu um 14h com **tudo junto**: dia zerado, portal ligado desde o início e dois canais. A de 12/08 rodou com o portal desligado e o dia já entregue.

**O que olhar amanhã depois das 14h:** se chegou pelos dois canais, se o `state.json` fechou com `canaisEntregues: ["whatsapp","email"]`, e se o e-mail caiu na caixa principal ou no spam.

---

## O limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), mas um ato com prazo único dirigido ao perito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva — e o motivo de "100%" aqui significar "coleta e entrega confiáveis", nunca "pode confiar na data sem conferir".
