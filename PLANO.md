# Automação OAB SP — Publicações do dia

Robô que, **todo dia às 14h**, entra no portal da OAB SP, consulta as publicações do Diário da Justiça **do dia corrente** e manda por **e-mail** e **WhatsApp**.

- **Conta / destinos:** vêm do `.env` (`OAB_NUMERO`, `MAIL_TO`, `WHATSAPP_TO`) — nunca versionados
- **Portal:** https://www2.oabsp.org.br → *Histórico → Publicações por Data*

---

## Por que isso existe

Perder uma publicação é perder prazo processual. A conferência manual é diária, repetitiva e o custo de esquecer um dia é alto. O robô tira o "lembrar" da equação.

---

## O que ele faz, em ordem

1. Abre o Chrome com um perfil salvo e entra no portal (loga sozinho se a sessão caiu).
2. Vai em *Histórico → Publicações por Data*.
3. Coloca **data inicial = data final = hoje** e clica **Consultar**.
4. Clica em **Visualizar tudo** — nunca em "Visualizar selecionados".
5. Extrai cada publicação: nº do processo, vara, tribunal, jornal, título, data e o **texto integral** da intimação.
6. Gera um **PDF** com tudo e um **print** da tela, salvos em `out/AAAA-MM-DD/`.
7. Manda o **e-mail** com PDF + print anexos.
8. Manda o **WhatsApp** com um resumo curto + o PDF.
9. Anota no `state.json` o que já foi enviado.

Se não houver publicação nenhuma, ele **avisa mesmo assim** ("nenhuma publicação hoje"). Silêncio nunca é ambíguo: se você não recebeu nada, é porque algo quebrou — não porque o dia estava vazio.

---

## As decisões que explicam o resto do projeto

### 1. Duas fontes, unidas — e por quê

O robô consulta **duas fontes independentes** e junta o resultado sem duplicar. Uma publicação só se perde se **as duas** falharem.

**Fonte A — API pública do CNJ (DJEN).** `comunicaapi.pje.jus.br`. Sem login, sem senha, sem Cloudflare, resposta em JSON estruturado. É a espinha do dia a dia: rápida e sem atrito.

**Fonte B — portal da OAB SP.** Mais completa, porém com atrito (Cloudflare + login).

Por que não usar só a API, que é infinitamente mais simples? Porque **ela é incompleta**. Medição real feita em 11/08/2026, comparando com o histórico do portal:

| Data | Portal | API CNJ | Falta |
|---|---|---|---|
| 11/08 | 10 | 10 | — |
| 29/07 | 10 | 9 | 1 |
| 07/08 | 7 | 5 | 2 |
| 22/07 | 14 | 10 | 4 |
| 14/07 | 5 | 1 | 4 |
| 10/07 | 2 | **0** | 2 |

Na janela 01/07–11/08: **portal ≈ 179, API 152**. A API cobre o DJEN; o portal agrega também os diários de **MG e da União**, que não vêm no DJEN sob a inscrição de SP (verificado: consulta com `ufOab=MG` devolve zero).

Perder 15% quando o custo do erro é prazo processual é inaceitável. Daí a união.

### 2. Por que o portal se conecta a um Chrome já aberto

O portal usa **Cloudflare Turnstile** — a caixa "Confirme que é humano". Um Chrome **lançado pelo Playwright é reprovado no desafio mesmo com um humano clicando**: as marcas de automação do lançador entregam o navegador. Isso foi testado e confirmado.

A solução é inverter: `npm run abrir-chrome` inicia o Chrome como um **processo normal do sistema**, com perfil próprio e porta de depuração. Você clica no Cloudflare e faz o login — como faria num dia qualquer. O robô depois apenas **se conecta a essa janela e lê** a página que você já autenticou.

O clique no desafio é sempre seu. Nada no projeto tenta resolver o Turnstile automaticamente.

### 2. Por que "Visualizar tudo", e não marcar os quadradinhos

**Um mesmo dia pode ter mais de um card.** Nos seus prints:

| Data | Cards |
|---|---|
| 07/08/2026 | DJ MG (2) **e** DJ SP (5) |
| 22/07/2026 | DJ MG (4), DJ SP (9) **e** DJ União (1) |
| 05/08/2026 | DJ MG (1) **e** DJ SP (1) |

Publicações de outros estados e da União entram como **cards separados na mesma data**. Marcar o checkbox do primeiro card e clicar "Visualizar selecionados" é exatamente onde uma publicação se perde — e é justamente a de outro estado, a que você menos espera.

Por isso: filtro travado em hoje→hoje + **Visualizar tudo**. E, por cima disso, um guard-rail.

