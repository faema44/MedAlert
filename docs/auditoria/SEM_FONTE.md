# Interações SEM FONTE

Nem a bula da ANVISA nem a bula do FDA sustentam estas entradas — nem pelo NOME do fármaco,
nem pela CLASSE. **Não quer dizer que sejam falsas**: quer dizer que o app não tem o que
CITAR. Elas continuam sinalizando o par (`source: "desconhecida"`), mas sem afirmar mecanismo
nem gravidade como fato apurado — e o cartão avisa que a interação foi apontada por IA.

**210** de 2768 (8%) — 52 críticas, 92 altas, 66 moderadas.

| etapa | sem fonte |
|---|---|
| início | 847 (31%) · 281 críticas |
| bulas da ANVISA | 415 (15%) · 146 críticas |
| openFDA, pelo nome | 305 (11%) · 110 críticas |
| openFDA, pela classe | **210 (8%) · 52 críticas** |

## Como fechar cada uma

1. **Achar fonte citável.** Restam 332 medicamentos SEM bula publicada — baixá-las deve
   fechar várias. Ou uma classe que faltou no mapa de `tools/buscar-fonte-fda.js`.
2. **Ou concluir que a entrada não se sustenta e REMOVÊ-LA** — o que exige release na Play
   Store, porque o guard do dbSync não deixa a base encolher por OTA.

## CRÍTICAS (52)

| id | fármaco 1 | fármaco 2 |
|---|---|---|
| int_199 | Acetazolamida | Aspirina |
| int_213 | Almotriptano | Fenelzina |
| int_214 | Almotriptano | Selegilina |
| int_215 | Almotriptano | Rasagilina |
| int_216 | Almotriptano | Linezolida |
| int_227 | Amisulprida | Metoclopramida |
| int_249 | Asenapina | Pimozida |
| int_252 | Atomoxetina | Tioridazina |
| int_271 | Bromoprida | Eritromicina |
| int_318 | Clomipramina | Tioridazina |
| int_330 | Clortalidona | Lítio |
| int_379 | Doxepina | Clorpromazina |
| int_389 | Duloxetina | Tioridazina |
| int_390 | Duloxetina | Pimozida |
| int_400 | Ergotamina | Cloranfenicol |
| int_412 | Etanercepte | Rituximabe |
| int_492 | Isavuconazol | Ergotamina |
| int_494 | Isavuconazol | Pimozida |
| int_511 | Linezolida | Sibutramina |
| int_532 | Mequitazina | Eritromicina |
| int_608 | Paliperidona | Pimozida |
| int_609 | Paliperidona | Tioridazina |
| int_617 | Perfenazina | Levodopa |
| int_618 | Perfenazina | Metoclopramida |
| int_619 | Perfenazina | Pimozida |
| int_643 | Propafenona | Pimozida |
| int_657 | Reboxetina | Pimozida |
| int_658 | Reboxetina | Tioridazina |
| int_664 | Risperidona | Pimozida |
| int_678 | Salix alba (Salgueiro) | Metotrexato |
| int_686 | Sibutramina | Selegilina |
| int_687 | Sibutramina | Fenelzina |
| int_688 | Sibutramina | Tramadol |
| int_707 | Sulpirida | Pimozida |
| int_753 | Tranilcipromina | Sibutramina |
| int_761 | Upadacitinibe | Tofacitinibe |
| int_762 | Upadacitinibe | Azatioprina |
| int_764 | Upadacitinibe | Tacrolimo |
| int_778 | Venlafaxina | Pimozida |
| int_779 | Venlafaxina | Tioridazina |
| int_814 | Almotriptano | Isocarboxazida |
| int_816 | Almotriptano | Moclobemida |
| int_820 | Amantadina | Triptofano |
| int_823 | Amicacina | Succinilcolina |
| int_824 | Amilorida | Eplerenona |
| int_831 | Apixabana | Nelfinavir |
| int_832 | Apixabana | Cobicistat |
| int_835 | Asenapina | Cisaprida |
| int_836 | Asenapina | Inibidores da MAO |
| int_844 | Baclofeno | Opioides |
| int_899 | Levomepromazina | Etanol |
| int_926 | Prometazina | Opioides |

## ALTAS (92)

