# Melhorias

Ideias que **não** são pendência: o sistema funciona sem elas. Cada uma diz o ganho, o custo e o risco de fazer.

Ordenadas por quanto entregam pelo que custam. Nada aqui está prometido.

---

## Alto valor

### 1. Janela de dois dias na consulta ao DJEN — em parte resolvida por outro caminho

> **21/08/2026:** a revisão do dia útil anterior (`src/revisao.js`) cobre o buraco que motivava esta ideia — publicação que entra no diário depois do último retry das 17h é apanhada no run seguinte e mandada como complemento, com a data daquele dia. O que continua valendo aqui é o resto: a API recomenda consultar ontem + hoje **na mesma consulta**, e a revisão faz uma consulta separada. Menor prioridade, mesmo ganho quase todo já entregue.

**Hoje:** consulta um único dia (`dataDisponibilizacaoInicio = Fim = hoje`).

**Ganho:** a documentação da API recomenda consultar **ontem + hoje** e deduplicar por `id`, porque a disponibilização entra a partir de 00:00 (São Paulo) e há atraso. Uma publicação que entra tarde no sistema pode nunca aparecer na consulta do próprio dia.

**Custo:** o dobro de itens por consulta e um cuidado no `state.json` — hoje o dedupe é **por dia**, e uma publicação de ontem vista hoje cairia num registro de dia diferente. Precisa de dedupe por `id` atravessando dias.

**Risco:** mexe na semântica de "as publicações do dia", que é o que o relatório diário promete. Decidir se a de ontem entra como complemento do dia de ontem ou aparece no relatório de hoje.

### ~~2. Link da certidão oficial em cada publicação~~ — FEITO em 21/08/2026

**Ganho:** cada comunicação do DJEN traz um `hash` que dá acesso a uma certidão em PDF, pública:

```
https://comunicaapi.pje.jus.br/api/v1/comunicacao/{hash}/certidao
```

É o documento oficial da intimação. Ter o link no PDF e no e-mail transforma o relatório de "aviso" em "prova".

**Como ficou:** `urlCertidao()` em `src/sources/cnj.js`, campo `certidao` na publicação, link clicável no PDF e no e-mail. Conferido contra as duas comunicações de 20/08/2026: HTTP 200, `application/pdf`, 126 KB e 61 KB. Não pede autenticação, mas — como o resto da API — só responde a IP brasileiro.

`certidao` entrou também na lista de campos que a união completa entre fontes. Sem isso, o link se perdia justamente nas publicações que existem nas duas: quando o grupo era criado pelo portal (que não tem certidão) e o CNJ chegava depois, o campo já estava lá, vazio, e não era preenchido.

### ~~3. Marcar de quem parece ser o prazo~~ — FEITO em 21/08/2026

**Ganho:** ataca o limite central do projeto. Hoje um ato com prazo único dirigido ao perito sai como se fosse seu. Dá para olhar as ~60 palavras antes do prazo e sinalizar quando o sujeito é outro ("o perito", "o Ministério Público", "a serventia", "o contador").

**Custo:** médio. É heurística de texto, e erra nos dois sentidos.

**Risco — e como ele foi tratado:** o valor está em **marcar dúvida**, nunca em esconder. Um prazo classificado como "do perito" e omitido é exatamente o modo de falhar que o projeto inteiro evita. A saída certa é uma ressalva a mais, nunca uma publicação a menos — e há um teste chamado *"marcar o sujeito NAO apaga o vencimento"* justamente para travar isso.

**Como ficou** (`sujeitoDoPrazo`, em `src/prazo.js`): olha a frase antes do prazo e marca quando o sujeito é **auxiliar do juízo** — perito, Ministério Público, contadoria, serventia, oficial de justiça, leiloeiro, administrador judicial, depositário, intérprete, curador especial.

Três decisões que a mantêm quieta:

- **"réu", "autor" e "requerido" ficam de fora da lista.** Qualquer um deles pode ser o seu cliente, e marcar "parece ser do réu" numa intimação que é sua transformaria a rede de segurança em ruído;
- **vence quem está mais perto do prazo.** Em *"o perito apresentará laudo; após, as partes serão intimadas no prazo de quinze dias"*, o sujeito dos quinze dias é "as partes" — e aí ela se cala;
- **prazo repetido com sujeitos diferentes também cala.** Marcar o sujeito errado é pior do que não marcar nenhum.

Só é perguntado quando há **um** prazo no texto — que é exatamente o caso em que uma data é estampada como se fosse sua.

### ~~3b. Texto inteiro das publicações que só existem no portal~~ — FEITO em 21/08/2026, por outro caminho

**Hoje:** o portal corta a intimação em ~986 caracteres e marca o corte com "...". Quando a mesma publicação também vem da API do CNJ, a união fica com o texto inteiro da API — foi o motivo de `melhorTexto()` preferir texto não truncado a texto mais longo. Mas quando a publicação **só** existe no portal (as de MG, da União, e as que o DJEN não trouxe), o que sai no PDF é a prévia cortada.

**Ganho:** o PDF promete inteiro teor. Em 12/08/2026, 1 das 7 publicações saiu cortada.

**Medido em 21/08/2026, contra a tela real:** as **sete** publicações de 19/08 vieram cortadas em ~986 caracteres — o portal trunca todas, não só as exclusivas. O que salva a maioria é a união com a API.

**O caminho óbvio não existe.** O portal não tem tela de detalhe: o texto inteiro só sai pelo menu "Exportar", que é `__doPostBack` → modal de confirmação → download de RTF/TXT. Mais navegação, mais seletor, mais Cloudflare e um formato a parsear, tudo dentro da fonte que já é a frágil.

