# O que falta para funcionar 100%

Estado em **12/08/2026, 15h30**. Cada item diz o que é, o que custa deixar como está, e o que fazer.

## Resolvido neste dia

- **Portal da OAB** — mapeado e ligado (`PORTAL=1`). O dia 12/08 passou de 5 para 7 publicações. Testado com paginação (06/08) e com o diário de MG (07/08).
- **E-mail** — Senha de app gerada, `CANAIS=whatsapp,email`. Autenticação verificada e envio real confirmado. Acabou o ponto cego de canal único.
- **Agendador** — rodou às 14:00 com resultado `0`.
- **Contagem de prazo** — saiu em produção pelos dois canais.

---

## ~~1. Prazo só no WhatsApp e no PDF~~ — RESOLVIDO em 12/08/2026

O corpo do e-mail listava título, processo, vara e jornal, sem prazo nenhum — quem lesse só ele precisava abrir o anexo para saber de vencimento. Agora traz vencimento, início da contagem, prazos ambíguos e as partes, com a mesma ressalva do WhatsApp. Vermelho só onde há data: cor de alarme em tudo é o mesmo que cor de alarme em nada.

---

## ~~2. Chrome precisava estar aberto às 14h~~ — RESOLVIDO em 12/08/2026

Resolvido no lugar certo, e não por uma tarefa agendada extra: `src/chrome.js` sobe a janela com porta de depuração quando ela não está de pé, e `conectarChromeAberto()` chama isso antes de conectar. Testado com o Chrome morto à força — abriu com a sessão salva e leu o portal sem clique humano.

Uma tarefa às 13h50 chegou a ser proposta, mas seria mais uma peça capaz de falhar sozinha para resolver algo que se resolve na hora do uso.

**O que ainda depende de você:** se o Cloudflare voltar a exigir o desafio, ou se a sessão do portal cair, aí sim precisa de um clique humano — e o aviso chega pelos dois canais.

---

## ~~3. Feriados locais fora da conta de prazo~~ — PREENCHIDO em 12/08/2026

Calendário do TJSP conferido na fonte. Das 19 datas de uma comarca, o código já cobria 10 (nacionais fixos + móveis da Páscoa); as outras entraram no `.env`.

**Nem toda data podia entrar junto com as outras.** As linhas marcadas com "(PROVIMENTO CSM Nº 2.813/2025)" valem em todo o estado; a que aparece **sem** essa referência é municipal — aniversário ou fundação da cidade — e vale só naquela comarca. Como o `FERIADOS_EXTRA` é global, colar uma data municipal ali a aplicaria também aos processos das outras comarcas, empurrando o vencimento deles para frente: a direção que perde prazo.

Por isso existe `FERIADOS_COMARCA`, que amarra a data ao código de origem do processo (os 4 últimos dígitos do número CNJ):

```env
# valem no estado inteiro
FERIADOS_EXTRA=02/04/2026,20/04/2026,05/06/2026,09/07/2026,10/07/2026,28/10/2026,07/12/2026,08/12/2026

# valem só na comarca indicada
FERIADOS_COMARCA=0100:20/08/2026;0200:08/04/2026
```

Duas comarcas foram conferidas na fonte. Em ambas, as 18 datas estaduais são idênticas — a única diferença entre os calendários é a data municipal. Verificado que cada uma delas é dia não útil na sua comarca e **dia útil na vizinha**.

Medido com uma publicação real: 15 dias úteis a partir de 14/08 vencem **04/09 na comarca com feriado municipal no meio** e **03/09 na que não tem**. Mesma publicação, mesma regra, datas diferentes — como tem que ser.

**Em janeiro de 2027:** repetir. Novo Provimento, novas pontes, e o calendário municipal muda de ano.

As comarcas configuradas ficam no `.env`, que não vai para o repositório — aqui só o mecanismo.

---

## 3b. As demais comarcas ainda não foram conferidas

**Estado:** duas comarcas conferidas. Processos originados em outras contam apenas com os feriados estaduais.

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
2. Selecionar **a comarca** dos seus processos (cada uma tem o seu calendário)
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

## 5. As fontes divergem — e cada divergencia significa uma coisa

Medido em 12 e 13/08/2026, com as duas fontes ligadas:

