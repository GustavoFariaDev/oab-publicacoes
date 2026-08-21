# O que falta para funcionar 100%

Estado em **21/08/2026**. Cada item diz o que é, o que custa deixar como está, e o que fazer.

## Aberto agora, em ordem de prioridade

1. **[O portal morre no run das 14h, todo dia](#0-o-portal-morre-no-run-das-14h)** — nada se perde, mas MG e União chegam 2h atrasados
2. **[As demais comarcas ainda não foram conferidas](#3b-as-demais-comarcas-ainda-nao-foram-conferidas)** — erro na direção segura, mas é ruído evitável
3. **[Publicação que nenhuma das duas fontes traz](#5-as-fontes-divergem--e-cada-divergencia-significa-uma-coisa)** — sem detecção possível
4. **[O robô não sabe de quem é o prazo](#o-limite-que-nenhum-destes-itens-resolve)** — mitigado em 21/08, não resolvido

---

## 0. O portal morre no run das 14h

**Estado:** aberto. Medido nos logs de 18, 19 e 20/08/2026.

Nos três dias, o run das **14h** perdeu a fonte Portal com *"o desafio da Cloudflare não passou sozinho"* — sempre em **exatamente 15 segundos**, que era o teto da espera. Nos três dias, o run das **16h** entrou no portal em ~7 segundos, sem desafio nenhum. Medido à mão em 21/08, com o navegador aquecido, o mesmo desafio na tela de login saiu sozinho em **3,4 segundos**.

**O que custa:** o dia não se perde — o CNJ entrega às 14h e o retry das 16h manda como complemento o que o portal trouxer. Mas tudo que **só** existe no portal (diários de MG e da União) chega duas horas depois do resto, todo dia. E o aviso de fonte caída sai todo dia, que é o jeito mais rápido de ensinar alguém a ignorar o aviso.

**O que já foi feito (21/08):** a espera subiu de 15s para 45s (`CLOUDFLARE_ESPERA_MS`) e, quando ela estoura, ficam gravados **print, HTML, URL e se há caixa para clicar** (`out/<data>/cloudflare-*.png`). Antes disso a falha diária não deixava rastro nenhum — o log dizia "desafio da Cloudflare" e acabava ali, e por isso "é só esperar mais" passou três dias sendo palpite em vez de medida.

**O que fazer:** olhar o próximo estouro. O print responde a pergunta que os logs não respondem: se o desafio é o **interativo** (tem caixa, espera gente) ou o **não-interativo** (não tem, só demora). São problemas diferentes — um pede o clique do Gus, o outro pede tempo, e agora dá para saber qual é sem adivinhar.

---

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

<a id="3b-as-demais-comarcas-ainda-nao-foram-conferidas"></a>

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

## ~~4. O WhatsApp entrega, mas não confirma que entregou~~ — RESOLVIDO em 15/08/2026, e a premissa estava errada

**O que se acreditava desde 12/08:** `client.sendMessage()` devolve `undefined` em vez de um `Message` com id:

```js
return sentMsg ? new Message(this, sentMsg) : undefined;   // Client.js
```

Na mesma sessão, `getChats()` e `getChatById()` estouram com erro minificado — a construção dos modelos de retorno está quebrada contra o WhatsApp Web 2.3000. Disso se concluiu: *"o envio funciona, só não dá para conferir"*, e `enviarConferindo()` passou a **não** lançar erro no retorno vazio.

**A conclusão estava errada, e escondeu uma falha real por três dias.** Em 15/08 um envio completo saiu com "resumo enviado" e "PDF enviado" no log, e **nada chegou no aparelho**. Bissecção com mensagens rotuladas contra a sessão real:

| Teste | Resultado |
|---|---|
| Mensagem curta, com espera antes de fechar | chegou |
| Resumo real (1.6k caracteres, emoji, markdown) | chegou |
| PDF anexo | chegou |
| Mandar e chamar `client.destroy()` **na hora** | **não chegou** |
| Mandar, esperar 8s e chamar `destroy()` | chegou |

O `sendMessage` volta **antes de a mensagem sair**, e o `destroy()` do bloco `finally` matava o navegador com ela ainda na fila. Não era limitação cosmética: era perda de mensagem, anunciada como sucesso.

**Por que o erro durou:** *"retorno vazio não é prova de não-entrega"* estava certo, e as mensagens de teste de 12/08 realmente chegaram — mas todas foram digitadas à mão, com o processo vivo depois. Nenhuma reproduziu o `destroy()` imediato do pipeline. **O teste que valida um envio precisa fechar o cliente do mesmo jeito que a produção fecha.**

**Como ficou:** existe confirmação de verdade, e ela nunca dependeu do retorno quebrado — o evento `message_ack` funciona (ack 1 = servidor recebeu, 2 = chegou no aparelho, 3 = lida). `enviarConferindo()` arma o ouvinte **antes** do envio, espera ack ≥ 1 em até 60s e **lança** se não vier. Sem ack, o canal fica pendente e o retry das 16h/17h tenta de novo — duplicata é chateação, publicação faltando é prazo.

**Baileys deixou de ser necessário para isto.** Continua sendo a opção se a biblioteca quebrar de vez, mas o motivo que a justificava (não há como saber se entregou) não existe mais.

---

<a id="5-as-fontes-divergem--e-cada-divergencia-significa-uma-coisa"></a>

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

## ~~5b. O portal enche mais tarde que a API do CNJ~~ — MEDIDO em 21/08/2026

> **A observação pedida aqui ("se em vários dias o portal ainda estiver vazio às 17h, vale mover o horário principal") foi feita.** Nos logs de 18, 19 e 20/08 o portal responde **às 16h** — não às 17h, e não às 14h. Mas a causa não é o portal encher tarde: é o desafio da Cloudflare estourar no run das 14h (item 0 acima). Mover o horário principal esconderia o defeito em vez de consertá-lo, e ainda atrasaria o envio do que o CNJ já tem às 14h. Fica como está até o item 0 ser resolvido.

## 5b. O portal enche mais tarde que a API do CNJ (registro original)

**Medido em 13/08/2026, 08h:** a API do CNJ já tinha 11 publicações do dia; o portal, zero. Às 14h de ontem o portal tinha as 7 do dia — ou seja, o filtro funciona e o portal simplesmente é atualizado mais tarde.

**Não é falha, e o sistema já lida:** quando o portal volta zero e a API traz publicação, o dia é marcado `completo: false`, sai o aviso de divergência e **o dia fica em aberto para os retries das 16h e 17h** — que recoletam e mandam como complemento o que o portal trouxer depois.

**O que observar:** se em vários dias o portal ainda estiver vazio às 17h, vale mover o horário principal para mais tarde. Se ele encher até as 16h, está tudo no lugar.

---

## ~~6. Publicação que só existe no portal sai com texto cortado~~ — RESOLVIDO em 21/08/2026, com um limite

O portal corta a intimação em ~986 caracteres — **todas elas**, e não só as exclusivas (medido em 21/08: as 7 publicações de 19/08 vieram cortadas). Quando a publicação também vem da API, a união fica com o texto inteiro; o problema era a que só existe no portal.

**Como ficou:** `src/inteiro-teor.js` busca a publicação cortada na API do CNJ **pelo número do processo** — ela é invisível à consulta por inscrição quando o advogado não está constituído ali, mas continua no DJEN com o texto inteiro. No dry run de 19/08, as duas publicações portal-only foram completadas. Detalhes e as guardas em `docs/MELHORIAS.md`, item 3b.

**O limite:** publicação que exista só nos diários de **MG ou da União** não está no DJEN e continua saindo cortada. A diferença é que agora ela **diz** que está cortada — no PDF e nos avisos do dia — em vez de parecer inteira.

---

## ~~7. Silêncio indistinguível de falha~~ — RESOLVIDO em 12/08/2026

> **Ajuste em 13/08:** sábado, domingo e feriado deixaram de gerar mensagem quando não há publicação (o diário não circula nesses dias, e eram ~104 avisos por ano dizendo nada). O guarda-noturno acompanhou: dia sem expediente e sem registro não é problema. Erro recente, porém, continua alertando em qualquer dia.

Uma tarefa às **18h** (`npm run checar`) lê o estado do dia e avisa se ele não fechou: sem entrega registrada, canal configurado faltando, fonte incompleta, contagem que não bate, ou erro recente. Dia certo não gera mensagem — alerta diário de "está tudo bem" vira ruído, e ruído é o que faz um alerta ser ignorado no dia em que importa.

Ele confere os canais **configurados**, não um canal fixo: com `CANAIS=whatsapp` não alerta por falta de e-mail, e um canal novo no `.env` entra na conferência sozinho.

**Limite honesto:** o vigia mora na mesma máquina que ele vigia. PC desligado = não roda na hora (a tarefa tem `StartWhenAvailable`, então dispara quando a máquina voltar — tarde, mas dispara). E se **todos** os canais estiverem mortos, o aviso também não sai. Vigia interno cobre falha de parte; falha total só um vigia de fora cobriria.

---

## ~~8. Falta a primeira execução completa de ponta a ponta~~ — ACONTECEU, e nove dias seguidos

**Conferido no `state.json` em 21/08/2026.** De 12 a 20/08, todo dia útil com publicação fechou com `canaisEntregues: ["whatsapp","email"]` — 12, 13, 14, 17, 18, 19 e 20/08. Sexta 15/08 não tem registro porque não havia o que registrar: o dia teve **zero** publicação nas duas fontes (reconferido na API em 21/08), e dia sem publicação não gera mensagem de propósito.

O que a série mostra, além de funcionar: 13/08 fechou com `completo: false` e continua assim, porque naquele dia uma fonte veio pela metade — e a revisão do dia anterior não reescreve o passado. É o comportamento certo, e é bom vê-lo no registro.

---

<a id="o-limite-que-nenhum-destes-itens-resolve"></a>

## O limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), e desde 21/08 a saída **marca a dúvida** quando o sujeito da frase é um auxiliar do juízo — perito, Ministério Público, contadoria, oficial de justiça (ver `docs/MELHORIAS.md`, item 3). Mas isso é leitura de texto, e erra nos dois sentidos: um ato dirigido ao perito com a frase escrita de outro jeito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva — e o motivo de "100%" aqui significar "coleta e entrega confiáveis", nunca "pode confiar na data sem conferir".
