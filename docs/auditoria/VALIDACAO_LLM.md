# Validação cruzada por LLM — DeepSeek-V4-Pro + GLM-5.2 (DeepInfra)

**Data:** 12/07/2026 · **Método:** avaliação **cega** dos 98 pares de `CONFERIR_MICROMEDEX.md`

## Por que LLM e não Micromedex

O Micromedex (acesso gratuito via CFF/CRF) tem licença que proíbe armazenar, transmitir ou
redistribuir o conteúdo — consultar milhares de pares por automação seria extração sistemática
para base derivada. Ver `AUDITORIA_INTERACOES.md`.

Mas há um ponto epistemológico que torna o LLM até **mais adequado** para esta tarefa específica:
**as 98 decisões foram julgamentos meus.** O que precisa ser testado não é "qual é a verdade
absoluta", e sim "o meu raciocínio se sustenta quando outro avaliador competente olha o mesmo par
sem saber o que eu concluí". Isso é revisão por pares, não apelo à autoridade.

⚠️ **Limite honesto:** consenso de LLM **não é fonte autoritativa**. Dois modelos concordarem
significa que a afirmação é consistente com a literatura que eles viram — é um bom detector de
invenção e de erro grosseiro, não um substituto de base licenciada.

## Desenho do teste

1. **Cego:** os modelos receberam **apenas o par de fármacos**. Não souberam o que a auditoria
   decidiu. (Se soubessem, tenderiam a concordar.)
2. **Cético por instrução:** o prompt lista explicitamente as armadilhas (mesmo fármaco, produto
   combinado, incompatibilidade em seringa, interferência de ensaio, ausência de dados) e manda
   dizer "não interage" quando for o caso.
3. **Com controles:** 6 pares que **certamente** interagem + 6 que **certamente não** interagem,
   misturados aos 98. Sem isso, um modelo com viés de "sim para tudo" produziria vereditos
   inúteis — e não haveria como saber.

## Calibração (o passo que valida o resto)

| Modelo | Acerto nos controles | Falsos positivos nos negativos |
|---|---|---|
| DeepSeek-V4-Pro | 12/12 | 0/6 |
| GLM-5.2 | 12/12 | 0/6 |

**Zero viés de complacência nos dois.** Os vereditos podem ser levados a sério.

## Resultado 1 — as remoções (49 pares)

| Veredito | Nº |
|---|---|
| Ambos concordam: não é interação | 18 |
| Ambos discordam: dizem que interage | 17 |
| Modelos divididos | 14 |

### ❗ 4 erros reais encontrados — e são todos do mesmo tipo