**Como ficou** (`src/inteiro-teor.js`): a publicação cortada é buscada na API do CNJ **pelo número do processo**. Ela some da consulta por inscrição quando o advogado não está constituído ali — o portal recorta por nome e pega processo em que você é parte, ou em que outro advogado atua —, mas continua no DJEN, com texto inteiro e certidão. No dry run de 19/08 as duas publicações portal-only foram completadas.

Três guardas:

- **só aceita quando há UMA comunicação daquele processo naquele dia.** Com duas, não há como saber qual é esta (o mesmo processo tem intimações distintas no mesmo dia), e colar o texto errado é pior do que entregar cortado;
- **não acrescenta "CNJ" em `fontes`.** A consulta foi por processo, e não prova que a inscrição advoga ali. Marcar apagaria o "❓ sua OAB não aparece no texto" justamente nas publicações em que ele mais importa;
- **teto de 5 consultas por execução.** É a mesma API de que o envio do dia depende, e o limite dela é indocumentado: completar texto é conforto, tomar 429 é prazo.

**O que continua sem solução** — e não é o que parecia. Escrevi aqui, antes de medir, que publicação de MG ou da União não estaria no DJEN. **Errado:** medido em 21/08 nos dias 14 a 21/08, das 5 publicações que só o portal trouxe, **4 estavam no DJEN** — incluindo uma de Minas Gerais e uma da União. O que as esconde não é o diário, é a *consulta*: a busca por inscrição não acha o que não está em nome da sua OAB.

O que de fato continua cortado é outra coisa: processo com **mais de uma comunicação no mesmo dia** (a guarda se recusa a escolher — foi o caso de 21/08, o processo de MG tinha duas) e processo de **numeração antiga**, fora do padrão CNJ (`934/15`, visto em 20/08), onde consultar por número nem se aplica. As duas saem com aviso de corte, em vez de silêncio.

### ~~4. Prazo também no e-mail~~ — FEITO em 12/08/2026

**Hoje:** as datas calculadas aparecem no WhatsApp e no PDF. O corpo do e-mail lista título, processo, vara e jornal.

**Como ficou:** `linhaPrazo()` em `src/mailer.js` — vencimento, início da contagem, prazos ambíguos e a ressalva. Vermelho só onde há data: cor de alarme em tudo é o mesmo que cor de alarme em nada. Ver o item 1 de `docs/PENDENCIAS.md`.

---

## Médio valor

### ~~5. Testes de `state.js` e `merge.js`~~ — FEITO

O caminho do estado ficou injetável (`STATE_PATH`), então as regras que decidem se um dia é reenviado ou esquecido passaram a rodar contra um arquivo descartável — antes só dava para exercitá-las escrevendo no `state.json` de produção, com backup à mão. Cobertas também a união entre fontes e a checagem de saúde: **155 verificações** em `npm run teste`.

### ~~6. Aviso de silêncio ("hoje não chegou nada")~~ — FEITO

Virou a checagem das 18h (`npm run checar`). Alerta só quando o dia não fechou; dia certo não gera mensagem.

**O que ficou de fora:** a checagem mora na mesma máquina que ela vigia. PC desligado o dia inteiro, ela não roda na hora (dispara quando a máquina voltar, tarde). Falha total — máquina fora e todos os canais mortos — só um vigia externo cobriria.

### ~~7. Limpeza do `state.json` e dos `logs/`~~ — FEITO

`state.json` poda dias com mais de 120 e grava por arquivo temporário + rename (queda no meio da escrita não deixa JSON pela metade). `logs/` apaga arquivo com mais de 90 dias.

### 8. Checagem da sessão do WhatsApp antes das 14h

**Ganho:** a sessão do `whatsapp-web.js` cai sem avisar, e você só descobre no dia em que a mensagem não chega. Uma verificação de manhã avisaria com folga.

**Custo:** médio — abrir a sessão só para conferir tem custo próprio, e uma sessão aberta duas vezes ao mesmo tempo pode derrubar a outra.

---

## Baixo valor / oportunista

### 9. Mais variantes de sufixo da OAB, se aparecerem

A varredura das variantes (`-O`, `-A`, ...) está sob demanda porque **nesta inscrição nenhuma delas devolve nada** e sete consultas em rajada tomam HTTP 429. Se algum dia uma variante trouxer publicação, o log avisa em destaque e aí vale ligar `VARIANTES_OAB=1` de vez.

### 10. `htmlParaTexto` fora de `sources/cnj.js`

Hoje ela mora no módulo do CNJ porque é lá que o HTML chega. É genérica o bastante para virar utilitário se uma segunda fonte precisar.

### 11. Rodar fora do Windows

O agendamento usa o Agendador de Tarefas. Um `cron` equivalente e o pipeline roda em Linux — menos o portal, que depende de um Chrome com sessão humana.

### ~~12. Filtro de ruído no resumo do WhatsApp~~ — FEITO em 21/08/2026

Atos meramente ordinatórios ("ciência às partes") ocupam o mesmo espaço de um despacho com prazo. **Ordenar, não esconder** — e nada foi escondido.

`ordenarPorUrgencia()` em `src/prazo.js`: primeiro o que tem vencimento calculado (o mais próximo na frente), depois prazo em horas, depois prazo ambíguo, depois sem prazo declarado, e por último data ilegível. Empate mantém a ordem de entrada.

A ordenação acontece **uma vez só, em `coletar.js`** — não em cada canal. É o que garante que o item 3 do PDF seja o item 3 do WhatsApp e o item 3 do e-mail.