### 4. Duplicata a mais é chateação; publicação a menos é prazo perdido

Ao unir as duas fontes é preciso decidir quando dois registros são "o mesmo ato". Essa regra quase custou caro: uma primeira versão comparava os 120 primeiros caracteres do texto e **fundiu duas publicações reais numa só**.

O caso real: em 11/08/2026, o processo `1000130-40.2026.5.02.0467` tem **duas notificações distintas** (`numeroComunicacao` 33004 e 33005, textos de 1203 e 1219 caracteres). Os primeiros 160 caracteres são idênticos, porque o cabeçalho da vara é padronizado. Deduplicar por prefixo apagava uma delas.

Regra atual, em `src/merge.js`:
- **Dentro de uma mesma fonte, nada é fundido.** A fonte já distingue os próprios registros.
- **Entre fontes**, só funde com similaridade ≥ 0,9 do texto inteiro.

O erro é assimétrico e a regra assume esse lado: na dúvida, mantém as duas.

### 5. Por que só WhatsApp, por enquanto

A conta Gmail usada no teste não conseguiu gerar Senha de app (a página `/apppasswords` responde *"configuração não disponível para sua conta"*). Em vez de deixar a automação parada esperando isso, os canais viraram configuráveis por `CANAIS` no `.env`, e o WhatsApp — que só depende do QR, nada do Google — passou a rodar sozinho.

Duas consequências que o código precisou absorver:

- **O aviso de erro também sai pelo zap** (`enviarWhatsAppDeErro`). Sem isso, com o e-mail desligado uma falha não teria por onde avisar, e silêncio voltaria a ser ambíguo — que é justamente o que este projeto não aceita.
- **Se nenhum canal entregar, o dia não conta como enviado.** O `index.js` levanta erro, o `state.json` fica sem `enviadoEm` e o retry das 16h refaz o envio inteiro. Antes, o e-mail sozinho decidia isso.

**Isto não substitui o e-mail — adia.** O `whatsapp-web.js` é não-oficial e a sessão cai sozinha; enquanto ele for o único canal, uma sessão derrubada é uma publicação perdida sem backup. Assim que a Senha de app existir (ou o OAuth2 da Gmail API), basta `CANAIS=whatsapp,email` — nenhuma linha de código muda.

### Guard-rail de contagem

O robô soma os números entre parênteses de **todos** os cards do dia (`esperado`) e compara com quantas publicações realmente extraiu (`extraído`).

- Bateu → segue normal.
- Não bateu → o e-mail sai com um **aviso em destaque no topo** e o log registra a diferença.

A ideia é que uma falha de extração **apareça**, em vez de virar um e-mail bonito com publicação faltando dentro.

---

## Como usar

### Instalação (uma vez)

```bash
cd "D:\Programação VS\automação OAB Publicaçoes"
npm install
```

Não é preciso baixar o Chromium do Playwright: o robô usa o **Chrome que já está instalado** na máquina (`channel: 'chrome'`), justamente porque o Chrome de verdade passa pela Cloudflare com muito mais frequência do que o Chromium de teste.

### Configurar credenciais

Copie `.env.example` para `.env` e preencha. **O `.env` nunca vai pro Git** — está no `.gitignore`.

**Canais de envio.** `CANAIS` no `.env` decide por onde as publicações (e os avisos de falha) saem: `whatsapp`, `email` ou `whatsapp,email`. Hoje está em **`whatsapp`** — ver "Por que só WhatsApp, por enquanto" abaixo.

Pro e-mail você precisa de uma **Senha de app** do Google (não é a senha normal da conta):
Conta Google → Segurança → Verificação em duas etapas → **Senhas de app** → gerar → colar em `SMTP_PASS`.

### Primeiro login no portal

```bash
npm run abrir-chrome
```

Abre uma janela do Chrome normal, com perfil próprio (`chrome-profile/`). **Nela**: clique em "Confirme que é humano" (Cloudflare), faça o login e vá até a tela de publicações. **Deixe a janela aberta** — o robô se conecta a ela para ler.

Esse é o **único** caminho de entrada no portal. Não existe mais um login automatizado paralelo: o Chrome lançado pelo Playwright é reprovado pelo Turnstile mesmo com você clicando na caixa, e manter os dois caminhos apontando para o mesmo `chrome-profile/` só criava dúvida sobre qual sessão tinha ficado salva.

Enquanto o portal não estiver com os seletores fechados (fase 1), ele fica desligado por padrão — só entra na coleta com `PORTAL=1` no `.env`.

### Conectar o WhatsApp (uma vez)

```bash
npm run setup:whatsapp
```