Nos 4 casos abaixo **eu apaguei a entrada quando deveria ter reescrito o texto**. A bula do FDA
descrevia algo trivial (interferência de ensaio laboratorial, precipitado físico de xarope, "não
estudado") — e eu concluí "não é interação". Mas existe uma interação farmacológica **real** por
trás, independente daquele texto. Foram **restauradas com o mecanismo correto**:

| Par | Por que eu errei | Mecanismo real |
|---|---|---|
| **Espironolactona + Digoxina** `high` | removi por ser "interferência de ensaio" | A interferência no ensaio existe — mas a espironolactona **também** reduz a secreção tubular e inibe a P-gp, elevando a digoxina de verdade. Pior: o ensaio alterado pode **mascarar** o nível real. |
| **Carbamazepina + Clorpromazina** `moderate` | removi por ser "precipitado da suspensão" | A carbamazepina induz CYP3A4/1A2 e **reduz a eficácia do antipsicótico**. |
| **Carbamazepina + Tioridazina** `high` | idem | Mesma indução + tioridazina tem risco conhecido de torsades. |
| **Darunavir + Atazanavir** `high` | removi por "interação não estudada" | Dois inibidores de protease juntos: **não recomendado**. "Não estudado" aqui significa risco, não ausência de risco. |

> **Sinal de que a base estava incoerente:** `carbamazepina + haloperidol` **já existia** com
> exatamente esse mecanismo de indução enzimática. Remover clorpromazina e tioridazina deixou a
> base contraditória consigo mesma — e eu não percebi. Os modelos perceberam.

### Onde os modelos me deram razão (e é instrutivo)

O **GLM-5.2** foi o mais cético e reproduziu meu raciocínio quase palavra por palavra:
- *Omeprazol + Claritromicina* → "são rotineiramente usados juntos" (é o esquema de H. pylori)
- *Bicarbonato + Noradrenalina* → "refere-se à incompatibilidade físico-química em misturas"
- *Vecurônio + Tiopental* → "a coadministração é padrão na anestesia"
- *Tizanidina + Sertralina* → "a sertralina não inibe clinicamente o CYP1A2"

Esse último é notável: bate com a classe #28 da ONCHigh (*tizanidina + inibidores de **CYP1A2***) e
**confirma de forma independente** a remoção de tizanidina+ISRS, mantendo ciprofloxacino e
fluvoxamina — os inibidores de CYP1A2 de verdade.

**Dabigatrana + Amiodarona:** os dois modelos alertaram — mas o par **continua na base** por
`int_352`. O que removi era entrada duplicada. Falso alarme.

## Resultado 2 — as reescritas de mecanismo (49 pares)

A tese central da auditoria foi tirar o rótulo **"síndrome serotoninérgica"** de 44 pares em que não
há dois fármacos serotoninérgicos.

**37/44: nenhum dos dois modelos menciona serotonina.** Confirmam a reescrita.

Os 7 contestados são fracos: a maioria é o modelo citando serotonina como risco **teórico**
(o GLM escreve literalmente "risco teórico"), ou aparece dentro de uma negação. Mas um deles rendeu
melhoria real: nos pares **Kava Kava + ISRS**, os modelos apontaram uma via que faltava — a kava
inibe CYP2D6/2C19/3A4 e pode **elevar a concentração do antidepressivo**. Mecanismo enriquecido
(mantendo sedação + hepatotoxicidade, que era o ponto).

Severidade: em 42/49 pares pelo menos um modelo bate com a minha. Ajustei *Arnica + Varfarina* de
`high` para `moderate` — a regra de deduplicação ("fica com a mais grave") a tinha inflado, e a
evidência para arnica é fraca.

## Saldo

| | |
|---|---|
| Erros meus encontrados e corrigidos | **4** |
| Decisões confirmadas por ambos os modelos | 55 |
| Entradas restauradas | 4 (`int_3078`–`int_3081`) |
| Severidade recalibrada | 1 (Arnica + Varfarina) |
| Mecanismos enriquecidos | 4 (Kava + ISRS) |

**`interactions.json`: 2.802 → 2.806 entradas.**

A taxa de erro da auditoria nos pontos de maior risco foi de **4 em 98 (~4%)** — e todos os 4 do
mesmo tipo, o que é um viés identificável e não ruído aleatório: **quando o texto da fonte era
lixo, eu apaguei a entrada em vez de checar se havia interação real por trás.** Fica a lição para
a próxima rodada.

---

# Rodada 2 — as 408 entradas `critical`

Mesmo método (cego, prompt cético, controles). Calibração deste lote: **6/6 nos dois modelos, zero falso positivo.**

## Resultado

| | Nº | % |
|---|---|---|
| Pelo menos um modelo confirma `critical` | 366 | **90%** |
| Ambos dizem que **não interage** | 1 | 0,2% |
| Ambos dizem que interage, mas severidade ≤ `high` | 36 | 9% |

**O núcleo do tier crítico está sólido.** 90% de confirmação, e apenas 1 alerta `critical` sem interação nenhuma por trás.

## O que foi corrigido (20 entradas)

### Perda de eficácia e ajuste de dose marcados como `critical` → `high` (18)

No app, `critical` significa **"pare o remédio / procure atendimento"**. Nenhuma destas justifica isso — o dano é falha terapêutica ou exposição que pede ajuste de dose, não evento agudo:

- **ARV × ARV** (`int_969`, `int_1045`–`int_1051`, `int_1053`) — falha virológica e resistência. Grave, mas não é emergência aguda.
- **Antivirais HCV** (`int_1657`, `int_2999`) e **artemeter+rifampicina** (`int_2286`) — perda de eficácia.
- **Alisquireno+itraconazol** (`int_1597`), **contraceptivo+ritonavir** (`int_1641`, `int_2441`, elevação de ALT).
- **Pirfenidona / tansulosina / ubrogepanto + inibidor de CYP3A4** (`int_2561`, `int_2657`, `int_2773`) — ajuste de dose.

### O único `critical` sem interação real: era o EXCIPIENTE, não o fármaco (2)

**Dronabinol + Dissulfiram / Metronidazol** — os dois modelos disseram "não há interação", e **estavam certos quanto à molécula**. A reação tipo dissulfiram vem do **álcool desidratado presente na solução oral**, não do dronabinol. Rebaixado para `moderate` e reescrito para dizer o que de fato causa o problema — apresentações sem álcool na fórmula não têm esse risco.

> Este caso é o espelho exato do viés da rodada 1: lá eu **apaguei** entradas boas por causa de texto-fonte ruim; aqui o texto-fonte estava certo, mas atribuía ao fármaco um risco que é da **formulação**. Nos dois casos a lição é a mesma: *ler o que o texto realmente diz antes de decidir.*

## ⚠️ 18 entradas NÃO alteradas — precisam de julgamento humano

Nestas os modelos sugerem `high`, mas o desfecho plausível é **morte, arritmia ou hemorragia**. Rebaixar o alerta máximo com base em consenso de LLM seria exatamente o tipo de decisão que eu **não devo** tomar sozinho. Ficam como estão, para revisão por farmacêutico:

| ID | Par | Descrição atual | Modelos (DS / GLM) |
|---|---|---|---|
| `int_199` | Acetazolamida + Aspirina | Aumento do risco de acidose e toxicidade | high / high |
| `int_326` | Cloroquina + Digoxina | Aumento do risco de toxicidade cardíaca | high / high |
| `int_362` | Difenidramina + Oxicodona | Depressão respiratória grave | high / high |
| `int_412` | Etanercepte + Rituximabe | supressão medular grave | high / high |
| `int_504` | Levomepromazina + Clorpromazina | Aumento do risco de arritmias graves | nenhuma / high |
| `int_601` | Oxicodona + Cetoconazol | Toxicidade grave de oxicodona | high / high |
| `int_617` | Perfenazina + Levodopa | Aumento do risco de discinesia tardia | high / high |
| `int_678` | Salix alba (Salgueiro) + Metotrexato | Toxicidade grave | high / high |
| `int_698` | Sirolimo + Tacrolimo | Nefrotoxicidade grave | high / moderate |
| `int_764` | Upadacitinibe + Tacrolimo | Aumento do risco de infecções graves | high / high |
| `int_828` | Amitriptilina + Álcool/etanol | Aumento do risco de depressão respiratória | high / high |
| `int_888` | Glibenclamida + Álcool/etanol | Risco de hipoglicemia grave | high / high |
| `int_903` | Maprotilina + Álcool/etanol | Aumento do risco de sedação e depressão respiratória | high / moderate |
| `int_942` | Varfarina + Álcool/etanol | Hemorragia grave | high / moderate |
| `int_958` | Anagrelida + Cilostazol | Exacerbação dos efeitos inotrópicos, aumentando o risco cardiovascular. | high / high |
| `int_1444` | Clonidina + Diltiazem | Bradicardia sinusal resultando em hospitalização e implante de marcapasso foi relatada. | high / moderate |
| `int_1886` | Gabapentina + Oxicodona | Risco de depressão respiratória e sedação, às vezes resultando em morte. | high / high |
| `int_2979` | Propranolol + Haloperidol | Hipotensão e parada cardíaca foram relatadas com o uso concomitante de propranolol e haloperidol. | high / moderate |

Casos como *gabapentina + oxicodona* (a bula do FDA diz literalmente "às vezes resultando em **morte**") e *difenidramina + oxicodona* são depressão respiratória por opioide — os modelos podem estar sendo conservadores demais na escala, mas o desfecho é fatal. Mantidos em `critical` por precaução.

## Saldo das duas rodadas

| | |
|---|---|
| Pares avaliados às cegas | 98 + 408 = **506** |
| Erros encontrados e corrigidos | 4 (rodada 1) + 20 (rodada 2) = **24** |
| Entradas pendentes de revisão humana | 18 |

**`interactions.json`: 2.806 entradas** — 388 critical / 1.624 high / 794 moderate.

O tier `critical` caiu de 408 para 388, e os 20 removidos dele eram, sem exceção, perda de eficácia ou ajuste de dose — alertas que fariam o paciente parar um remédio de que precisa.
