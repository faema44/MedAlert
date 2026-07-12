# Lista de conferência manual — Micromedex (uso profissional individual)

> **Como usar:** consultar cada par no app *Micromedex Drug Interactions* com sua própria credencial do CRF.
> Use a consulta para **decidir se a entrada está certa ou errada** — NÃO transcreva o texto do Micromedex
> para o `interactions.json`. A redação deve continuar saindo da bula do FDA (domínio público), que é o que
> mantém a procedência da base limpa para redistribuição no app.

## Tier 1 — REMOVIDAS por "não é interação" (28 pares)

O risco aqui é **falso negativo**: se eu errei, o app deixou de alertar sobre algo real.
**Pergunta ao Micromedex:** existe interação? Se sim, qual severidade?

| Fármaco A | Fármaco B | Motivo alegado da remoção |
|---|---|---|
| Vitamina D | Colecalciferol | mesmo fármaco (colecalciferol = vit. D3) |
| Lamivudina | Zidovudina | combinação fixa Biovir (HIV) |
| Lítio | Metformina | interação inexistente |
| Esomeprazol | Claritromicina | esquema padrão H. pylori |
| Lansoprazol | Claritromicina | esquema padrão H. pylori |
| Omeprazol | Claritromicina | esquema padrão H. pylori |
| Omeprazol | Amoxicilina | esquema padrão H. pylori |
| Esomeprazol | Amoxicilina | esquema padrão H. pylori |
| Lansoprazol | Amoxicilina | esquema padrão H. pylori |
| Betametasona | Hidrocortisona | entrada quebrada (texto era de anfotericina B) |
| Lopinavir | Ritonavir | mesmo produto (Kaletra) |
| Atazanavir | Ritonavir | ritonavir = booster intencional |
| Fosamprenavir | Ritonavir | ritonavir = booster intencional |
| Espironolactona | Digoxina | interferência de ENSAIO laboratorial |
| Espironolactona (acne) | Digoxina | interferência de ENSAIO laboratorial |
| Carbamazepina | Clorpromazina | precipitado físico da suspensão |
| Carbamazepina | Tioridazina | precipitado físico da suspensão |
| Ceftriaxona | Fluconazol | incompatibilidade em soro IV |
| Ceftriaxona | Vancomicina | incompatibilidade em soro IV |
| Bicarbonato de Sódio | Norepinefrina | incompatibilidade em soro IV |
| Bicarbonato de Sódio | Dobutamina | incompatibilidade em soro IV |
| Brometo de vecurônio | Tiopental | incompatibilidade em seringa |
| Ciclobenzaprina | Verapamil | verapamil não é serotoninérgico |
| Tizanidina | Fluoxetina | ISRS não inibe CYP1A2 |
| Tizanidina | Paroxetina | ISRS não inibe CYP1A2 |
| Tizanidina | Sertralina | ISRS não inibe CYP1A2 |
| Rizatriptano | Pimozida | sem base |
| Formoterol | Tramadol | sem base |

## Tier 2 — REESCRITAS: mecanismo trocado (49 pares)

Aqui o par foi **mantido**; o que mudou foi o mecanismo e/ou a severidade.
**Pergunta ao Micromedex:** o mecanismo e a severidade abaixo conferem?

