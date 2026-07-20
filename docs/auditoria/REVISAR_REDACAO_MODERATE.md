# Pendência — redação contraditória (Classe 6b da auditoria)

Entradas com `risk_level: moderate` cuja `risk_description` usa as palavras "grave" ou "fatal".
O selo do cartão diz "Moderado" e o título logo ao lado dizia "grave" — a pessoa lê os dois juntos.

## Resolvido em 20/07/2026 — 56 reescritas

A contradição é entre o SELO (quão séria é a interação) e o ADJETIVO (quão ruim é o desfecho).
Como o selo já comunica o nível e o `mechanism` já carrega o detalhe, a descrição passou a dizer
o que ACONTECE com a pessoa, sem o adjetivo enlatado herdado das bulas do FDA:

| antes | depois |
|---|---|
| Insuficiência adrenal grave | O corticoide perde efeito — risco de insuficiência adrenal |
| Nefrotoxicidade grave | Lesão nos rins — a função renal pode cair |
| Imunossupressão grave | A imunidade cai demais — risco de infecção |
| mielossupressão grave | Queda das células do sangue — risco de infecção e sangramento |
| Aumento do risco de arritmias graves | Prolongamento do intervalo QT, com risco de arritmia |
| hipotensão grave | A pressão pode cair demais |
| Sedação respiratória grave | Sedação profunda, com respiração mais lenta |
| Risco de hipoglicemia grave | Queda acentuada do açúcar no sangue |
| Síndrome serotoninérgica grave | Risco de síndrome serotoninérgica |

Três entradas do grupo de arritmia **não eram QT somado** e a frase genérica escondia isso — o
mecanismo delas é ACÚMULO. Foram reescritas de acordo: `int_475` (digoxina acima da faixa
segura), `int_517` (loperamida em excesso) e `int_598` (QT + respiração mais lenta).

Corticoide + inibidor (`int_545`, `int_638`) segue o caminho OPOSTO ao do indutor — o corticoide
se acumula, não cai — e por isso tem texto próprio. `int_846` (estrógenos) é questão de dose
disponível, não de queda.

De passagem: 3 mecanismos tinham "Os barbitúricos aceleram acelera as enzimas".

## Pendente — 17 entradas de SANGRAMENTO: é o NÍVEL, não o texto

Estas **não foram tocadas de propósito**. Amaciar o texto de um anticoagulante somado a um
antiagregante seria errar na direção perigosa: aqui "grave" provavelmente não é enlatado, é o
próprio motivo do alerta. A suspeita é a inversa — `moderate` é que está baixo demais.

O precedente da própria base apoia isso: na leva anterior, `int_347` (dabigatrana + ritonavir)
subiu para `high` e `int_271`/`int_379`/`int_492` para `critical` — não foram reescritas.

Atenção especial às cinco em que o mecanismo diz "atacando a coagulação por frentes diferentes"
(`int_397`, `int_446`, `int_465`, `int_634`, `int_725`): anticoagulante + antiagregante é
classificado como interação MAIOR nas bases de referência.

**Decisão necessária:** subir de nível (e para qual) ou manter. Enquanto não se decide, o texto
fica como está — dizendo a verdade clínica, ainda que brigue com o selo.

| ID | Par | risk_description atual | mecanismo (início) |
|---|---|---|---|
| `int_116` | Arnica montana + Varfarina | Hemorragia grave | A arnica montana interfere na função das plaquetas, e a varfarina já reduz a coagulação |
| `int_202` | Ácido acetilsalicílico + Ibuprofeno | Hemorragia grave | O ibuprofeno ocupa o mesmo ponto da plaqueta em que o AAS age e impede o AAS de fazer seu efeito protetor do c |
| `int_211` | Allium sativum (Alho medicinal) + Aspirina | Hemorragia grave | O allium sativum interfere na função das plaquetas, e a aspirina já reduz a coagulação |
| `int_353` | Dalteparina + Itraconazol | Hemorragia grave | O itraconazol bloqueia as vias que eliminam a dalteparina, e o anticoagulante se acumula acima da dose segura |
| `int_397` | Enoxaparina + Ibuprofeno | Hemorragia grave | A enoxaparina impede a formação do coágulo e o ibuprofeno age sobre as plaquetas e a mucosa do estômago |
| `int_446` | Fondaparinux + Aspirina | Hemorragia grave | O fondaparinux impede a formação do coágulo e a aspirina age sobre as plaquetas e a mucosa do estômago |
| `int_463` | Griseofulvina + Varfarina | Hemorragia grave | A griseofulvina altera a flora do intestino que produz vitamina K e mexe nas enzimas que eliminam a varfarina |
| `int_465` | Heparina + Ticlopidina | Hemorragia grave | A heparina impede a formação do coágulo e a ticlopidina age sobre as plaquetas e a mucosa do estômago |
| `int_594` | Omeprazol + Cilostazol | Aumento do risco de sangramento grave | O omeprazol bloqueia a enzima do fígado que elimina o cilostazol, que se acumula |
| `int_595` | Omeprazol + Dabigatrana | Aumento do risco de sangramento grave | O omeprazol bloqueia as vias que eliminam a dabigatrana, e o anticoagulante se acumula acima da dose segura |
| `int_596` | Omeprazol + Rivaroxabana | Aumento do risco de sangramento grave | O omeprazol bloqueia as vias que eliminam a rivaroxabana, e o anticoagulante se acumula acima da dose segura |
| `int_634` | Prasugrel + Varfarina | Hemorragia grave | A varfarina impede a formação do coágulo e o prasugrel age sobre as plaquetas e a mucosa do estômago |
| `int_725` | Ticagrelor + Dabigatrana | Aumento do risco de hemorragia grave | A dabigatrana impede a formação do coágulo e o ticagrelor age sobre as plaquetas e a mucosa do estômago |
| `int_774` | Varfarina + Cefazolina | Hemorragia grave | A cefazolina altera a flora do intestino que produz vitamina K, e a varfarina depende justamente dessa vitamin |
| `int_775` | Varfarina + Ceftriaxona | Hemorragia grave | A ceftriaxona altera a flora do intestino que produz vitamina K e mexe nas enzimas que eliminam a varfarina |
| `int_886` | Fluoxetina + Álcool/etanol | Aumento risco de hemorragia grave | A fluoxetina reduz a serotonina das plaquetas, que é o que as faz se agregarem, e o álcool agride a mucosa do  |
| `int_915` | Nadroparina + Álcool/etanol | Hemorragia grave | A nadroparina impede a formação do coágulo e o álcool agride a mucosa do estômago, além de afetar as plaquetas |
