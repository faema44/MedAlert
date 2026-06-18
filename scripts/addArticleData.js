/* eslint-disable */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// ── 1. NOVOS FITOTERÁPICOS ────────────────────────────────────────────────────
const dbPath = path.join(root, 'src/data/medications-db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const existing = new Set(db.medications.map(m => m.genericName.toLowerCase()));

const newPhyto = [
  { genericName: 'Cynara scolymus (Alcachofra)',        brands: ['Alcachofra','Cynara'],          category: 'Fitoterápico' },
  { genericName: 'Matricaria recutita (Camomila)',       brands: ['Camomila','Camomila Sachê'],    category: 'Fitoterápico' },
  { genericName: 'Rhamnus purshiana (Cáscara Sagrada)', brands: ['Cáscara Sagrada'],              category: 'Fitoterápico' },
  { genericName: 'Aesculus hippocastanum (Castanha da Índia)', brands: ['Castanha da Índia','Escina'], category: 'Fitoterápico' },
  { genericName: 'Centella asiatica (Centella Asiática)',brands: ['Centella Asiática','Centella'], category: 'Fitoterápico' },
  { genericName: 'Cimicifuga racemosa (Cimicífuga)',    brands: ['Cimicífuga','Black Cohosh','Remifemin'], category: 'Fitoterápico' },
  { genericName: 'Pimpinella anisum (Erva-doce)',       brands: ['Erva-doce','Anis'],             category: 'Fitoterápico' },
  { genericName: 'Eucalyptus globulus (Eucalipto)',     brands: ['Eucalipto','Óleo de Eucalipto'],category: 'Fitoterápico' },
  { genericName: 'Paullinia cupana (Guaraná)',          brands: ['Guaraná','Guaraná em Pó'],      category: 'Fitoterápico' },
  { genericName: 'Mentha piperita (Hortelã-pimenta)',   brands: ['Hortelã','Hortelã-pimenta'],    category: 'Fitoterápico' },
  { genericName: 'Salix alba (Salgueiro)',              brands: ['Salgueiro','Casca de Salgueiro'],category: 'Fitoterápico' },
  { genericName: 'Senna alexandrina (Sene)',            brands: ['Sene','Sen','Sene Folhas'],     category: 'Fitoterápico' },
  { genericName: 'Tanacetum parthenium (Tanaceto)',     brands: ['Tanaceto','Feverfew'],          category: 'Fitoterápico' },
  { genericName: 'Arctostaphylos uva-ursi (Uva-ursi)', brands: ['Uva-ursi','Uva Ursi'],          category: 'Fitoterápico' },
];

let addedPhyto = 0;
for (const p of newPhyto) {
  if (!existing.has(p.genericName.toLowerCase())) {
    db.medications.push(p);
    existing.add(p.genericName.toLowerCase());
    addedPhyto++;
    console.log(' + Fitoterápico:', p.genericName);
  } else {
    console.log(' = Já existe:', p.genericName);
  }
}

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log(`\nFitoterápicos adicionados: ${addedPhyto}. Total: ${db.medications.filter(m => m.category === 'Fitoterápico').length}\n`);

// ── 2. NOVAS INTERAÇÕES ───────────────────────────────────────────────────────
const intPath = path.join(root, 'src/data/interactions.json');
const ints = JSON.parse(fs.readFileSync(intPath, 'utf8'));

const existingPairs = new Set(ints.map(i => `${i.drug1.toLowerCase()}|${i.drug2.toLowerCase()}`));

function pair(d1, d2) {
  return existingPairs.has(`${d1.toLowerCase()}|${d2.toLowerCase()}`) ||
         existingPairs.has(`${d2.toLowerCase()}|${d1.toLowerCase()}`);
}

let nextId = Math.max(...ints.map(i => parseInt(i.id.replace('int_','')))) + 1;

const newInts = [
  // ALCACHOFRA
  { drug1: 'Cynara scolymus (Alcachofra)', drug2: 'Furosemida', risk_level: 'high',
    risk_description: 'Alcachofra potencializa perda de potássio e hipotensão por hipovolemia induzida pela furosemida',
    mechanism: 'A alcachofra tem ação diurética e atua na excreção de potássio; a combinação com diuréticos de alça pode causar hipocalemia grave e redução drástica da pressão arterial.' },
  { drug1: 'Cynara scolymus (Alcachofra)', drug2: 'Hidroclorotiazida', risk_level: 'high',
    risk_description: 'Risco de hipocalemia e queda de pressão arterial quando usados juntos',
    mechanism: 'Efeito aditivo na diurese e excreção de potássio; a hipocalemia resultante pode provocar fraqueza muscular e arritmias.' },

  // ALHO
  { drug1: 'Allium sativum (Alho medicinal)', drug2: 'Insulina', risk_level: 'high',
    risk_description: 'Alho pode intensificar o efeito hipoglicemiante da insulina causando hipoglicemia excessiva',
    mechanism: 'O alho potencializa drogas hipoglicemiantes (insulina e glipizida) promovendo diminuição excessiva dos níveis de açúcar no sangue, exigindo monitoramento glicêmico cuidadoso.' },
  { drug1: 'Allium sativum (Alho medicinal)', drug2: 'Saquinavir', risk_level: 'high',
    risk_description: 'Alho reduz os níveis plasmáticos do saquinavir comprometendo o tratamento do HIV',
    mechanism: 'O alho induz enzimas do citocromo P450 reduzindo a biodisponibilidade do saquinavir e potencialmente de outros antirretrovirais, comprometendo a supressão viral.' },

  // BOLDO
  { drug1: 'Peumus boldus (Boldo)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Boldo aumenta o risco de sangramento ao inibir a agregação plaquetária',
    mechanism: 'A boldina inibe a agregação plaquetária pela não formação do tromboxano A2. Pacientes sob anticoagulação não devem ingerir concomitantemente produtos contendo boldo, pois a ação é aditiva à da varfarina.' },

  // CAMOMILA
  { drug1: 'Matricaria recutita (Camomila)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Camomila aumenta risco de sangramento em uso concomitante com anticoagulantes',
    mechanism: 'A camomila interage com anticoagulantes como a varfarina e aumenta o risco de sangramento; com barbitúricos pode intensificar ou prolongar a ação depressora do SNC.' },
  { drug1: 'Matricaria recutita (Camomila)', drug2: 'Fenobarbital', risk_level: 'moderate',
    risk_description: 'Camomila pode prolongar ou intensificar a depressão do sistema nervoso central pelo fenobarbital',
    mechanism: 'A camomila atua no SNC com ação sedativa leve; combinada com barbitúricos como o fenobarbital pode intensificar ou prolongar o efeito depressor central, causando sedação excessiva.' },

  // CÁSCARA SAGRADA
  { drug1: 'Rhamnus purshiana (Cáscara Sagrada)', drug2: 'Digoxina', risk_level: 'high',
    risk_description: 'Cáscara Sagrada causa hipocalemia que potencializa a toxicidade da digoxina',
    mechanism: 'A perda de potássio induzida pela ação laxativa da cáscara sagrada potencia o efeito de glicosídeos cardiotônicos (digitalis e estrofanto), podendo causar arritmias graves e toxicidade cardíaca.' },
  { drug1: 'Rhamnus purshiana (Cáscara Sagrada)', drug2: 'Hidroclorotiazida', risk_level: 'high',
    risk_description: 'Uso concomitante provoca hipocalemia acentuada e desequilíbrio eletrolítico',
    mechanism: 'O uso concomitante com diuréticos tiazídicos não é recomendado, pois a cáscara sagrada intensifica a excreção de potássio podendo resultar em hipocalemia grave e desequilíbrio de eletrólitos.' },

  // CASTANHA DA ÍNDIA
  { drug1: 'Aesculus hippocastanum (Castanha da Índia)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Castanha da Índia aumenta o risco de sangramentos quando usada com anticoagulantes',
    mechanism: 'A escina (principal componente saponínico) liga-se às proteínas plasmáticas podendo afetar a ligação de outras drogas; aumenta o risco de sangramentos com varfarina, heparina e antiagregantes plaquetários.' },
  { drug1: 'Aesculus hippocastanum (Castanha da Índia)', drug2: 'Ácido Acetilsalicílico', risk_level: 'high',
    risk_description: 'Combinação aumenta risco de sangramento por efeito aditivo na inibição plaquetária',
    mechanism: 'A castanha da Índia inibe a agregação plaquetária e, combinada com AAS e outros antiinflamatórios não esteroidais, produz efeito aditivo no risco de sangramento gastrointestinal e sistêmico.' },
  { drug1: 'Aesculus hippocastanum (Castanha da Índia)', drug2: 'Gentamicina', risk_level: 'high',
    risk_description: 'Castanha da Índia não deve ser usada com drogas nefrotóxicas como a gentamicina',
    mechanism: 'A castanha da Índia é irritante ao trato gastrointestinal e pode exercer nefrotoxicidade aditiva quando combinada com aminoglicosídeos como a gentamicina.' },
  { drug1: 'Aesculus hippocastanum (Castanha da Índia)', drug2: 'Insulina', risk_level: 'moderate',
    risk_description: 'Castanha da Índia pode intensificar o efeito hipoglicemiante da insulina',
    mechanism: 'Em estudos com animais, a castanha da Índia pode intensificar o efeito hipoglicemiante de medicamentos para diabetes por via oral ou insulina, exigindo monitoramento da glicemia.' },

  // CIMICÍFUGA
  { drug1: 'Cimicifuga racemosa (Cimicífuga)', drug2: 'Tamoxifeno', risk_level: 'moderate',
    risk_description: 'Cimicífuga pode potencializar o efeito do tamoxifeno; estudos devem ser conduzidos',
    mechanism: 'Os princípios ativos da cimicífuga ocupam os receptores estrogênicos. Quando usada concomitantemente com tamoxifeno pode ocorrer potencialização do efeito deste último, embora mais estudos sejam necessários.' },
  { drug1: 'Cimicifuga racemosa (Cimicífuga)', drug2: 'Enalapril', risk_level: 'moderate',
    risk_description: 'Cimicífuga pode potencializar o efeito anti-hipertensivo causando hipotensão',
    mechanism: 'A cimicífuga pode potenciar o efeito de medicamentos anti-hipertensivos causando hipotensão; esta interação ocorre por mecanismo não totalmente elucidado relacionado à ação sobre receptores estrogênicos.' },

  // EQUINÁCEA - novos
  { drug1: 'Echinacea purpurea (Equinácea)', drug2: 'Metotrexato', risk_level: 'high',
    risk_description: 'Equinácea aumenta o risco de hepatotoxicidade com metotrexato',
    mechanism: 'Como planta que estimula o sistema imunológico, a equinácea pode aumentar a hepatotoxicidade quando administrada com drogas como esteróides anabolizantes, amiodarona, metotrexato e paracetamol. Uso simultâneo deve ser evitado.' },
  { drug1: 'Echinacea purpurea (Equinácea)', drug2: 'Amiodarona', risk_level: 'high',
    risk_description: 'Equinácea aumenta risco de hepatotoxicidade com amiodarona',
    mechanism: 'Baseado em relatos clínicos de toxicidade hepática, a possibilidade de hepatotoxicidade aumenta quando a equinácea é combinada com drogas como amiodarona, que já possui toxicidade hepática conhecida.' },
  { drug1: 'Echinacea purpurea (Equinácea)', drug2: 'Paracetamol', risk_level: 'high',
    risk_description: 'Uso prolongado de equinácea com paracetamol aumenta risco de dano hepático',
    mechanism: 'Equinácea pode ser hepatotóxica em uso prolongado (mais de 8 semanas). A combinação com paracetamol em doses habituais ou altas pode aumentar o risco de danos hepáticos, especialmente em pacientes com hepatite ou cirrose.' },

  // ERVA CIDREIRA - novo
  { drug1: 'Melissa officinalis (Erva Cidreira)', drug2: 'Diazepam', risk_level: 'moderate',
    risk_description: 'Erva cidreira pode potencializar o efeito sedativo do diazepam',
    mechanism: 'A erva cidreira interage com depressores do sistema nervoso central. De maneira geral, pode potencializar o efeito de benzodiazepínicos como o diazepam e interagir com hormônios tireoideos (ligação à tirotropina).' },

  // HYPERICUM - novos
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Indinavir', risk_level: 'critical',
    risk_description: 'Hipérico reduz drasticamente os níveis de indinavir, comprometendo o tratamento do HIV',
    mechanism: 'O hipérico interfere fortemente no citocromo P450 (CYP3A4 e glicoproteína-P); quando administrado com indinavir (tratamento de AIDS), os níveis sanguíneos do fármaco são reduzidos gerando consequências graves como falha terapêutica e resistência viral.' },
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Teofilina', risk_level: 'high',
    risk_description: 'Hipérico reduz os níveis séricos de teofilina pelo efeito indutor do CYP450',
    mechanism: 'O hipérico induz enzimas do citocromo P450; a teofilina é uma das drogas cujos níveis séricos podem ser reduzidos, potencializando reações adversas ou reduzindo a eficácia do broncodilatador.' },
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Fenitoína', risk_level: 'high',
    risk_description: 'Hipérico reduz os níveis sanguíneos de fenitoína comprometendo o controle das convulsões',
    mechanism: 'Pela indução do CYP450, o hipérico reduz os níveis de anticonvulsivantes como a fenitoína, podendo levar à perda do controle das crises convulsivas. Monitoramento rigoroso é necessário.' },
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Midazolam', risk_level: 'high',
    risk_description: 'Hipérico acelera o metabolismo do midazolam reduzindo sua eficácia sedativa',
    mechanism: 'O hipérico é indutor potente de CYP3A4; o midazolam é extensivamente metabolizado por esta enzima. A combinação pode reduzir os níveis plasmáticos do midazolam, comprometendo a sedação e anestesia.' },
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Carbamazepina', risk_level: 'high',
    risk_description: 'Hipérico reduz os níveis de carbamazepina podendo desestabilizar epilepsia',
    mechanism: 'Pela indução de CYP3A4 e CYP2C9, o hipérico acelera o metabolismo da carbamazepina, reduzindo seus níveis séricos e podendo comprometer o controle de convulsões e transtorno bipolar.' },
  { drug1: 'Hypericum perforatum (Erva de São João)', drug2: 'Tranilcipromina', risk_level: 'high',
    risk_description: 'Combinação pode causar síndrome serotoninérgica potencialmente fatal',
    mechanism: 'O hipérico potencializa o efeito de inibidores da monoamino oxidase (IMAOs) como a tranilcipromina. A síndrome serotoninérgica pode se instalar com tremores, hipertermia, agitação e, nos casos graves, risco de vida.' },

  // GENGIBRE - novos
  { drug1: 'Zingiber officinale (Gengibre)', drug2: 'Ácido Acetilsalicílico', risk_level: 'high',
    risk_description: 'Gengibre aumenta risco de sangramento quando combinado com AAS',
    mechanism: 'O gengibre inibe a síntese de tromboxano A2 e a agregação plaquetária. Em altas doses, a combinação com AAS, varfarina, heparina ou clopidogrel aumenta significativamente o risco de sangramento.' },
  { drug1: 'Zingiber officinale (Gengibre)', drug2: 'Clopidogrel', risk_level: 'high',
    risk_description: 'Gengibre potencializa o efeito antiagregante do clopidogrel aumentando risco de sangramento',
    mechanism: 'Por inibição da agregação plaquetária, o gengibre produz efeito aditivo com o clopidogrel. A combinação pode levar a sangramentos espontâneos e aumentar o risco perioperatório.' },
  { drug1: 'Zingiber officinale (Gengibre)', drug2: 'Heparina', risk_level: 'high',
    risk_description: 'Gengibre aumenta risco de sangramento com heparina',
    mechanism: 'Mecanismo antiagregante plaquetário do gengibre produz efeito aditivo com anticoagulantes como a heparina; deve-se evitar o uso concomitante especialmente no período perioperatório.' },
  { drug1: 'Zingiber officinale (Gengibre)', drug2: 'Insulina', risk_level: 'moderate',
    risk_description: 'Gengibre pode reduzir os níveis de açúcar no sangue intensificando o efeito da insulina',
    mechanism: 'Existe possibilidade de diminuição dos níveis de açúcar no sangue com o uso de gengibre em altas doses; portanto, pode interferir com medicamentos hipoglicemiantes como a insulina, exigindo monitoramento glicêmico.' },
  { drug1: 'Zingiber officinale (Gengibre)', drug2: 'Lansoprazol', risk_level: 'moderate',
    risk_description: 'Gengibre pode comprometer a ação de antiulcerosos ao estimular produção de ácido gástrico',
    mechanism: 'O gengibre estimula a produção de ácido clorídrico estomacal e pode comprometer a ação de medicamentos contendo sucralfato, ranitidina ou lansoprazol. Paradoxalmente, em estudos animais apresentou proteção estomacal.' },

  // GINKGO - novos
  { drug1: 'Ginkgo biloba', drug2: 'Clopidogrel', risk_level: 'high',
    risk_description: 'Ginkgo potencializa o efeito antiagregante do clopidogrel com risco de sangramento grave',
    mechanism: 'O ginkgo inibe o fator de ativação plaquetária e produz efeito aditivo com antiagregantes como o clopidogrel; usuários de medicamentos antiplaquetários devem ser advertidos sobre os riscos desta combinação.' },
  { drug1: 'Ginkgo biloba', drug2: 'Heparina', risk_level: 'high',
    risk_description: 'Ginkgo aumenta risco de sangramento com heparina',
    mechanism: 'O ginkgo potencializa a ação de anticoagulantes como a heparina através da inibição do fator ativador de plaquetas; a combinação pode resultar em sangramentos espontâneos graves.' },
  { drug1: 'Ginkgo biloba', drug2: 'Fenitoína', risk_level: 'high',
    risk_description: 'Ginkgo pode diminuir a ação anticonvulsivante da fenitoína',
    mechanism: 'A administração do ginkgo pode diminuir a ação de anticonvulsivantes como a fenitoína. A presença de antidepressivos (inibidores da monoamino oxidase) intensifica a ação farmacológica destas drogas, com colaterais como cefaléia e tremores.' },
  { drug1: 'Ginkgo biloba', drug2: 'Sertralina', risk_level: 'high',
    risk_description: 'Combinação de ginkgo e sertralina causa taquicardia, hipertermia e agitação',
    mechanism: 'Quando usado com sertralina, o ginkgo pode desencadear aumento dos batimentos cardíacos, hipertermia, sudorese intensificada, rigidez muscular e agitação, sugestivos de toxicidade serotoninérgica.' },
  { drug1: 'Ginkgo biloba', drug2: 'Ciclosporina', risk_level: 'moderate',
    risk_description: 'Ginkgo pode intensificar a toxicidade renal da ciclosporina',
    mechanism: 'Em teoria, o ginkgo pode intensificar a ação de drogas usadas para disfunção erétil como o sildenafil e os efeitos colaterais de fluoruracil e a toxicidade renal das ciclosporinas.' },
  { drug1: 'Ginkgo biloba', drug2: 'Sildenafil', risk_level: 'moderate',
    risk_description: 'Ginkgo pode intensificar o efeito vasodilatador do sildenafil',
    mechanism: 'O ginkgo melhora a circulação periférica e pode intensificar a ação de drogas usadas para disfunção erétil como o sildenafil, podendo causar hipotensão. Cautela no uso concomitante.' },

  // GINSENG - novos
  { drug1: 'Panax ginseng (Ginseng)', drug2: 'Ácido Acetilsalicílico', risk_level: 'high',
    risk_description: 'Ginseng aumenta risco de sangramento com AAS por inibição da agregação plaquetária',
    mechanism: 'O ginseng inibe a formação do Tromboxano A2 e a agregação plaquetária. Combinado com AAS, heparina ou clopidogrel aumenta o risco de sangramentos, exigindo monitoramento em pacientes anticoagulados.' },
  { drug1: 'Panax ginseng (Ginseng)', drug2: 'Heparina', risk_level: 'high',
    risk_description: 'Ginseng pode reduzir a ação anticoagulante da heparina e aumentar risco de sangramento',
    mechanism: 'Estudos em humanos sugerem que o ginseng pode reduzir a ação anticoagulante da heparina e da varfarina, mas paradoxalmente também aumentar o risco de sangramentos por inibição plaquetária.' },
  { drug1: 'Panax ginseng (Ginseng)', drug2: 'Clopidogrel', risk_level: 'high',
    risk_description: 'Ginseng intensifica o efeito antiagregante do clopidogrel',
    mechanism: 'Muitos componentes do ginseng inibem a formação do Tromboxano A2 e consequentemente a agregação plaquetária, produzindo efeito aditivo com o clopidogrel e aumentando o risco de sangramento.' },
  { drug1: 'Panax ginseng (Ginseng)', drug2: 'Anlodipino', risk_level: 'moderate',
    risk_description: 'Ginseng pode alterar a pressão sanguínea e a efetividade de bloqueadores de canais de cálcio',
    mechanism: 'Baseado em relatos clínicos, o ginseng pode aumentar ou diminuir a pressão sanguínea; no caso de bloqueadores de canais de cálcio como o anlodipino, muita cautela deve ser empregada na combinação de plantas que alteram a pressão.' },

  // GUARANÁ
  { drug1: 'Paullinia cupana (Guaraná)', drug2: 'Varfarina', risk_level: 'moderate',
    risk_description: 'Guaraná pode inibir a agregação plaquetária aumentando o risco de sangramento com varfarina',
    mechanism: 'Quando administrado com anticoagulantes como a varfarina, o guaraná pode inibir a agregação de plaquetas aumentando o risco de sangramento. Monitoramento do tempo de protrombina é recomendado.' },

  // HORTELÃ-PIMENTA
  { drug1: 'Mentha piperita (Hortelã-pimenta)', drug2: 'Ciclosporina', risk_level: 'moderate',
    risk_description: 'Hortelã-pimenta pode aumentar os níveis sanguíneos de ciclosporina',
    mechanism: 'O óleo de hortelã-pimenta interfere no sistema enzimático hepático citocromo P450 e, como consequência, os níveis de outras drogas administradas concomitantemente, como a ciclosporina, podem se elevar no sangue.' },
  { drug1: 'Mentha piperita (Hortelã-pimenta)', drug2: 'Sulfato ferroso', risk_level: 'moderate',
    risk_description: 'Hortelã-pimenta inibe a absorção de ferro em pacientes anêmicos',
    mechanism: 'Estudos em modelos animais demonstraram que a absorção de ferro pelas proteínas sanguíneas foi inibida quando chás de hortelã-pimenta foram administrados, exigindo precaução em pacientes anêmicos ou crianças.' },

  // KAVA-KAVA - novos
  { drug1: 'Piper methysticum (Kava Kava)', drug2: 'Alprazolam', risk_level: 'high',
    risk_description: 'Kava-kava intensifica a sedação e depressão do SNC do alprazolam',
    mechanism: 'Existe possibilidade de interação de kava-kava com alprazolam potencializando a sedação. Esta planta potencia a ação de drogas que atuam no SNC como álcool, barbitúricos, benzodiazepínicos e antipsicóticos.' },
  { drug1: 'Piper methysticum (Kava Kava)', drug2: 'Fenobarbital', risk_level: 'high',
    risk_description: 'Kava-kava potencializa o efeito depressor do SNC do fenobarbital',
    mechanism: 'A kava-kava potencia a ação de drogas que atuam no sistema nervoso central; sua combinação com barbitúricos como o fenobarbital pode intensificar a sedação, depressão respiratória e o risco de acidentes.' },
  { drug1: 'Piper methysticum (Kava Kava)', drug2: 'Levodopa', risk_level: 'high',
    risk_description: 'Kava-kava antagoniza a dopamina comprometendo o tratamento da doença de Parkinson',
    mechanism: 'A kava-kava antagoniza o efeito da dopamina e pode reduzir a eficácia da levodopa utilizada para doença de Parkinson. O uso concomitante com outros antagonistas dopaminérgicos pode causar bloqueio dopaminérgico e provocar discenesia e distonia.' },
  { drug1: 'Piper methysticum (Kava Kava)', drug2: 'Paracetamol', risk_level: 'high',
    risk_description: 'Kava-kava aumenta o risco de hepatotoxicidade com paracetamol',
    mechanism: 'Muitos casos de toxicidade hepática foram relatados na Europa após uso de kava-kava. A combinação com drogas potencialmente hepatotóxicas como o paracetamol em doses altas ou uso prolongado aumenta o risco de dano hepático grave.' },

  // MARACUJÁ - novos
  { drug1: 'Passiflora incarnata (Maracujá)', drug2: 'Álcool etílico', risk_level: 'high',
    risk_description: 'Maracujá intensifica a depressão do SNC do álcool causando sedação excessiva',
    mechanism: 'O maracujá possui frações alcaloidais e flavonoidais que promovem ações depressoras inespecíficas do SNC. O uso desta droga com álcool pode aumentar a intensidade de sonolência e comprometer funções motoras e cognitivas.' },
  { drug1: 'Passiflora incarnata (Maracujá)', drug2: 'Fenobarbital', risk_level: 'high',
    risk_description: 'Maracujá potencializa o efeito sedativo do fenobarbital',
    mechanism: 'As frações sedativas-hipnóticas do maracujá podem aumentar a intensidade de sonolência de barbitúricos como o fenobarbital, potencializando a depressão respiratória e aumentando o risco de sedação excessiva.' },
  { drug1: 'Passiflora incarnata (Maracujá)', drug2: 'Tranilcipromina', risk_level: 'high',
    risk_description: 'Maracujá com inibidores da MAO pode causar efeito aditivo perigoso',
    mechanism: 'O uso de maracujá com drogas inibidoras da monoamino oxidase (isocarboxazida, fenelzina e tranilcipromina) pode causar efeito aditivo potencialmente grave sobre o sistema nervoso central.' },
  { drug1: 'Passiflora incarnata (Maracujá)', drug2: 'Varfarina', risk_level: 'moderate',
    risk_description: 'Maracujá pode aumentar o risco de sangramento com anticoagulantes',
    mechanism: 'Teoricamente pode ocorrer sangramento se o maracujá for administrado concomitantemente com aspirina, varfarina ou heparina, por potencialização do efeito antiagregante e anticoagulante.' },

  // SALGUEIRO
  { drug1: 'Salix alba (Salgueiro)', drug2: 'Paracetamol', risk_level: 'high',
    risk_description: 'Combinação de salgueiro e paracetamol aumenta risco de nefrotoxicidade',
    mechanism: 'A associação de nefrotoxicidade do paracetamol quando utilizado concomitantemente com o ácido acetilsalicílico (presente no salgueiro na forma de salicilatos) é descrita na literatura. Ervas contendo salicilatos podem potencializar a toxicidade renal.' },
  { drug1: 'Salix alba (Salgueiro)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Salgueiro (rico em salicilatos) potencializa o efeito anticoagulante da varfarina',
    mechanism: 'O salgueiro contém salicilatos que produzem efeito aditivo sobre a inibição da função plaquetária quando combinado com a varfarina, aumentando o risco de sangramento. Também pode ocorrer desequilíbrio na absorção de ferro.' },

  // SAW PALMETTO - novos
  { drug1: 'Serenoa repens (Saw Palmetto)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Saw palmetto aumenta risco de sangramento com anticoagulantes',
    mechanism: 'Baseado em relatos clínicos, o saw palmetto pode aumentar o risco de sangramento quando administrado conjuntamente com varfarina, heparina, clopidogrel e antiinflamatórios não esteroidais como ibuprofeno ou naproxeno.' },
  { drug1: 'Serenoa repens (Saw Palmetto)', drug2: 'Finasterida', risk_level: 'moderate',
    risk_description: 'Saw palmetto interfere na ação hormonal da finasterida',
    mechanism: 'O saw palmetto possui ação hormonal oposta à da testosterona e pode interferir com a finasterida (inibe 5-alfa-redutase) ou flutamida usadas para tratar hiperplasia benigna da próstata e câncer de próstata.' },

  // SENE
  { drug1: 'Senna alexandrina (Sene)', drug2: 'Digoxina', risk_level: 'high',
    risk_description: 'Sene causa hipocalemia que potencializa a toxicidade cardíaca da digoxina',
    mechanism: 'A ação laxativa do sene promove perda de potássio que pode potenciar os efeitos de glicosídeos cardiotônicos como a digitalis e o estrofanto. A hipocalemia resultante sensibiliza o coração à toxicidade da digoxina.' },
  { drug1: 'Senna alexandrina (Sene)', drug2: 'Quinidina', risk_level: 'high',
    risk_description: 'Hipocalemia causada pelo sene potencializa arritmias com quinidina',
    mechanism: 'Existindo hipocalemia por abuso do sene como laxativo, pode ocorrer intensificação da ação de fármacos antiarrítmicos como a quinidina, que afeta os canais de potássio, com risco de arritmias graves.' },
  { drug1: 'Senna alexandrina (Sene)', drug2: 'Hidroclorotiazida', risk_level: 'high',
    risk_description: 'Combinação causa hipocalemia grave e desequilíbrio eletrolítico severo',
    mechanism: 'O uso simultâneo com diuréticos tiazídicos, adrenocorticosteróides ou Glycyrrhiza uralensis pode exacerbar o desequilíbrio de eletrólitos causado pelo sene, levando a hipocalemia grave e suas complicações cardíacas.' },

  // TANACETO
  { drug1: 'Tanacetum parthenium (Tanaceto)', drug2: 'Varfarina', risk_level: 'high',
    risk_description: 'Tanaceto possui atividade anticoagulante que potencializa a varfarina',
    mechanism: 'O tanaceto apresenta atividade anticoagulante; se administrado com fármacos anticoagulantes como varfarina, heparina ou clopidogrel, pode aumentar o risco de sangramentos espontâneos por ação sinérgica.' },
  { drug1: 'Tanacetum parthenium (Tanaceto)', drug2: 'Ácido Acetilsalicílico', risk_level: 'high',
    risk_description: 'Tanaceto associado a AAS aumenta risco de sangramento espontâneo',
    mechanism: 'A atividade antiagregante plaquetária do tanaceto é aditiva ao AAS e outros antiinflamatórios não esteroidais; a combinação pode aumentar significativamente o risco de sangramentos, especialmente gastrointestinais.' },

  // VALERIANA - novos
  { drug1: 'Valeriana officinalis (Valeriana)', drug2: 'Fenobarbital', risk_level: 'high',
    risk_description: 'Valeriana potencializa o efeito sedativo do fenobarbital',
    mechanism: 'A valeriana possui ação sedativa que pode ser potencializada quando utilizada com barbitúricos como o fenobarbital; a combinação promove maior tempo de sedação e depressão do SNC, aumentando o risco de sonolência excessiva.' },
  { drug1: 'Valeriana officinalis (Valeriana)', drug2: 'Amitriptilina', risk_level: 'high',
    risk_description: 'Valeriana potencializa o efeito sedativo de antidepressivos tricíclicos',
    mechanism: 'A ação sedativa da valeriana pode ser potencializada por antidepressivos tricíclicos como a amitriptilina, narcóticos e anestésicos, promovendo maior tempo de sedação e risco de depressão do SNC.' },
];

let addedInts = 0;
for (const ni of newInts) {
  if (!pair(ni.drug1, ni.drug2)) {
    const id = `int_${String(nextId).padStart(3,'0')}`;
    ints.push({ id, ...ni });
    existingPairs.add(`${ni.drug1.toLowerCase()}|${ni.drug2.toLowerCase()}`);
    nextId++;
    addedInts++;
    console.log(` + [${ni.risk_level}] ${ni.drug1} + ${ni.drug2}`);
  } else {
    console.log(` = Já existe: ${ni.drug1} + ${ni.drug2}`);
  }
}

fs.writeFileSync(intPath, JSON.stringify(ints, null, 2), 'utf8');
console.log(`\nInterações adicionadas: ${addedInts}. Total: ${ints.length}`);