| Fármaco A | Fármaco B | Antes | Agora (severidade + mecanismo) |
|---|---|---|---|
| Fluconazol | Losartana / Valsartana (BRA) | ~~moderate: Hipotensão por redução da ativação do losartana~~ | **moderate**: Redução do efeito anti-hipertensivo — risco de perda de controle da pressão |
| Arnica montana | Varfarina | ~~moderate: Aumento do risco de sangramento~~ | **high**: Hemorragia grave |
| Alprazolam | Citalopram | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento dos níveis de alprazolam |
| Alprazolam | Fluoxetina | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento dos níveis de alprazolam |
| Aripiprazol | Citalopram | ~~high: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Aumento dos níveis de aripiprazol — pode exigir ajuste de dose |
| Aripiprazol | Fluoxetina | ~~moderate: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Aumento dos níveis de aripiprazol — reduzir a dose pela metade |
| Aripiprazol | Paroxetina | ~~high: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Aumento dos níveis de aripiprazol — reduzir a dose pela metade |
| Aripiprazol | Sertralina | ~~moderate: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Aumento discreto dos níveis de aripiprazol |
| Brexpiprazol | Linezolida | ~~critical: Síndrome serotoninérgica~~ | **moderate**: Cautela ao associar linezolida (inibidor fraco da MAO) |
| Buspirona | Cetoconazol | ~~high: Síndrome serotoninérgica~~ | **high**: Aumento acentuado dos níveis de buspirona — tontura e sedação |
| Buspirona | Itraconazol | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Aumento dos níveis de buspirona — tontura e sedação |
| Buspirona | Ritonavir | ~~high: Síndrome serotoninérgica~~ | **high**: Aumento acentuado dos níveis de buspirona — tontura e sedação |
| Celecoxibe | Metotrexato | ~~moderate: Toxicidade por metotrexato~~ | **high**: Aumento do risco de toxicidade do metotrexato (neutropenia, trombocitopenia, disfunção renal). |
| Citalopram | Pimozida | ~~high: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Clobazam | Citalopram | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento do metabólito ativo do clobazam |
| Clobazam | Escitalopram | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento do metabólito ativo do clobazam |
| Clobazam | Fluoxetina | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento do metabólito ativo do clobazam |
| Clobazam | Paroxetina | ~~high: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento do metabólito ativo do clobazam |
| Clobazam | Sertralina | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Sedação excessiva por aumento do metabólito ativo do clobazam |
| Clomipramina | Pimozida | ~~critical: Síndrome serotoninérgica~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Clomipramina | Tioridazina | ~~critical: Síndrome serotoninérgica~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Clorpromazina | Metoclopramida | ~~critical: Síndrome serotoninérgica~~ | **high**: Reações extrapiramidais graves, síndrome neuroléptica maligna e prolongamento do QT |
| Clozapina | Fluoxetina | ~~high: Aumento do risco de síndrome serotoninérgica~~ | **high**: Aumento dos níveis de clozapina — risco de sedação, convulsão e toxicidade hematológica |
| Clozapina | Paroxetina | ~~high: Aumento do risco de síndrome serotoninérgica~~ | **high**: Aumento dos níveis de clozapina — risco de sedação, convulsão e toxicidade hematológica |
| Dissulfiram | Metronidazol | ~~high: Síndrome serotoninérgica~~ | **critical**: Reação psicótica aguda e estado confusional |
| Duloxetina | Tioridazina | ~~critical: Síndrome serotoninérgica~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Duloxetina | Pimozida | ~~critical: Síndrome serotoninérgica~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Flufenazina | Lítio | ~~high: Síndrome serotoninérgica grave~~ | **high**: Neurotoxicidade — confusão, rigidez, tremor e discinesia |
| Fluoxetina | Pimozida | ~~critical: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Olanzapina | Fluoxetina | ~~moderate: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Aumento dos níveis de olanzapina — monitorar sedação e efeitos metabólicos |
| Piper methysticum (Kava Kava) | Citalopram | ~~high: Síndrome serotoninérgica grave~~ | **high**: Sedação excessiva e risco de hepatotoxicidade |
| Piper methysticum (Kava Kava) | Fluoxetina | ~~high: Síndrome serotoninérgica grave~~ | **high**: Sedação excessiva e risco de hepatotoxicidade |
| Piper methysticum (Kava Kava) | Paroxetina | ~~moderate: Síndrome serotoninérgica grave~~ | **high**: Sedação excessiva e risco de hepatotoxicidade |
| Piper methysticum (Kava Kava) | Sertralina | ~~critical: Síndrome serotoninérgica grave~~ | **high**: Sedação excessiva e risco de hepatotoxicidade |
| Reboxetina | Pimozida | ~~critical: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Reboxetina | Tioridazina | ~~high: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Sertralina | Pimozida | ~~critical: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Venlafaxina | Pimozida | ~~critical: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Venlafaxina | Tioridazina | ~~critical: Síndrome serotoninérgica grave~~ | **critical**: Prolongamento do intervalo QT — risco de torsades de pointes |
| Alfuzosina | Itraconazol | ~~high: Aumento do risco de hipotensão ortostática~~ | **critical**: Aumento dos níveis sanguíneos de alfuzosina, com risco de hipotensão sintomática. |
| Clomipramina | Álcool/etanol | ~~moderate: Síndrome serotoninérgica~~ | **high**: Depressão do SNC aditiva — sedação intensa e prejuízo psicomotor |
| Desvenlafaxina | Álcool/etanol | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Depressão do SNC aditiva — sedação e prejuízo do julgamento |
| Duloxetina | Álcool/etanol | ~~high: Síndrome serotoninérgica~~ | **high**: Risco de lesão hepática e sedação aditiva |
| Escitalopram | Álcool/etanol | ~~moderate: Síndrome serotoninérgica~~ | **moderate**: Depressão do SNC aditiva — sedação e prejuízo do julgamento |
| Fenitoína | Álcool/etanol | ~~high: Síndrome serotoninérgica e convulsão~~ | **high**: Perda do controle das convulsões e sedação aditiva |
| Fluvoxamina | Álcool/etanol | ~~moderate: Aumento do risco de síndrome serotoninérgica~~ | **moderate**: Depressão do SNC aditiva — sedação e prejuízo do julgamento |
| Sertralina | Álcool/etanol | ~~moderate: Síndrome serotoninérgica grave~~ | **moderate**: Depressão do SNC aditiva — sedação e prejuízo do julgamento |
| Venlafaxina | Álcool/etanol | ~~high: Síndrome serotoninérgica grave~~ | **high**: Depressão do SNC aditiva — sedação e prejuízo do julgamento |
| Ezetimiba | Ciclosporina | ~~critical: Aumenta o risco de miopatia, incluindo rabdomiólise.~~ | **moderate**: Aumento da exposição à ezetimiba e possível elevação da ciclosporina |

## Tier 3 — REMOVIDAS porque o próprio texto negava a interação (21 pares)

Menor prioridade: a própria bula do FDA dizia que não havia efeito relevante.

| Fármaco A | Fármaco B |
|---|---|
| Rufinamida | Topiramato |
| Desloratadina | Azitromicina |
| Desloratadina | Cetoconazol |
| Desloratadina | Eritromicina |
| Desloratadina | Fluoxetina |
| Desloratadina | Cimetidina |
| Mirabegrona | Varfarina |
| Dabigatrana | Amiodarona |
| Tolcapona | Varfarina |
| Sertralina | Fenitoína |
| Sertralina | Valproato de Sódio |
| Darunavir | Atazanavir |
| Nevirapina | Ritonavir |
| Cloridrato de Ropivacaína | Amiodarona |
| Nifedipina | Flecainida |
| Nifedipino | Flecainida |
| Granisetrona | Cetoconazol |
| Granisetrona | Fenobarbital |
| Venlafaxina | Risperidona |
| Venlafaxina | Indinavir |
| Memantina | Cetamina |

---

Total a conferir: **98 pares**.