| id | fármaco 1 | fármaco 2 |
|---|---|---|
| int_049 | Haloperidol | Metoclopramida |
| int_075 | Insulina / Hipoglicemiantes Orais | Ciprofloxacino / Levofloxacino (Quinolonas) |
| int_080 | Sinvastatina | Diclofenaco |
| int_098 | Panax ginseng (Ginseng) | Tranilcipromina |
| int_099 | Allium sativum (Alho medicinal) | Varfarina |
| int_100 | Allium sativum (Alho medicinal) | Ritonavir |
| int_101 | Glycyrrhiza glabra (Alcaçuz) | Hidroclorotiazida |
| int_103 | Glycyrrhiza glabra (Alcaçuz) | Losartana |
| int_106 | Valeriana officinalis (Valeriana) | Clonazepam |
| int_107 | Valeriana officinalis (Valeriana) | Alprazolam |
| int_113 | Echinacea purpurea (Equinácea) | Ciclosporina |
| int_114 | Echinacea purpurea (Equinácea) | Tacrolimus |
| int_208 | Adalimumabe | Tacrolimo |
| int_248 | Asenapina | Eritromicina |
| int_250 | Asenapina | Haloperidol |
| int_265 | Bisoprolol | Efedrina |
| int_282 | Carvedilol | Ergotamina |
| int_3080 | Carbamazepina | Tioridazina |
| int_3081 | Darunavir | Atazanavir |
| int_322 | Cloranfenicol | Ciclosporina |
| int_328 | Clorpromazina | Metoclopramida |
| int_351 | Dabigatrana | Posaconazol |
| int_367 | Dihidroergotamina | Sibutramina |
| int_396 | Enoxaparina | Aspirina |
| int_398 | Ergotamina | Ciprofloxacino |
| int_438 | Flufenazina | Lítio |
| int_439 | Flufenazina | Metoclopramida |
| int_455 | Ginkgo biloba | Aspirina |
| int_457 | Glycyrrhiza glabra (Alcaçuz) | Digoxina |
| int_464 | Heparina | Aspirina |
| int_480 | Iloperidona | Metoclopramida |
| int_486 | Indacaterol | Efedrina |
| int_490 | Infliximabe | Rituximabe |
| int_505 | Levomepromazina | Haloperidol |
| int_507 | Levomepromazina | Risperidona |
| int_531 | Mequitazina | Cimetidina |
| int_533 | Mequitazina | Clorpromazina |
| int_569 | Nadroparina | Ibuprofeno |
| int_592 | Olanzapina | Clorpromazina |
| int_599 | Osimertinibe | Voriconazol |
| int_606 | Paliperidona | Eritromicina |
| int_607 | Paliperidona | Levomepromazina |
| int_611 | Parecoxibe | Lítio |
| int_620 | Perfenazina | Risperidona |
| int_621 | Piper methysticum (Kava Kava) | Bupropiona |
| int_622 | Piper methysticum (Kava Kava) | Citalopram |
| int_623 | Piper methysticum (Kava Kava) | Fluoxetina |
| int_624 | Piper methysticum (Kava Kava) | Paroxetina |
| int_625 | Piper methysticum (Kava Kava) | Sertralina |
| int_641 | Primidona | Clobazam |
| int_648 | Quetiapina | Clorpromazina |
| int_662 | Risperidona | Clorpromazina |
| int_663 | Risperidona | Haloperidol |
| int_668 | Rivaroxabana | Ciclosporina |
| int_675 | Rotigotina | Fenelzina |
| int_681 | Sene | Ciprofloxacino |
| int_682 | Sene | Eritromicina |
| int_706 | Sulpirida | Metoclopramida |
| int_711 | Tacrolimo | Vancomicina |
| int_715 | Tamoxifeno | Fluoxetina |
| int_727 | Ticlopidina | Aspirina |
| int_729 | Ticlopidina | Ibuprofeno |
| int_741 | Tocilizumabe | Rituximabe |
| int_744 | Tolvaptana | Eritromicina |
| int_747 | Toxina botulínica | Clorpromazina |
| int_763 | Upadacitinibe | Ciclosporina |
| int_765 | Upadacitinibe | Micofenolato de mofetila |
| int_768 | Valeriana officinalis (Valeriana) | Triazolam |
| int_773 | Varfarina | Cefalexina |
| int_776 | Varfarina | Piperacilina |
| int_788 | Voriconazol | Quetiapina |
| int_791 | Zaleplon | Ritonavir |
| int_794 | Ziprasidona | Eritromicina |
| int_795 | Ziprasidona | Levomepromazina |
| int_807 | Abatacepte | TNF-alfa inibidores |
| int_809 | Ácido Valpróico | Álcool/etanol |
| int_811 | Adalimumabe | Anakinra |
| int_813 | Almotriptano | Metisergida |
| int_821 | Amicacina | Neostigmina |
| int_822 | Amicacina | Piridostigmina |
| int_829 | Anfotericina B | Aminoglicosídeos |
| int_840 | Atorvastatina | Nefazodona |
| int_841 | Atorvastatina | Telitromicina |
| int_849 | Bromazepam | Opioides |
| int_864 | Clorzoxazona | opioides |
| int_866 | Cloxazolam | Opioides |
| int_872 | Dexclorfeniramina | Opioides |
| int_893 | Hidrocortisona | Barbitúricos |
| int_894 | Hidroxizina | Opioides |
| int_900 | Lítio | Álcool/etanol |
| int_907 | Metocarbamol | Opioides |
| int_923 | Piper methysticum (Kava Kava) | Etanol |