Mostra um QR Code no terminal. Escaneie com o celular (WhatsApp → Aparelhos conectados). A sessão fica salva em `.wwebjs_auth/`.

### Agendar as 14h (uma vez)

```bash
npm run register-task
```

### Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `npm run abrir-chrome` | Abre o Chrome pro portal (clique no Cloudflare + login, deixe aberto). |
| `npm run dry` | Roda tudo e gera PDF + print, **sem enviar nada**. Use pra testar. |
| `npm run once` | Roda o pipeline completo agora, com envio real. |
| `npm run once -- --data=07/08/2026` | Roda forçando uma data específica. Útil pra testar. |
| `npm run inspecionar` | Conecta na janela já aberta pra capturar seletores (`dump`, `url`, `sair`). |
| `npm run setup:whatsapp` | Reconecta o WhatsApp (novo QR). |

---

## Agendamento

Tarefa diária às **14:00** no Agendador de Tarefas do Windows, com "executar assim que possível se a execução for perdida" — se o PC estiver desligado às 14h e você ligar às 16h, ele roda.

**Retries condicionais às 16h e 17h.** Não sabemos ainda se às 14h a publicação do dia já está sempre completa no portal (isso vai ser observado nos primeiros dias). Até ter certeza, existem duas passadas extras. Elas não fazem nada se o dia estiver **resolvido**, e um dia só está resolvido quando as quatro coisas valem:

1. saiu (`enviadoEm`);
2. saiu por **todos** os canais ligados em `CANAIS` — se o e-mail entregou e o WhatsApp caiu, o dia chegou pela metade e as 16h completam o canal que faltou;
3. **nenhuma fonte ligada caiu ou veio pela metade** — portal fora do ar às 14h só tem antídoto se as 16h tentarem de novo;
4. a contagem bate.

Qualquer "não" aí deixa o dia em aberto para o retry.

**Mas o retry sempre coleta de novo, mesmo com o dia resolvido.** Até 12/08/2026 ele saía antes de consultar a API quando o dia estava completo. Parecia economia, e era um buraco: `completo` mede "nenhuma fonte falhou", não "nada mais pode chegar" — e publicação entra no diário ao longo do dia. Uma que aparecesse depois das 14h não seria vista às 16h nem às 17h, que é exatamente o caso para o qual o retry existe. Agora ele consulta sempre; quem decide se envia é o dedupe. Sem novidade e sem canal pendente, termina em silêncio e você não recebe duplicata.

Um detalhe do item 2: o canal que ficou para trás recebe o **dia inteiro**, não só o que faltava — e por isso o canal que já estava em dia pode receber repetido quando os dois envios se cruzam. É a troca certa: duplicata é chateação, publicação faltando é prazo.

**Sobre o caminho com acentos.** `D:\Programação VS\automação OAB Publicaçoes` tem acento e espaço, e o Agendador de Tarefas quebra em silêncio com isso mais vezes do que deveria. O script de registro cria um atalho de sistema sem acento:

```
mklink /J D:\oab-pubs "D:\Programação VS\automação OAB Publicaçoes"
```

O projeto continua morando onde está — só o Agendador enxerga o caminho `D:\oab-pubs`.

---

## Quando der problema

Primeiro lugar pra olhar: **`state.json`**, campo `lastError` — tem o horário e em qual etapa parou. Como a tarefa roda sem terminal à vista, esse campo é o principal diagnóstico. Depois, os logs em `logs/`.

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Parou de chegar e-mail | Sessão da OAB caiu ou Cloudflare endureceu | `npm run abrir-chrome` e refazer o login na janela |
| E-mail chega, WhatsApp não | Sessão do WhatsApp Web caiu | `npm run setup:whatsapp` — o retry das 16h reenvia o dia pelo canal que faltou |
| Chegou o texto no zap mas sem o PDF | Anexo grande demais | Normal — o PDF está no e-mail e em `out/` |
| E-mail com aviso de divergência no topo | Guard-rail detectou publicação faltando | Conferir manualmente no portal naquele dia |
| Nada acontece às 14h | PC desligado, ou caminho da tarefa quebrado | `Get-ScheduledTask`, e rodar a tarefa manualmente pelo Agendador |
| Erro de autenticação no e-mail | Senha de app expirada/revogada | Gerar nova Senha de app no Google |

---

## Contagem de prazo

Cada publicação sai no WhatsApp e no PDF com as datas calculadas a partir da disponibilização, seguindo o CPC:

