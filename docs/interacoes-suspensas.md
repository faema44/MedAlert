# Interações: por que foram suspensas nos medicamentos (13/07/2026)

**O que continua de pé:** a tabela em **Configurações → Tabelas**, para consulta. Ela usa a base
inteira (`src/data/interactions.json`), o motor (`checkInteractions` em `src/utils/drugSearch.ts`),
o cartão (`components/CartaoInteracao.tsx`), o termo de aceite e os gates. **Nada disso foi
apagado.**

**O que foi desligado:** os dois pontos de entrada que ligavam as interações aos remédios DO
USUÁRIO — o chip "N interações detectadas" na Home e o "⚠ N interações" em cada cartão de
medicamento, com seus modais. E o `is_critical`, que era derivado das interações no momento de
salvar o medicamento.

Para ressuscitar: `git revert` do commit que trouxe este arquivo, ou reconstruir os dois chips
chamando `checkInteractions(nome, outrosNomes)` — a assinatura não mudou.

---

## Por que suspendemos

Não foi por falta de precisão da base. Foi porque **cada rodada de teste do Fabio achava um erro
novo**, e nenhum deles era do tipo que a auditoria pegava. A sequência, na ordem em que doeu:

1. **1273 alarmes falsos** por token de sal/forma. `Cloridrato de Cefepime` (antibiótico) herdava
   o alerta do `Cloridrato de amiodarona`; `Ergotamina` herdava o da `Colchicina (gota)` porque
   contém "gota"; `Aminoácidos` virava um NOAC ("ami-NOAC-idos"). Corrigido, com gate.
2. **84 alertas permanentes indevidos**: `Fenobarbital` (= Gardenal, remédio que gente toma de
   verdade) estava na lista de "álcool", e o atalho do álcool DISPENSA o casamento — então o gate
   não via. *Quem achou foi o Fabio, testando.* Lição: **um gate só enxerga o caminho que ele
   percorre.**
3. **Bula de composto no slug do ingrediente puro** — a bula do Contrave (bupropiona + naltrexona)
   ocupava o slug da bupropiona. O hash dos PDFs achou 6 bulas trocadas que a leitura de texto
   aprovava, porque a capa só trazia o nome comercial.
4. **O cartão falava do remédio dos outros.** O Fabio toma enalapril; o cartão dizia
   "Captopril / Enalapril (IECA) + AAS" e o link da fonte abria a bula do **captopril**. O alerta
   estava CERTO — e mesmo assim o app parecia errado. **351 entradas (13%) tinham esse formato.**
   Corrigido (o cartão passou a mostrar o nome que o usuário cadastrou), mas foi a gota d'água.

O padrão: **erro de apresentação queima a confiança tão rápido quanto erro de conteúdo**, e num
app de medicamento a confiança é o produto. Alarme falso ensina o usuário a ignorar o alerta que
importa — inclusive o alerta certo.

## O que ficou por fazer (se voltar)

- **Entradas duplicadas.** Esomeprazol + Varfarina gera TRÊS cartões quase idênticos
  (`int_1729`, `int_2477`, `int_077` — todos "IBP × varfarina"). Três cartões dizendo o mesmo é o
  tipo de ruído que faz o usuário ignorar tudo. Falta dedup de CONTEÚDO (o dedup atual é por `id`).
- **52 interações críticas ainda sem fonte** (`docs/auditoria/SEM_FONTE.md`). Sem fonte não quer
  dizer errada — Metformina × Contraste Iodado está entre elas e é clássica —, quer dizer que o
  app não tem o que citar.
- **30 entradas cuja fonte abre a bula de outro medicamento** (teto no gate). A maioria é
  legítima (a bula do "Glibenclamida + Metformina" realmente documenta a interação da
  glibenclamida), mas abre um produto que o usuário não toma. O cartão avisa antes do toque.
- **Auditoria humana.** É o que falta de verdade, e é o que um app gratuito não paga. Sem isso,
  interação medicamentosa é uma promessa que não dá para cumprir com honestidade.

## IDEIA PARA O FUTURO: verificação por IA, sob demanda (Fabio, 13/07/2026)

Em vez de o app **vigiar** os remédios e disparar alertas — que é o que foi suspenso —, ele
oferece uma **varredura sob demanda**:

> "Quer que a IA faça uma varredura na sua lista de medicamentos e procure interações?"

E o que sai não é um alerta: é um **relatório**, explicitamente rotulado como feito por IA. O app
**avisa, mas não assume a responsabilidade** — a validação do resultado é do médico.

**Por que isso é diferente do que suspendemos, e por que pode funcionar:**

- **É um ato do usuário, não do app.** Ele pede a varredura; não é o app afirmando algo sozinho na
  tela, todo dia, ao lado do lembrete. Muda quem está fazendo a alegação.
- **Relatório não banaliza.** O alerta permanente é o que ensina a ignorar (ver os 1273 alarmes
  falsos e o fenobarbital). Um relatório que se lê uma vez e se leva ao consultório não tem essa
  erosão.
- **A moldura é honesta desde o primeiro pixel**: "isto foi gerado por IA, pode conter erros, leve
  ao seu médico". Não é letra miúda no rodapé — é o que o documento É.
- **O destino do resultado é o médico**, não uma decisão do paciente sozinho às 23h.

**O que NÃO resolve, e não adianta fingir que resolve:**

- A base continua sendo a mesma, com os mesmos erros. Relatório errado continua errado — só muda
  quem carrega a responsabilidade, e "a IA disse" não é defesa se o app foi quem ofereceu a
  varredura. **Antes de ligar isso, as pendências desta página continuam valendo** (duplicatas,
  52 críticas sem fonte, 30 fontes de outro medicamento).
- O rótulo "feito por IA" **protege menos do que parece**. Ele ajuda com o usuário atento; não
  ajuda com quem toma a decisão errada e se machuca. A régua continua sendo: não afirmar o que não
  se pode sustentar.

## O que APRENDEMOS e não pode se perder

- **Auditoria de eixo único é cega.** A leitura de texto aprovava bulas trocadas; foi o *hash* que
  as pegou. Toda checagem nova precisa de um eixo diferente do que já existe.
- **Gate não substitui usuário.** Os três erros mais graves foram achados pelo Fabio abrindo o
  app, não pelas ferramentas. O botão "Informar erro" (que ficou no cartão) existe por isso.
- **O motor sabia o que o cartão não dizia.** `checkInteractions` sempre soube qual remédio DO
  USUÁRIO casou de cada lado; a informação era descartada. Se voltar, **nunca imprimir o rótulo
  cru da base** — imprimir o nome que o usuário cadastrou.
- **`is_critical` era derivado das interações**, e comandava o ⚠️ da Home e a ordem da ficha de
  emergência na tela de bloqueio. Uma feature "só de alerta" tinha um tentáculo na tela mais
  crítica do app. Se voltar, decidir isso de propósito, não por herança.

## Guardas que continuam ativos

`npm run test:interactions` — 4 checagens: alarme falso por token sem identidade, alerta morto,
alerta permanente indevido, e teto de fontes que abrem a bula de outro medicamento.
`npm run test:bulas` — bula errada, e hash duplicado entre slugs.