## MODERADAS (66)

| id | fármaco 1 | fármaco 2 |
|---|---|---|
| int_031 | Metformina | Furosemida |
| int_092 | Ginkgo biloba | Ácido Acetilsalicílico |
| int_093 | Ginkgo biloba | Ibuprofeno |
| int_094 | Panax ginseng (Ginseng) | Varfarina |
| int_095 | Panax ginseng (Ginseng) | Insulina |
| int_096 | Panax ginseng (Ginseng) | Metformina |
| int_097 | Panax ginseng (Ginseng) | Glibenclamida |
| int_104 | Glycyrrhiza glabra (Alcaçuz) | Prednisona |
| int_110 | Passiflora incarnata (Maracujá) | Clonazepam |
| int_111 | Passiflora incarnata (Maracujá) | Alprazolam |
| int_112 | Camellia sinensis (Chá verde) | Varfarina |
| int_115 | Uncaria tomentosa (Unha de Gato) | Varfarina |
| int_117 | Curcuma longa (Cúrcuma) | Varfarina |
| int_118 | Zingiber officinale (Gengibre) | Varfarina |
| int_211 | Allium sativum (Alho medicinal) | Aspirina |
| int_218 | Alprazolam | Citalopram |
| int_241 | Aripiprazol | Clorpromazina |
| int_243 | Aripiprazol | Eritromicina |
| int_247 | Asenapina | Clorpromazina |
| int_266 | Bisoprolol | Clorpromazina |
| int_270 | Brexpiprazol | Linezolida |
| int_281 | Carboplatina | Voriconazol |
| int_296 | Ciclofosfamida | Voriconazol |
| int_310 | Clobazam | Citalopram |
| int_311 | Clobazam | Escitalopram |
| int_313 | Clobazam | Paroxetina |
| int_385 | Dronabinol | Alprazolam |
| int_395 | Eletriptano | Metoclopramida |
| int_416 | Everolimo | Bosentana |
| int_446 | Fondaparinux | Aspirina |
| int_458 | Glycyrrhiza glabra (Alcaçuz) | Espironolactona |
| int_460 | Golimumabe | Tocilizumabe |
| int_495 | Isavuconazol | Quetiapina |
| int_500 | Lasmiditan | Ergotamina |
| int_517 | Loperamida | Eritromicina |
| int_551 | Metoprolol Succinato | Ergotamina |
| int_552 | Metoprolol Succinato | Dihidroergotamina |
| int_577 | Nepafenaco | Lítio |
| int_595 | Omeprazol | Dabigatrana |
| int_596 | Omeprazol | Rivaroxabana |
| int_598 | Ondansetrona | Fentanila |
| int_604 | Paclitaxel | Eritromicina |
| int_605 | Paliperidona | Clorpromazina |
| int_616 | Perampanel | Fenobarbital |
| int_626 | Pirimetamina | Rifampicina |
| int_645 | Propofol | Clorpromazina |
| int_647 | Quetiapina | Cetirizina |
| int_669 | Rivaroxabana | Tacrolimo |
| int_673 | Ropinirol | Cimetidina |
| int_731 | Timolol Ocular | Efedrina |
| int_742 | Tocilizumabe | Tacrolimo |
| int_743 | Tolvaptana | Ciclosporina |
| int_766 | Valeriana officinalis (Valeriana) | Midazolam |
| int_767 | Valeriana officinalis (Valeriana) | Oxazepam |
| int_775 | Varfarina | Ceftriaxona |
| int_785 | Vonoprazana | Posaconazol |
| int_786 | Vonoprazana | Voriconazol |
| int_792 | Zinco | Cisplatina |
| int_802 | Zonisamida | Carbonato de lítio |
| int_817 | Almotriptano | Clorfeniramina |
| int_843 | Baclofeno | Triciclicos |
| int_846 | Betametasona | Estrógenos |
| int_855 | Cariprazina | Álcool/etanol |
| int_915 | Nadroparina | Álcool/etanol |
| int_924 | Prednisolona | Barbitúricos |
| int_929 | Selegilina | Álcool/etanol |