| Etapa | Regra |
|---|---|
| Disponibilização | o dia em que o ato apareceu no DJe (vem da fonte) |
| Publicação | primeiro dia útil seguinte — art. 224, §2º |
| Contagem começa | primeiro dia útil após a publicação |
| Vencimento | contado em dias úteis, pulando feriado e recesso |

Feriados: nacionais fixos, mais os móveis derivados da Páscoa (carnaval, Sexta-feira Santa, Corpus Christi) pelo algoritmo de Meeus, mais o **recesso de 20/12 a 20/01** (art. 220). Feriado estadual, municipal ou forense entra à mão em `FERIADOS_EXTRA` no `.env` — não há fonte offline confiável para eles.

**O vencimento só é calculado quando o texto declara um único prazo.** Quando o ato cita vários, o robô lista os prazos e não arrisca data. Isso não é excesso de cautela: o DESPACHO de 12/08/2026 no processo 4047179-45.2026.8.26.0002 cita quatro prazos — cinco dias e trinta dias do *perito*, dez dias para os *esclarecimentos dele*, e quinze dias das partes que só correm **depois da entrega do laudo**. Nenhum era do advogado naquele dia. Uma versão anterior escolhia o menor e teria estampado "vence 20/08/2026", data de ninguém. Data falsa gasta a confiança no aviso, e no dia em que o vencimento for verdadeiro ele vai parecer mais um palpite.

O que a conta **não** sabe, e por isso todo vencimento sai marcado como estimativa: feriado local, suspensão do tribunal, prazo em dobro (Fazenda, DP, litisconsortes) e de quem é o prazo. `npm run teste` roda as 51 verificações dessa lógica.

---

## Limites conhecidos (e assumidos)

- **PC desligado às 14h = risco de perder o dia**, já que a janela é "somente hoje". O "executar se perdida" cobre o caso de você ligar mais tarde no mesmo dia, mas não cobre o PC ficar desligado o dia inteiro.
- **`whatsapp-web.js` é não-oficial.** Se o WhatsApp derrubar a sessão, precisa reescanear o QR. Por isso e-mail e zap são independentes: **falha no zap nunca impede o e-mail de sair**. O e-mail é a fonte da verdade.
- **A Cloudflare pode endurecer** e passar a exigir CAPTCHA interativo. Aí a automação para e avisa — que é melhor do que falhar em silêncio.
- **A API do CNJ limita requisição sem documentar o limite.** Sete consultas em rajada (uma por variante de sufixo da OAB) tomam HTTP 429 na hora, e com o portal desligado o CNJ é a única fonte — 429 não custa "menos publicações", custa o dia. Por isso a varredura de variantes é sob demanda, e há espera crescente em 429/5xx.
- **O portal pode mudar de layout.** Os seletores preferem texto visível ("Consultar", "Visualizar tudo") em vez de IDs internos, justamente porque texto sobrevive melhor a redesenho. Ainda assim, mudança grande = ajuste necessário.

---

## Segurança

- Senha da OAB e Senha de app do Gmail ficam **só** no `.env` local, que está no `.gitignore`. Nunca em repositório, nem em commit "temporário".
- A senha da OAB circulou em texto plano durante o planejamento deste projeto. **Recomendo trocá-la no portal** e usar a nova no `.env` — a automação lê de lá, trocar não quebra nada.

---

## Estado do projeto

- [x] **Fase 0** — Plano e esqueleto
- [x] **Fonte A (CNJ)** — funcionando e verificada com dado real: 11/08/2026 devolve as 10 publicações, PDF de 10 páginas gerado
- [x] **União das fontes** — regra de dedupe corrigida e testada (4 casos, incluindo as duas notificações do TRT2)
- [x] **PDF** — gerado e validado
- [ ] **Fonte B (portal)** — código escrito; faltam os seletores (`TODO(fase-1)` em `src/sources/portal.js`), que dependem de uma sessão logada
- [x] **WhatsApp** — conectado e validado com envio real em 12/08/2026 (5 publicações: resumo + PDF entregues)
- [x] **Canais configuráveis** — `CANAIS` no `.env`; aviso de falha sai por todo canal ligado
- [ ] **E-mail** — bloqueado: a conta não libera Senha de app (ver decisão 5). Alternativa: OAuth2 com a Gmail API
- [ ] **Agendamento** — pode ser feito agora, já que o zap entrega sozinho

### Medição pendente: durabilidade do cookie da Cloudflare

Depois do primeiro clique no Turnstile, é preciso medir **quanto tempo a liberação dura** antes de exigir novo clique. Isso decide se o portal pode entrar na rotina automática das 14h ou se vira uma conferência manual periódica. Até essa medida existir, a API do CNJ é a fonte que sustenta o dia a dia.
