# Melhorias

Ideias que **não** são pendência: o sistema funciona sem elas. Cada uma diz o ganho, o custo e o risco de fazer.

Ordenadas por quanto entregam pelo que custam. Nada aqui está prometido.

---

## Alto valor

### 1. Janela de dois dias na consulta ao DJEN

**Hoje:** consulta um único dia (`dataDisponibilizacaoInicio = Fim = hoje`).

**Ganho:** a documentação da API recomenda consultar **ontem + hoje** e deduplicar por `id`, porque a disponibilização entra a partir de 00:00 (São Paulo) e há atraso. Uma publicação que entra tarde no sistema pode nunca aparecer na consulta do próprio dia.

**Custo:** o dobro de itens por consulta e um cuidado no `state.json` — hoje o dedupe é **por dia**, e uma publicação de ontem vista hoje cairia num registro de dia diferente. Precisa de dedupe por `id` atravessando dias.

**Risco:** mexe na semântica de "as publicações do dia", que é o que o relatório diário promete. Decidir se a de ontem entra como complemento do dia de ontem ou aparece no relatório de hoje.

### 2. Link da certidão oficial em cada publicação

**Ganho:** cada comunicação do DJEN traz um `hash` que dá acesso a uma certidão em PDF, pública:

```
https://comunicaapi.pje.jus.br/api/v1/comunicacao/{hash}/certidao
```

É o documento oficial da intimação. Ter o link no PDF e no e-mail transforma o relatório de "aviso" em "prova".

**Custo:** baixo — guardar `item.hash` em `paraPublicacao()` e imprimir o link. Não precisa de proxy: abre direto no navegador (de IP brasileiro).

### 3. Marcar de quem parece ser o prazo

**Ganho:** ataca o limite central do projeto. Hoje um ato com prazo único dirigido ao perito sai como se fosse seu. Dá para olhar as ~60 palavras antes do prazo e sinalizar quando o sujeito é outro ("o perito", "o Ministério Público", "a serventia", "o contador").

**Custo:** médio. É heurística de texto, e erra nos dois sentidos.

**Risco — leia antes de fazer:** o valor está em **marcar dúvida**, nunca em esconder. Um prazo classificado como "do perito" e omitido é exatamente o modo de falhar que o projeto inteiro evita. A saída certa é uma ressalva a mais ("este prazo parece ser do perito"), nunca uma publicação a menos.

### 3b. Texto inteiro das publicações que só existem no portal

**Hoje:** o portal corta a intimação em ~986 caracteres e marca o corte com "...". Quando a mesma publicação também vem da API do CNJ, a união fica com o texto inteiro da API — foi o motivo de `melhorTexto()` preferir texto não truncado a texto mais longo. Mas quando a publicação **só** existe no portal (as de MG, da União, e as que o DJEN não trouxe), o que sai no PDF é a prévia cortada.

**Ganho:** o PDF promete inteiro teor. Em 12/08/2026, 1 das 7 publicações saiu cortada.

**Custo:** médio. Provavelmente é clicar na publicação para abrir o detalhe, o que significa mais um seletor e uma navegação por publicação — mais lento e mais frágil. Vale medir antes: se quase toda publicação do portal também vem pela API, o caso raro pode não pagar.

### 4. Prazo também no e-mail

**Hoje:** as datas calculadas aparecem no WhatsApp e no PDF. O corpo do e-mail lista título, processo, vara e jornal.

**Custo:** baixo — `src/mailer.js` já recebe as publicações; falta chamar `calcularPrazo` e imprimir, com a mesma ressalva.

---

## Médio valor

### 5. Testes de `state.js` e `merge.js`

**Hoje:** só a contagem de prazo tem teste automatizado (76 verificações). O estado e a união de fontes foram testados à mão, com um arquivo temporário que escrevia no `state.json` **real** e precisou de backup — por isso não ficou no repositório.

**O que fazer:** tornar o caminho do estado injetável (parâmetro ou variável de ambiente) para o teste usar um arquivo descartável. Aí dá para cobrir: canal faltando, fonte incompleta, registro antigo sem os campos novos, dia vazio.

**Ganho:** essas regras decidem se um dia é reenviado ou esquecido. Hoje elas só têm o comentário e a revisão como rede.

### 6. Aviso de silêncio ("hoje não chegou nada")

**Ganho:** hoje, PC desligado o dia inteiro = nenhuma mensagem e nenhum aviso. O silêncio é indistinguível de um dia sem publicação. Uma verificação semanal, ou um "nada a relatar" de fim de dia, fecharia esse buraco.

**Custo:** baixo, mas exige decidir o incômodo aceitável — mensagem todo dia sem publicação vira ruído, e ruído é o que faz um alerta ser ignorado no dia em que importa.

### 7. Limpeza do `state.json` e dos `logs/`

**Hoje:** os dois só crescem. `state.json` guarda os ids de todo dia, para sempre.

**Custo:** baixo. Apagar dias com mais de ~90 dias resolve. Não é urgente: o volume é de dezenas de ids por dia.

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

### 12. Filtro de ruído no resumo do WhatsApp

Atos meramente ordinatórios ("ciência às partes") ocupam o mesmo espaço de um despacho com prazo. Dá para ordenar por relevância — com prazo primeiro. **Ordenar, não esconder.**
