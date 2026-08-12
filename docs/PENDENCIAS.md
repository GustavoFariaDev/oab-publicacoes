# O que falta para funcionar 100%

Estado em **12/08/2026**. Cada item diz o que é, o que custa deixar como está, e o que fazer.

---

## ~~1. Portal da OAB desligado~~ — FEITO em 12/08/2026

Mapeado contra a tela real e ligado (`PORTAL=1`). No dia 12/08 o robô passou de 5 para **7 publicações**, achando as duas que só existiam no portal (Campinas e Sumaré). Testado também com paginação (06/08, 11 resultados em 2 páginas) e com o diário de MG (07/08, cards "DJ SP (5)" + "DJ MG (2)" somados).

**O que isso passou a exigir:** a janela do Chrome aberta por `npm run abrir-chrome` precisa estar **aberta e logada às 14h**. Se estiver fechada, o portal falha, o aviso "FONTE INDISPONÍVEL" sai junto com as publicações do CNJ e o dia fica em aberto para os retries — a automação não quebra, mas aquele dia sai só com o DJEN e você recebe o aviso em toda mensagem. Para desligar de vez: `PORTAL=0` no `.env`.

**Fica um limite:** o portal corta o texto da intimação em ~986 caracteres. Quando a publicação também vem da API, o texto inteiro dela é usado. Quando **só** existe no portal, o que sai é a prévia cortada — ver `docs/MELHORIAS.md`.

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

## ~~4. O agendador nunca executou~~ — CONFERIDO em 12/08/2026

Rodou às 14:00:00 com resultado `0`. Coletou, viu que as 5 publicações do dia já tinham saído na execução da madrugada e terminou sem enviar nada — correto. O registro do dia migrou para o formato novo (`completo`, `canaisEntregues`) e `lastError` ficou `null`.

**O que ficou faltando conferir:** uma execução em que haja o que enviar. E agora, com o portal ligado, a primeira execução real vai passar pelo Chrome — se a janela não estiver aberta às 14h, é aí que aparece o aviso de fonte indisponível.

---

## 5. A contagem de prazo nunca rodou em produção

O formato novo (datas calculadas, ressalva, regra do prazo único) só foi visto em `--dry`. A primeira mensagem real com prazo é a próxima que sair.

**O que olhar:** se a linha de prazo ajuda ou polui no celular, e se algum ato traz redação de prazo que o leitor não reconhece. `npm run teste` cobre 76 casos, mas a redação dos tribunais é mais criativa que qualquer teste.

---

## Limite que nenhum destes itens resolve

**O robô não sabe de quem é o prazo.** A regra do prazo único evita o caso mais ruidoso (ato com vários prazos, nenhum seu), mas um ato com prazo único dirigido ao perito ainda sai como se fosse seu. Só leitura humana resolve. É o motivo de toda saída levar a ressalva.
