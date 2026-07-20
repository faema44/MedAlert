# Relatório da varredura noturna — 20/07/2026

Três frentes pedidas: bulas, interações e navegação. **Nada foi publicado e nenhum nível de
risco foi alterado.** As decisões que dependem de você estão marcadas com ❓.

---

## 1. Bulas — o card corresponde ao PDF?

O gate existente (`test:bulas`) verifica **qual fármaco** a bula é e se dois slugs servem o mesmo
arquivo. Ele nunca verificou **forma farmacêutica** — e forma não existe no nome do fármaco, só
dentro do PDF. Foi assim que a dexametasona serviu creme para quem toma comprimido.

Com o seletor de forma isso mudou de tamanho: agora o app **promete uma forma na tela**. Criei
`npm run test:bula-forma` para conferir as 155 bulas com forma no nome.

### 1a. Sete rótulos de forma imprecisos

O medicamento e a via estão **certos** nos sete. O que está errado é o nome da forma:

| arquivo | o app promete | o PDF é |
|---|---|---|
| `cetirizina-suspensao.pdf` | Suspensão oral | **Solução oral** |
| `dipirona-suspensao.pdf` | Suspensão oral | **Solução oral** |
| `hidroxizina-suspensao.pdf` | Suspensão oral | **Solução oral** |
| `risperidona-suspensao.pdf` | Suspensão oral | **Solução oral** |
| `dexametasona-xarope.pdf` | Xarope | **Elixir** |
| `betametasona-xarope.pdf` | Xarope | **Elixir** |
| `acetilcisteina-po.pdf` | Pó para solução/suspensão | **Granulado** |

Risco clínico baixo (é tudo líquido oral, ou sólido oral para dissolver), mas o app afirma uma
coisa e o documento diz outra — e quem confere o que tem na mão vai estranhar.

❓ **Pergunta 1:** renomear os arquivos e o manifesto para a forma real (`-solucao-oral`,
`-elixir`, `-granulado`, com rótulos novos em `FORMA_INFO`), ou alargar os rótulos existentes
(ex.: "Suspensão oral" → "Líquido oral") para caber a variação? A primeira é mais correta e mexe
em 7 arquivos publicados; a segunda é de uma linha e menos exata.

### 1b. Combinados: um achado real, dois falsos positivos

Criei `npm run test:bula-combo`, que usa o `getBulaUrl` **de verdade** (transpilado do
`drugSearch.ts`) e confere se o PDF cita todos os ativos. Dos 188 combinados: 101 com PDF
completo, 84 sem PDF (backlog conhecido), 3 acusados:

- ✅ **`acido-folico-sulfato-ferroso.pdf` — ACHADO REAL.** O PDF é do *Neutrofer Fólico*, que é
  **glicinato férrico** + ácido fólico. **Não é sulfato ferroso.** Sal de ferro diferente é
  produto diferente (tolerância e absorção não são as mesmas) — é o mesmo princípio que separa
  benzilpenicilina benzatina da potássica.
- ❌ `amlodipino-olmesartana.pdf` — falso positivo. A bula escreve "besilato de **an**lodipino",
  grafia DCB oficial. Bula correta.
- ❌ `emtricitabina-tenofovir.pdf` — falso positivo. É o Truvada certo; o **próprio PDF** tem o
  typo "**en**tricitabina".

❓ **Pergunta 2:** para o ferro, baixo a bula certa do sulfato ferroso + ácido fólico, ou o
registro na base deveria virar "Glicinato Férrico + Ácido Fólico" (se for esse o produto que
você quis cadastrar)?

❓ **Pergunta 3:** adiciono "anlodipino ↔ amlodipino" à lista de sinônimos do auditor? É variação
DCB legítima. O typo "entricitabina" **não** entra — sinônimo de typo esconderia bula errada.

---

## 2. Interações — classificação das 17 de sangramento

Consultei o **openFDA** (a única fonte com acesso programático permitido, como já fazíamos).
Critério determinístico e sem LLM: **onde** a bula americana cita o par. Ferramenta nova:
`node tools/classificar-sangramento-fda.js`.

> **Erro meu que quase virou conclusão errada:** a primeira rodada procurou o **nome** do fármaco
> e devolveu "não citado" para 11 dos 17 — inclusive Enoxaparina + Ibuprofeno. Falso negativo: a
> bula do FDA cita **classe**, não nome. O boxed warning da enoxaparina fala de "NSAIDs", nunca
> de "ibuprofen". Refeito com termos de classe, o quadro virou.