| Situacao | Causa | Preocupa? |
|---|---|---|
| So no portal | O portal recorta por **nome**; a API consulta por **inscricao**. Pega processo em que voce e parte, e pega homonimo | Nao por si so — mas **conferir** |
| So na API | TRT e TRF publicam em diarios proprios, que os cards do portal (DJ SP / MG / Uniao) nao contam | Nao |
| Portal zerado de manha | O portal e atualizado mais tarde que a API | Nao — os retries pegam |

**O caso que fechou a duvida:** as 2 publicacoes que so o portal trouxe em 12/08 tinham o nome no **polo ativo**, uma delas com outro advogado constituido (OAB distinta). Nao eram intimacoes dirigidas ao advogado. Testado tambem que nao estavam sob nenhum sufixo de inscricao na API.

**O que ficou no codigo:** `oabConstaComoAdvogado()`. Publicacao vinda da API conta por definicao (a consulta e por inscricao); publicacao so do portal e conferida no texto. Quando a OAB nao aparece, a saida faz uma **pergunta**, nunca um descarte — o portal corta a intimacao em ~986 caracteres, e a linha do advogado pode ter ficado fora do pedaco que veio.

**O que continua sem deteccao:** publicacao em que voce e o advogado e que **nenhuma** das duas fontes traz. Nao ha como saber.

---

## 5b. O portal enche mais tarde que a API do CNJ

**Medido em 13/08/2026, 08h:** a API do CNJ já tinha 11 publicações do dia; o portal, zero. Às 14h de ontem o portal tinha as 7 do dia — ou seja, o filtro funciona e o portal simplesmente é atualizado mais tarde.

**Não é falha, e o sistema já lida:** quando o portal volta zero e a API traz publicação, o dia é marcado `completo: false`, sai o aviso de divergência e **o dia fica em aberto para os retries das 16h e 17h** — que recoletam e mandam como complemento o que o portal trouxer depois.

**O que observar:** se em vários dias o portal ainda estiver vazio às 17h, vale mover o horário principal para mais tarde. Se ele encher até as 16h, está tudo no lugar.

---

## 6. Publicação que só existe no portal sai com texto cortado

O portal corta a intimação em ~986 caracteres. Quando a publicação também vem da API, a união fica com o texto inteiro. Quando só existe no portal, sai a prévia cortada — em 12/08 foi 1 das 7. Ver item 3b de `docs/MELHORIAS.md`.

---

## ~~7. Silêncio indistinguível de falha~~ — RESOLVIDO em 12/08/2026

> **Ajuste em 13/08:** sábado, domingo e feriado deixaram de gerar mensagem quando não há publicação (o diário não circula nesses dias, e eram ~104 avisos por ano dizendo nada). O guarda-noturno acompanhou: dia sem expediente e sem registro não é problema. Erro recente, porém, continua alertando em qualquer dia.

Uma tarefa às **18h** (`npm run checar`) lê o estado do dia e avisa se ele não fechou: sem entrega registrada, canal configurado faltando, fonte incompleta, contagem que não bate, ou erro recente. Dia certo não gera mensagem — alerta diário de "está tudo bem" vira ruído, e ruído é o que faz um alerta ser ignorado no dia em que importa.

Ele confere os canais **configurados**, não um canal fixo: com `CANAIS=whatsapp` não alerta por falta de e-mail, e um canal novo no `.env` entra na conferência sozinho.

**Limite honesto:** o vigia mora na mesma máquina que ele vigia. PC desligado = não roda na hora (a tarefa tem `StartWhenAvailable`, então dispara quando a máquina voltar — tarde, mas dispara). E se **todos** os canais estiverem mortos, o aviso também não sai. Vigia interno cobre falha de parte; falha total só um vigia de fora cobriria.

---

## 8. Falta a primeira execução completa de ponta a ponta

Nunca aconteceu um 14h com **tudo junto**: dia zerado, portal ligado desde o início e dois canais. A de 12/08 rodou com o portal desligado e o dia já entregue.

**O que olhar amanhã depois das 14h:** se chegou pelos dois canais, se o `state.json` fechou com `canaisEntregues: ["whatsapp","email"]`, e se o e-mail caiu na caixa principal ou no spam.

---

## O limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), mas um ato com prazo único dirigido ao perito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva — e o motivo de "100%" aqui significar "coleta e entrega confiáveis", nunca "pode confiar na data sem conferir".
