# O que falta para funcionar 100%

Estado em **12/08/2026**. Cada item diz o que é, o que custa deixar como está, e o que fazer.

Ordem de prioridade: **1 → 2 → 3**. Os itens 4 e 5 são conferências, não trabalho.

---

## 1. Portal da OAB desligado — a maior falta de cobertura

**Estado:** `PORTAL=0`. Em `src/sources/portal.js` há **7 seletores** ainda com o valor literal `TODO(fase-1)` e a função `irParaPublicacoesPorData()` só lança erro.

**O que custa:** o portal agrega os **diários de MG e da União**, que não existem na API do CNJ. Medido em 01/07–11/08/2026: portal ~179 publicações contra 152 da API — cerca de **15% a menos** hoje.

Pior: as duas fontes divergem **nos dois sentidos**, então nenhuma contém a outra. Conferido contra o resumo do portal em 12/08/2026:

| Data | Portal (card) | API do CNJ | |
|---|---|---|---|
| 12/08/2026 | DJ SP (7) | 5 | **faltaram 2 do próprio DJ SP** |
| 11/08/2026 | DJ SP (10) | 10 | bate |
| 07/08/2026 | DJ SP (5) + DJ MG (2) | 5 | faltaram as 2 de MG |
| 06/08/2026 | DJ SP (11) | 14 | a API trouxe **3 a mais** (TRT e TRF3, que o card "DJ SP" não conta) |

E há um agravante: **com `PORTAL=0` o robô não enxerga essa falta**. O card do portal é a única contagem independente da nossa extração — é dele que sai o aviso de divergência. Sem ele, 5 publicações num dia de 7 parecem um dia de 5.

**O que fazer** (precisa de uma sessão com o Chrome aberto e autenticado — o Cloudflare Turnstile exige clique humano):

1. `npm run abrir-chrome`, clicar em "Confirme que é humano", fazer login
2. Navegar até **Histórico > Publicações por Data** e deixar a janela aberta
3. `npm run inspecionar` e usar o comando `dump` em cada tela para listar os elementos
4. Preencher `SEL` em `src/sources/portal.js`, preferindo texto visível (`getByRole`, `getByText`) a ID do ASP.NET — texto sobrevive melhor a redesenho
5. Implementar `irParaPublicacoesPorData()`
6. Ligar `PORTAL=1` e rodar `npm run dry` conferindo o print salvo em `out/<data>/portal.png`

**Custo operacional depois de pronto:** a janela do Chrome precisa estar aberta e com sessão viva às 14h, todo dia. Se não estiver, o portal falha, o aviso sai no WhatsApp e o dia fica em aberto para os retries — a automação não quebra, mas aquele dia sai só com o DJEN.

**Pendência menor dentro desta:** `SEL.proximaPagina` também está `TODO`. Sem ele o robô lê só a primeira página (10 resultados). Isso **não passa em silêncio** — a divergência contra o resumo do dia vira aviso em destaque e marca o dia como incompleto —, mas até fechar esse seletor todo dia com mais de 10 publicações no portal vai gerar aviso.

---

## 2. Canal único — o ponto cego

**Estado:** `CANAIS=whatsapp`. `SMTP_PASS` está vazio.

**O que custa:** duas coisas, e a segunda é pior que a primeira.

- Se a sessão do WhatsApp cair, **nada chega**.
- O aviso de falha também sai só pelo WhatsApp. Ou seja: **se o WhatsApp é a falha, você não é avisado de nada.** Um dia sem mensagem fica indistinguível de um dia sem publicação.

**O que fazer:** gerar uma **Senha de app** do Google (não é a senha da conta):

> Conta Google → Segurança → **Verificação em duas etapas** → Senhas de app → gerar

Se a opção "Senhas de app" não aparecer, quase sempre é porque a verificação em duas etapas está desativada — ela é pré-requisito. Colar em `SMTP_PASS` e trocar para `CANAIS=whatsapp,email`. **Nenhuma linha de código muda.**

**Alternativas** se a conta não permitir: usar outra conta Google só para envio, ou trocar o transporte para OAuth2 (aí sim mexe em `src/mailer.js`).

---

## 3. Feriados locais fora da conta de prazo

**Estado:** `FERIADOS_EXTRA` vazio.

**O que a conta já sabe:** feriados nacionais fixos, os móveis derivados da Páscoa (carnaval, Sexta-feira Santa, Corpus Christi) e o recesso de 20/12 a 20/01.

**O que ela não tem como saber:** feriado estadual, municipal e forense. Não existe fonte offline confiável — o buscador que serviu de referência usa API do IBGE e um JSON por tribunal.

**O que custa:** um vencimento estimado pode sair **um dia adiantado**. É a direção segura do erro (você confere antes), mas gera ruído.

**O que fazer:** preencher `FERIADOS_EXTRA` no `.env` com `dd/mm/aaaa` separados por vírgula, conferindo o calendário do TJSP. Para o resto de 2026, o que cai em dia útil e afeta contagem:

| Data | Dia | O que é |
|---|---|---|
| 08/12/2026 | terça | Dia da Justiça (feriado forense) |
| — | — | Aniversários das comarcas onde você atua (São Bernardo, Santo André): **conferir no calendário do TJSP** |

01/11/2026 cai num domingo e 25/12/2026 já é nacional, então nenhum dos dois muda nada.

---

## 4. O agendador nunca executou de verdade

**Estado:** as três tarefas existem e estão `Ready`, apontando para `D:\oab-pubs` (junction válida), com `node.exe` e argumentos corretos. Mas `LastRunTime` = 1999 e resultado `267011` = "ainda não executou".

**O que fazer:** só conferir, depois das 14h:

- chegou mensagem no WhatsApp (ou não, se não havia publicação nova — o que também é correto)
- `state.json` ganhou os campos `completo` e `canaisEntregues` no dia
- `logs/` tem o registro da execução
- `state.json` → `lastError` está `null`

---

## 5. A contagem de prazo nunca rodou em produção

O formato novo (datas calculadas, ressalva, regra do prazo único) só foi visto em `--dry`. A primeira mensagem real com prazo é a próxima que sair.

**O que olhar:** se a linha de prazo ajuda ou polui no celular, e se algum ato traz redação de prazo que o leitor não reconhece. `npm run teste` cobre 76 casos, mas a redação dos tribunais é mais criativa que qualquer teste.

---

## Limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), mas um ato com prazo único dirigido ao perito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva.