| evidência | pares |
|---|---|
| **boxed warning** (o aviso mais forte que existe) | `int_202` AAS + Ibuprofeno · `int_397` Enoxaparina + Ibuprofeno · `int_446` Fondaparinux + Aspirina · `int_634` Prasugrel + Varfarina |
| **warnings and cautions** | `int_725` Ticagrelor + Dabigatrana · `int_774` Varfarina + Cefazolina |
| **drug interactions** (menção comum) | `int_353` Dalteparina + Itraconazol · `int_463` Griseofulvina + Varfarina · `int_465` Heparina + Ticlopidina · `int_594` Omeprazol + Cilostazol |
| **não citado** | `int_595` Omeprazol + Dabigatrana · `int_596` Omeprazol + Rivaroxabana · `int_775` Varfarina + Ceftriaxona · `int_886` Fluoxetina + Álcool · `int_915` Nadroparina + Álcool |
| **não citado — mas o FDA não cobre** | `int_116` Arnica + Varfarina · `int_211` Alho + Aspirina (fitoterápicos/suplementos não têm bula no openFDA; aqui "não citado" não significa nada) |

Duas observações sobre a tabela:

- `int_774` (cefazolina) aparece em *warnings* e `int_775` (ceftriaxona) não aparece, sendo as
  duas cefalosporinas. A assimetria é de qual bula menciona a classe, não de farmacologia.
- Os quatro de **boxed warning** são exatamente os que eu tinha sinalizado por leitura do
  mecanismo ("atacando a coagulação por frentes diferentes"). A evidência independente bateu com
  a suspeita.

❓ **Pergunta 4:** subo os 4 de boxed warning para `high`? E os 2 de *warnings and cautions*?
Minha recomendação: **sim para os 4** (boxed warning é o critério mais forte e objetivo que temos)
e **sim para os 2**, mantendo `moderate` nos de *drug interactions*. Os "não citado" ficam como
estão até haver fonte.

❓ **Pergunta 5:** os 5 "não citado" que **não** são fitoterápicos (`int_595`, `int_596`, `int_775`,
`int_886`, `int_915`) entram na lista do Micromedex para você conferir com a credencial do CRF?

---

## 3. Navegação — o "do nada volta para o Início"

**Reproduzido por inteiro, e não é aleatório.** São *dois* defeitos independentes que se somam:

### 3a. Os modais engolem o botão voltar

`Modal` do React Native sem `onRequestClose` **ignora o botão voltar do Android**. Está assim em:

- `AgendaScreen` — **as três** modais (medição, atividade, consulta)
- `MedicationsScreen` — a modal do **wizard**, a principal do app (a de ajuda do estoque tem)

Verificado no emulador: com a modal "Nova Atividade" aberta, apertei voltar 3× e **nada
aconteceu**. Hoje mais cedo eu fiquei preso no wizard de remédio e precisei matar o app.

### 3b. O voltar sai da aba direto para o Início

O `Tab.Navigator` (App.tsx:566) **não define `backBehavior`**, então vale o padrão `firstRoute`:
o voltar do Android leva de qualquer aba para a primeira. Some com 3a e dá exatamente o que você
viu:

```
Atividades → abre modal → voltar (nada) → voltar (nada)
           → toca "Cancelar" → voltar → PULA PARA O INÍCIO
```

Da sua cadeira parece aleatório, porque os dois primeiros toques não fizeram nada.

Isso também explica algo que eu vivi hoje sem reconhecer: voltar da **Lista de compras** e das
**Tabelas** me jogou no Início, quando o esperado era Configurações. Toda tela oculta
(Backup, Tabelas, Lista de compras, Cuidador, Perfil…) é uma aba, então todas sofrem disso.

❓ **Pergunta 6:** qual comportamento você quer para o voltar?
- **`history`** (recomendo) — volta para a tela anterior de verdade. Conserta Lista de compras →
  Configurações e Atividades → onde você estava. Custo: o voltar demora mais para sair do app.
- **`none`** — o voltar sai do app direto. Previsível, mas perde a navegação para trás.
- Manter `firstRoute` e só consertar as modais.

❓ **Pergunta 7:** com o `onRequestClose` nas modais, o voltar dentro do **wizard de remédio**
deve *fechar tudo* (perdendo o que foi preenchido) ou *voltar um passo*, igual ao botão
"‹ Voltar"? Acho que voltar um passo é o certo, mas é mudança de comportamento e prefiro
perguntar.

---

## O que já está feito e commitado

- 56 descrições de interação reescritas (commit `863ed88`, **não enviado** — você pediu para ler
  antes; a lista agrupada está no histórico da conversa).
- Base reassinada. **Sem reassinar, o app rejeita os dados em silêncio** — o gate de assinatura
  pegou isso.
- Três ferramentas novas: `test:bula-forma`, `test:bula-combo` e
  `classificar-sangramento-fda.js`.

## O que NÃO fiz de propósito

- Não publiquei nada (`publish:data` não rodou) nem dei push.
- Não mexi em nenhum `risk_level`.
- Não mexi na navegação nem nas modais.
- Não renomeei bula nenhuma.
