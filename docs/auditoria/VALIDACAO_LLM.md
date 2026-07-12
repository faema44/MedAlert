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
