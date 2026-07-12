# Auditoria clínica — `src/data/interactions.json`

**Data:** 12/07/2026 · **Base auditada:** 3.063 entradas (439 critical / 1.741 high / 883 moderate)
**Escopo:** verificar se o medicamento A realmente interage com o medicamento B, e se essa interação é prejudicial ao paciente.

## ✅ STATUS: CORREÇÕES APLICADAS

`src/data/interactions.json`: **3.063 → 2.802 entradas** (261 removidas, 46 mecanismos reescritos, 9 severidades recalibradas, 8 nomes normalizados).
Backup do estado anterior: `src/data/interactions.json.bak-preaudit`.

| Ação | Qtd |
|------|-----|
| Classe 1 — contaminação (bula de combo → 1 ingrediente): **removidas** | 116 |
| Classe 2 — não é interação: **removidas** | 28 |
| Classe 4 — o texto nega a própria interação: **removidas** | 21 |
| Classe 3 — mecanismo/severidade **reescritos** | 46 |
| Classe 5 — duplicatas por grafia: **removidas** (2 com severidade reconciliada p/ a mais grave) | 95 |
| Classe 6a — perda de eficácia `critical` → `high` | 9 |
| Nomes em inglês/typo normalizados (`Warfarina`→`Varfarina`, `Ketoconazol`→`Cetoconazol`…) | 8 |
| Cerivastatina (retirada do mercado mundial em 2001) removida | 1 |

**Distribuição final:** 408 critical / 1.604 high / 790 moderate · 769 fármacos distintos.

**Validação pós-correção:** schema íntegro, IDs únicos, 0 pares duplicados, 0 contaminação residual, `tsc --noEmit` limpo, e as interações-sentinela clássicas preservadas (varfarina+AINE, sildenafila+nitrato, metformina+contraste, digoxina+amiodarona, sinvastatina+claritromicina, lítio+tiazídico, alopurinol+azatioprina).

### Validação cruzada com fonte externa independente

**drugs.com não pôde ser usado:** os [Termos de Uso](https://www.drugs.com/support/terms.html) proíbem explicitamente acesso automatizado, scraping e a criação de datasets derivados do site — inclusive para pesquisa — sem consentimento por escrito. A [API de interações do NLM/RxNav](https://lhncbc.nlm.nih.gov/RxNav/APIs/InteractionAPIs.html) **foi descontinuada em 02/01/2024**, então também não serve.

Usei duas fontes abertas, publicadas e de uso permitido — que são, aliás, as mesmas que alimentavam o RxNav:

**1. ONCHigh** — [Phansalkar et al., JAMIA 2012;19(5):735-43](https://pmc.ncbi.nlm.nih.gov/articles/PMC3422823/): lista de consenso, patrocinada pelo ONC, das interações "contraindicadas / sempre alertar". **Teste de cobertura (detecta falsos negativos introduzidos pelas remoções): 13/13 ✅**

| Classe ONCHigh | Coberta por |
|---|---|
| Anfetaminas/simpaticomiméticos + IMAO | `int_003` critical |
| Atazanavir + IBP | `int_1559` high |
| Febuxostate/alopurinol + azatioprina | `int_217` critical |
| ISRS + IMAO | `int_406` critical |
| Irinotecano + inibidor CYP3A4 | `int_1396` critical |
| Opioide + IMAO | `int_007` critical |
| Tricíclico + IMAO | `int_229` critical |
| QT + QT | `int_068` critical |
| Indutor CYP3A4 + inibidor de protease | `int_138` critical |
| Estatina + inibidor CYP3A4 | `int_012` high |
| Inibidor CYP3A4 + ergotamínico | `int_307` critical |
| Tizanidina + inibidor CYP1A2 | `int_2707` critical |
| Triptano + IMAO | `int_008` critical |

(#22 Ramelteona e #30 Procarbazina omitidos — não comercializados no Brasil.)

> A classe **#28 valida independentemente uma decisão desta auditoria**: a ONCHigh especifica tizanidina + **inibidores de CYP1A2**. A base manteve ciprofloxacino e fluvoxamina (os reais) e removeu fluoxetina/paroxetina/sertralina, que são inibidores de **CYP2D6**, não de CYP1A2.

**2. CredibleMeds QTdrugs** — [lista combinada publicada](https://cdn-links.lww.com/permalink/jcp/a/jcp_37_5_2017_06_27_vandael_jcp50428_sdc1.pdf). Confirma as reescritas da Classe 3: **Pimozida (Known Risk)** e **Tioridazina (Known Risk)** de torsades de pointes — ou seja, o mecanismo correto desses pares é mesmo QT, e não "síndrome serotoninérgica". A lista também refinou 3 entradas: reboxetina **não** é droga de QT (o risco vem da pimozida/tioridazina, não é efeito "aditivo"), e clorpromazina (Known Risk) + metoclopramida (Conditional Risk) têm, além do extrapiramidal, um componente real de QT — hoje declarado em `int_328`.

### ⚠️ Pendência deixada de propósito — Classe 6b

83 entradas têm `risk_level: moderate` mas a `risk_description` diz "grave"/"fatal". **Não alterei automaticamente.** Nesses textos vindos do FDA, "grave" costuma ser frase enlatada ("Imunossupressão grave", "Nefrotoxicidade grave") e não um juízo de severidade — subir todas para `high` inflaria o alarme falso, o oposto do objetivo desta auditoria. A correção certa é revisar a **redação**, não o nível. Lista completa em [REVISAR_REDACAO_MODERATE.md](REVISAR_REDACAO_MODERATE.md).

---

## Diagnóstico original (mantido como registro)

---

## Resumo

A maior parte da base é clinicamente sólida (os pares clássicos — varfarina+AINE, IMAO+serotoninérgico, estatina+azol, digoxina+amiodarona, lítio+tiazídico — estão corretos). Os problemas se concentram no lote importado do FDA (round 2, `int_1355`+) e em um bloco antigo de rótulos de mecanismo copiados errado.

Encontrei **~260 entradas com defeito**, em 6 classes. Duas delas são *perigosas de verdade* — não por gerarem alarme falso, mas por afirmarem fatos farmacológicos incorretos que um paciente pode seguir.

| # | Classe | Entradas | Gravidade |
|---|--------|----------|-----------|
| 1 | Texto descreve **outro fármaco** (contaminação do merge FDA) | ~40 | 🔴 Crítica |
| 2 | Pares que **não interagem** / são a mesma coisa / são co-prescrição intencional | ~25 | 🔴 Crítica |
| 3 | "Síndrome serotoninérgica" em pares **sem 2 fármacos serotoninérgicos** | ~45 | 🟠 Alta |
| 4 | Texto **nega a própria interação** ("não houve alteração", "significado desconhecido") | ~57 | 🟠 Alta |
| 5 | Duplicatas por variante de nome (risco às vezes divergente) | ~93 removíveis | 🟡 Média |
| 6 | Severidade descalibrada / não acionável em app de paciente | ~30 | 🟡 Média |

---

## 1. 🔴 Contaminação: o texto descreve um fármaco que não está no par

Origem: fuzzy-match em **produtos combinados** — a bula do combo foi atribuída a só um dos componentes. O app vai alertar um paciente sobre um risco que o medicamento dele **não tem**.

- **Ezetimiba + [cetoconazol, claritromicina, eritromicina, itraconazol, telitromicina, voriconazol, genfibrozila, ciclosporina, verapamil, diltiazem, dronedarona, amiodarona, anlodipino, daptomicina, colchicina…]** — `int_1810`–`int_1827` (18 entradas, várias **critical**).
  O texto diz literalmente *"devido à redução da eliminação do componente **sinvastatina**"*. É a bula do **Vytorin (ezetimiba+sinvastatina)**. Ezetimiba pura praticamente **não tem** risco de rabdomiólise com inibidores de CYP3A4. Hoje um paciente em ezetimiba isolada + claritromicina recebe alerta **crítico falso**.
- **Magnésio + [atazanavir, varfarina, clopidogrel, claritromicina, metotrexato, tacrolimo…]** — `int_2236`–`int_2251` (~16). O texto fala de *"exposição ao **esomeprazol**"*. É **esomeprazol magnésio**. Quem toma **suplemento de magnésio** vai receber alerta crítico de arritmia fatal.
- **Misoprostol + [varfarina, AAS, digoxina, lítio, metotrexato, ciclosporina, pemetrexede, voriconazol, rifampicina]** — `int_2328`–`int_2336` (9). O texto cita *"toxicidade do **diclofenaco**"*. É o **Arthrotec (diclofenaco+misoprostol)**. Misoprostol é **gastroprotetor** — atribuir a ele risco de hemorragia digestiva é o inverso da verdade.
- **Dutasterida + [cetoconazol, paroxetina, cimetidina, varfarina]** — `int_1644`–`int_1647`. Texto = *"exposição à **tansulosina**"* (combo Jalyn).
- **Alogliptina + [cimetidina, dolutegravir, vandetanibe]** — `int_1648`–`int_1650`. Texto = *"exposição à **metformina** e risco de acidose láctica"* (combo Kazano).
- **Vonoprazana + [omeprazol, itraconazol, ritonavir…]** — `int_2894`–`int_2914`. Texto = *"concentrações de **claritromicina**"* (pack triplo H. pylori). `int_2895` "Vonoprazana + Omeprazol → aumenta claritromicina" não faz sentido nenhum.
- **Umeclidínio + Cetoconazol** (`int_2784`) — texto = *"exposição sistêmica ao **vilanterol**"*.
- **Salmeterol + Cetoconazol/Ritonavir** (`int_2626`/`int_2627`) — texto = *"efeitos adversos sistêmicos de **corticosteroides**"* (bula do Seretide).

### Vitaminas — bloco inteiro trocado (o mais grave)

- **Vitamina A + Varfarina** (`int_2852`, high) → *"**Vitamina K** antagoniza a ação anticoagulante da varfarina"*. **Vitamina A não antagoniza varfarina. Vitamina K sim.** Idem `int_2890` (Complexo B + Varfarina) — complexo B **não contém vitamina K**.
- **Vitamina A / Complexo B / Betacaroteno / Cianocobalamina / Manganês + [Fenitoína, Metotrexato]** — `int_2850`, `int_2851`, `int_2888`, `int_2889`, `int_3008`, `int_3009`, `int_1409`, `int_1410`, `int_2252` → todos dizem *"**ácido fólico** pode diminuir…"*.
- **Ferro + AAS / Clopidogrel / Heparina** (`int_1845`–`int_1847`, high) → *"sangramento devido à interação da **piridoxina** com anticoagulantes"*. **Ferro não aumenta sangramento.**
- **Hesperidina / Vitamina C + AAS / Varfarina** (`int_1962`, `int_1963`, `int_2855`, `int_2856`) → *"quando combinado com **Bromelain**"*.
- **Zinco + AAS / Varfarina** (`int_2934`/`int_2935`, high) — zinco não causa sangramento.

---

## 2. 🔴 Pares que não são interação

| ID | Par | Problema |
|----|-----|----------|
| `int_784` | **Vitamina D + Colecalciferol** — *"Hipercalemia grave"* | Colecalciferol **é** a vitamina D3. É o mesmo fármaco. E o risco da vit. D é hiperCALCEMIA, não hiperCALEMIA (potássio). Erro duplo. |
| `int_1070` | **Lamivudina + Zidovudina** — *"evitar, antagonismo in vitro"* | ❗ É a **combinação fixa Biovir/Combivir**, pilar do tratamento de HIV, co-prescrita de propósito no mundo inteiro. Dizer "evitar" é perigoso. O antagonismo in vitro descrito é de **estavudina**+zidovudina. |
| `int_514` | **Lítio + Metformina** — *"acidose láctica"*, **critical** | Não existe interação lítio↔metformina estabelecida. Parece fabricada. Lítio interage com diurético/AINE/IECA; acidose lática da metformina é dirigida por insuficiência renal. |
| `int_1734` | **Esomeprazol + Claritromicina** — *"contraindicado, arritmias fatais"*, **critical** | É o **esquema padrão de erradicação de H. pylori**. São prescritos juntos de propósito. Idem `int_2114` (lansoprazol), `int_2245` (magnésio). |
| `int_2485` | **Omeprazol + Amoxicilina** — high | Co-prescrição intencional (H. pylori). Idem `int_1735`, `int_2115`, `int_2246`. |
| `int_3019` | **Betametasona + Hidrocortisona** | Texto: *"anfotericina B e hidrocortisona"*. Dois corticoides entre si; entrada quebrada. |
| `int_1337` | **Lopinavir + Ritonavir** | É **um único produto** (Kaletra) — ritonavir é o booster intencional. Idem `int_972` (atazanavir+ritonavir), `int_1297` (fosamprenavir+ritonavir). |
| `int_2313` | **Metotrexato + Ácido Fólico** — high | Em **reumatologia o ácido fólico é co-prescrito de propósito** com MTX para reduzir toxicidade — padrão de cuidado. A perda de eficácia só vale para MTX oncológico em alta dose. Alarme falso para todo paciente de AR. |
| `int_1133` | **Rufinamida + Topiramato** | O próprio texto diz: *"**Não há** efeito significativo… nenhuma interação clinicamente relevante"* — e está cadastrado como risco **moderate**. |
| `int_063` | **Fluconazol + Losartana** | Mecanismo **invertido**: fluconazol inibe CYP2C9 → **menos** metabólito ativo → **menos** efeito anti-hipertensivo → risco de **hipertensão**. A entrada diz "hipotensão". |
| `int_1742`/`int_1746` | **Espironolactona + Digoxina** | É **interferência no ensaio laboratorial** de digoxina, não interação clínica. |
| `int_1272`/`int_1273` | **Carbamazepina + Clorpromazina/Tioridazina** | *"Formação de precipitado laranja borrachento… como suspensão"* — incompatibilidade física de xarope, não farmacologia. |
| `int_1375`/`int_1376`/`int_3021`/`int_3022`/`int_3035` | Ceftriaxona+Fluconazol, Bicarbonato+Noradrenalina etc. | **Incompatibilidade em seringa/soro IV** — irrelevante para lista de medicamentos de paciente. |
| `int_1417`/`int_1418` | **Cilastatina** + Ganciclovir / Valproato | A convulsão e a queda do valproato são causadas pelo **imipeném**; cilastatina é só o inibidor de desidropeptidase, sem ação no SNC. Idem `int_2663`–`int_2666` (**Tazobactam** levando o crédito das interações da **piperacilina**). |

---

## 3. 🟠 "Síndrome serotoninérgica" onde não há dois fármacos serotoninérgicos

O rótulo está farmacologicamente errado. Em vários casos **existe** interação — mas por outro mecanismo, e a conduta que o paciente deveria tomar é diferente.

- **Benzodiazepínico + ISRS:** `int_218`, `int_219` (alprazolam), `int_310`–`int_314` (clobazam). Benzo **não tem** atividade serotoninérgica. A interação real é PK (CYP3A4/2C19 → ↑benzo → sedação).
- **Antipsicótico + ISRS:** `int_242`, `int_244`, `int_245`, `int_246` (aripiprazol), `int_593` (olanzapina), `int_333`, `int_334` (clozapina).
  ⚠️ **Olanzapina+fluoxetina é uma combinação fixa comercializada (Symbyax)** e aripiprazol+ISRS é **potencialização padrão em depressão**. A interação real é CYP2D6/1A2 (ajuste de dose), não síndrome serotoninérgica.
- **Prolongamento de QT rotulado como serotoninérgico:** `int_304`, `int_317`, `int_318`, `int_389`, `int_390`, `int_440`, `int_657`, `int_658`, `int_671`, `int_683`, `int_778`, `int_779` (todos com pimozida/tioridazina). O risco real é **torsades de pointes** — e `int_1036` descreve o *mesmo par* (escitalopram+pimozida) corretamente como QT. Contradição interna.
- **Antagonista dopaminérgico:** `int_328` (clorpromazina+metoclopramida, **critical**) — o risco real é **extrapiramidal / síndrome neuroléptica maligna**, mecanismo oposto.
- **Antipsicótico + lítio:** `int_438` (flufenazina+lítio) — o risco real é **neurotoxicidade**.
- **Buspirona + azol:** `int_273`, `int_274`, `int_275` — interação puramente PK (↑buspirona → tontura/sedação).
- **Tizanidina + ISRS:** `int_734`–`int_736` — tizanidina é agonista α2, não serotoninérgica. E fluoxetina/paroxetina/sertralina **não** são inibidores potentes de CYP1A2 (os reais, ciprofloxacino e fluvoxamina, já estão certos em `int_2707`/`int_2708`).
- **Álcool + antidepressivo:** `int_858`, `int_871`, `int_878`, `int_880`, `int_887`, `int_930`, `int_943`. Álcool **não causa** síndrome serotoninérgica; o risco é depressão do SNC.
- **`int_883` — Fenitoína + Álcool: *"Síndrome serotoninérgica e convulsão"*.** Fenitoína não tem nenhuma ação serotoninérgica.
- **`int_1415` — Ciclobenzaprina + Verapamil: *"mecanismo serotoninérgico aditivo"*.** Verapamil é bloqueador de canal de cálcio. Sem sentido.
- **Kava Kava + ISRS:** `int_622`–`int_625` — kava é GABAérgica; risco real é sedação + hepatotoxicidade.
- **`int_372` — Dissulfiram + Metronidazol:** interação **real**, mas é **reação psicótica/confusional**, não serotoninérgica. O mesmo par aparece correto em `int_2317` — com risco divergente (high vs critical).

> ✅ **Não são erro** (checagem automática deu falso-positivo): ISRS/IRSN + AAS (`int_1027`, `int_1059`, `int_1084`, `int_1140`, `int_1167`) — a serotonina plaquetária é mencionada corretamente; são interações legítimas de sangramento.

---

## 4. 🟠 O texto nega a própria interação (~57 entradas)

Cadastradas como risco, mas a bula diz que **não há** efeito relevante:

- `int_1133` Rufinamida+Topiramato — *"nenhuma interação clinicamente relevante"*
- `int_1519`–`int_1523` Desloratadina + azitro/cetoconazol/eritro/fluoxetina/cimetidina — *"sem alterações clinicamente relevantes no perfil de segurança"* (5 entradas)
- `int_2327` Mirabegrona+Varfarina — *"sem alteração significativa nos parâmetros farmacodinâmicos"*
- `int_1009` Dabigatrana+Amiodarona — *"não requer ajuste de dose"*
- `int_2722` Tolcapona+Varfarina — *"a interação clínica parece improvável"*
- `int_1136`/`int_1137` Sertralina+Fenitoína/Valproato — *"não mostrou inibição clinicamente importante"* / *"não avaliado"*
- `int_1647` Dutasterida+Varfarina — *"não houve alteração na farmacocinética da varfarina"*
- `int_1187` Darunavir+Atazanavir, `int_1232` Nevirapina+Ritonavir — *"não estudada / não avaliado"*
- `int_1478` Ropivacaína+Amiodarona — *"não foram realizados estudos específicos"*
- `int_2392`/`int_2412` Nifedipina+Flecainida — *"experiência insuficiente"* (ausência de dado ≠ risco)
- `int_1947`/`int_1948` Granisetrona + cetoconazol/fenobarbital — *"significado clínico desconhecido"*

Lista completa reproduzível com o filtro de regex de negação (57 IDs).

---

## 5. 🟡 Duplicatas por variante de nome (93 entradas removíveis)

O mesmo par cadastrado 2× com grafias diferentes — em 7 casos **com risco divergente**, o que faz o app mostrar gravidades diferentes para a mesma combinação:

| Par | Conflito |
|-----|----------|
| AAS + Metotrexato | `int_198` critical **vs** `int_1370` high |
| Celecoxibe + Metotrexato | `int_285` moderate **vs** `int_1379` high |
| Dissulfiram + Metronidazol | `int_372` high **vs** `int_2317` critical |
| Indometacina + Metotrexato | `int_489` critical **vs** `int_1997` high |
| Piroxicam + Metotrexato | `int_628` critical **vs** `int_2568` high |
| Infliximabe + Tocilizumabe | `int_740` critical **vs** `int_2002` high |
| Abatacepte + Infliximabe | `int_2000` critical **vs** `int_2001` high |

Blocos duplicados inteiros por grafia: **Nifedipina/Nifedipino** (`int_2380`–`int_2397` ≡ `int_2398`–`int_2417`, ~19 pares), **Metoprolol/Metoprolol Succinato**, **Espironolactona/Espironolactona (acne)**, **Orlistat/Orlistate**, **Colchicina/Colchicina (gota)**, **Alendronato/Alendronato de Sódio**, **Atracúrio/Besilato de Atracúrio**, **Ropivacaína/Cloridrato de Ropivacaína**, **Pioglitazona/Cloridrato de Pioglitazona**, **Benazepril/Cloridrato de Benazepril**, **Olmesartana/Olmesartana medoxomila**, **Doxiciclina/Doxiciclina (acne)**, **Rizatriptano/Rizatriptana**, **Vitamina D3/Colecalciferol**, **Metronidazol/Metronidazol (antiparasitário)**.

---

## 6. 🟡 Severidade descalibrada

- **Perda de eficácia marcada como `critical`** (não há dano agudo): `int_2389`–`int_2391` e `int_2407`–`int_2411` (Nifedipina + carbamazepina/fenitoína/fenobarbital/rifampicina/hipérico), `int_1605` (Diltiazem+Rifampicina), `int_961`/`int_993` (Anastrozol+Tamoxifeno — é ausência de benefício, não toxicidade).
- **`critical` + "Contraindicado" onde é só cautela:** `int_039` (Amiodarona+Fluconazol), `int_065` (Levofloxacino+drogas de QT), `int_043` (ATC+ISRS — combinação usada na prática com monitorização; e o risco real, toxicidade de ATC por CYP2D6, já está certo em `int_952`–`int_954`).
- **Descrição diz "grave/fatal" mas o nível é `moderate`** — contradição visível ao usuário: `int_207`, `int_267`, `int_268`, `int_347`, `int_353`, `int_446`, `int_634`, `int_915`, `int_202`, entre outras (~25).
- **`int_2587` Riociguate + Teofilina `critical`** — as contraindicações do riociguate são **nitratos e inibidores de PDE5**; teofilina não sustenta "critical".
- **`int_486` Indacaterol + Efedrina `critical` "crise hipertensiva"** — LABA + efedrina dá taquicardia, não crise hipertensiva.
- **`int_448` Formoterol + Tramadol "arritmia fatal"** — sem base estabelecida.
- **Fitoterápicos com evidência fraca marcados `high`:** `int_119`/`int_120` (Alcachofra+diurético), `int_136` (Equinácea+Paracetamol), `int_148` (Gengibre+Lansoprazol), `int_161` (Hortelã+Ferro), `int_170` (Salgueiro+Paracetamol), `int_132` (Cimicífuga+Tamoxifeno — o próprio texto diz *"estudos devem ser conduzidos"*).
- **`int_021` Metformina + Levotiroxina** — não há interação de absorção estabelecida entre os dois; suspeita de entrada incorreta.
- **Contexto hospitalar/anestésico, não acionável em app de paciente:** bloqueadores neuromusculares + halogenados (`int_2470`–`int_2473`, `int_3031`–`int_3035`), adenosina IV (`int_947`/`int_948`), nutrição parenteral (`int_2268`, `int_2289`).
- **Antagonismo penicilina+tetraciclina/cloranfenicol marcado `high`** (`int_2500`, `int_2501`, `int_2521`, `int_2527`, `int_2798`, `int_1374`) — antagonismo in vitro clássico, sem relevância clínica demonstrada.

---

## Recomendação de ordem de correção

1. **Classe 1 + 2** (~65 entradas) — remover/reatribuir. São afirmações **factualmente erradas** (Vitamina A antagonizando varfarina; "evitar" numa combinação fixa de HIV; ferro causando sangramento). Risco real ao paciente.
2. **Classe 3** (~45) — reescrever `risk_description`/`mechanism` para o mecanismo correto (QT, EPS, PK) e reavaliar severidade. Manter os pares, corrigir o texto.
3. **Classe 4** (~57) — remover; são não-interações por definição da própria fonte.
4. **Classe 5** (93) — deduplicar por nome canônico e reconciliar os 7 conflitos de severidade.
5. **Classe 6** — recalibrar. Prioridade: alinhar `risk_level` com o adjetivo usado em `risk_description`.

O ponto estrutural: a lista PT→EN do merge FDA casou **produtos combinados** com **um único ingrediente**, e o mesmo padrão de bug já documentado nas bulas (composto vs. ingrediente puro colidindo no mesmo slug) se repetiu aqui. Vale um teste de sanidade permanente: *"nenhum `mechanism` pode citar um fármaco que não esteja em `drug1`/`drug2`"* — só essa regra pega 40 entradas.
