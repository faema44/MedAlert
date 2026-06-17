/* eslint-disable */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'src/data/medications-db.json');
const intPath = path.join(root, 'src/data/interactions.json');

// ── 1. Phytotherapics ────────────────────────────────────────────────────────
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const already = new Set(db.medications.map(m => m.genericName.toLowerCase()));
const newPhyto = [
  { genericName: "Hypericum perforatum (Erva de São João)", brands: ["Erva de São João", "Hipérico", "Hipericão", "St. John's Wort", "Remotiv", "Jarsin", "Hypericum"], category: "Fitoterápico" },
  { genericName: "Ginkgo biloba", brands: ["Ginkgo", "Ginkobi", "Tebonin", "Bilobil", "Ginkoba"], category: "Fitoterápico" },
  { genericName: "Panax ginseng (Ginseng)", brands: ["Ginseng", "Ginseng coreano", "Ginseng americano", "Ginsana", "Panax"], category: "Fitoterápico" },
  { genericName: "Passiflora incarnata (Maracujá)", brands: ["Maracujá", "Passiflora", "Pasalix", "Kromaflor"], category: "Fitoterápico" },
  { genericName: "Valeriana officinalis (Valeriana)", brands: ["Valeriana", "Valdispert", "Valeriol", "Valerien"], category: "Fitoterápico" },
  { genericName: "Allium sativum (Alho medicinal)", brands: ["Alho medicinal", "Alho", "Alimax", "Alicin", "Kwai"], category: "Fitoterápico" },
  { genericName: "Camellia sinensis (Chá verde)", brands: ["Chá verde", "Green Tea", "Camellia"], category: "Fitoterápico" },
  { genericName: "Echinacea purpurea (Equinácea)", brands: ["Equinácea", "Echinacea", "Echinaforce"], category: "Fitoterápico" },
  { genericName: "Glycyrrhiza glabra (Alcaçuz)", brands: ["Alcaçuz", "Licorice", "Extrato de Alcaçuz"], category: "Fitoterápico" },
  { genericName: "Piper methysticum (Kava Kava)", brands: ["Kava Kava", "Kava", "Kavatrol", "Laitan"], category: "Fitoterápico" },
  { genericName: "Silybum marianum (Silimarina)", brands: ["Silimarina", "Cardo Mariano", "Legalon", "Silimarin"], category: "Fitoterápico" },
  { genericName: "Uncaria tomentosa (Unha de Gato)", brands: ["Unha de Gato", "Cat's Claw", "Uncaria", "Vilcacora"], category: "Fitoterápico" },
  { genericName: "Serenoa repens (Saw Palmetto)", brands: ["Saw Palmetto", "Serenoa repens", "Permixon"], category: "Fitoterápico" },
  { genericName: "Melissa officinalis (Erva Cidreira)", brands: ["Erva Cidreira", "Melissa", "Lemon Balm"], category: "Fitoterápico" },
  { genericName: "Arnica montana", brands: ["Arnica", "Arnica montana", "Arnicaflor"], category: "Fitoterápico" },
  { genericName: "Peumus boldus (Boldo)", brands: ["Boldo", "Boldus", "Boldo do Chile"], category: "Fitoterápico" },
  { genericName: "Maytenus ilicifolia (Espinheira Santa)", brands: ["Espinheira Santa", "Ulcerazol"], category: "Fitoterápico" },
  { genericName: "Mikania glomerata (Guaco)", brands: ["Guaco", "Xarope de Guaco"], category: "Fitoterápico" },
  { genericName: "Zingiber officinale (Gengibre)", brands: ["Gengibre", "Ginger", "Zingiber"], category: "Fitoterápico" },
  { genericName: "Curcuma longa (Cúrcuma)", brands: ["Cúrcuma", "Açafrão da terra", "Turmeric", "Curcumina"], category: "Fitoterápico" },
].filter(e => !already.has(e.genericName.toLowerCase()));

db.medications.push(...newPhyto);
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Added', newPhyto.length, 'phytotherapics. Total meds:', db.medications.length);

// ── 2. Interactions ──────────────────────────────────────────────────────────
const ints = JSON.parse(fs.readFileSync(intPath, 'utf8'));
let nextId = Math.max(...ints.map(i => parseInt(i.id.replace('int_', '')))) + 1;
const nid = () => { const n = nextId++; return 'int_' + String(n).padStart(3, '0'); };

const existingPairs = new Set(ints.map(i => i.drug1 + '||' + i.drug2));

const newInts = [
  // ── Hypericum perforatum ──
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Fluoxetina",
    risk_level: "critical", risk_description: "Síndrome serotoninérgica potencialmente fatal",
    mechanism: "Hypericum inibe a recaptação de serotonina. Combinado com ISRS como fluoxetina, causa acúmulo excessivo de serotonina. Pode resultar em síndrome serotoninérgica com agitação, tremores, hipertermia, taquicardia e, nos casos graves, convulsões e óbito. Uso concomitante contraindicado. Aguardar pelo menos 14 dias entre as terapias." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Sertralina",
    risk_level: "critical", risk_description: "Síndrome serotoninérgica potencialmente fatal",
    mechanism: "Hypericum combinado com sertralina (ISRS) potencializa excessivamente a neurotransmissão serotoninérgica. Casos relatados de síndrome serotoninérgica com mioclonias, hipertermia e instabilidade autonômica. Contraindicado. Suspender o fitoterápico antes de iniciar ISRS." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Paroxetina",
    risk_level: "critical", risk_description: "Síndrome serotoninérgica — contraindicado",
    mechanism: "Hypericum possui atividade inibitória da recaptação de serotonina. Combinado com paroxetina (ISRS potente), o risco de síndrome serotoninérgica é elevado. Uso concomitante contraindicado." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Ciclosporina",
    risk_level: "critical", risk_description: "Risco de rejeição de órgão transplantado",
    mechanism: "Hypericum induz fortemente a glicoproteína-P e o CYP3A4, reduzindo drasticamente os níveis de ciclosporina. Casos de perda de enxerto descritos na literatura. Uso absolutamente contraindicado em transplantados." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Varfarina",
    risk_level: "high", risk_description: "Redução da anticoagulação — risco de trombose",
    mechanism: "Hypericum induz o CYP2C9, aumentando o clearance da varfarina. O INR pode cair abruptamente, levando a eventos tromboembólicos. Monitorar o INR de perto ou evitar a combinação." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Digoxina",
    risk_level: "high", risk_description: "Redução do nível sérico de digoxina — falha terapêutica cardíaca",
    mechanism: "Hypericum induz a glicoproteína-P intestinal e renal, aumentando a eliminação da digoxina. Pode causar queda de até 25% nos níveis séricos, levando à perda do controle da frequência cardíaca. Monitorar nível de digoxina ou substituir o fitoterápico." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Etinilestradiol (Anticoncepcional oral)",
    risk_level: "high", risk_description: "Falha contraceptiva — risco de gravidez não planejada",
    mechanism: "Hypericum induz o CYP3A4 e a glicoproteína-P, acelerando o metabolismo dos anticoncepcionais hormonais. Casos de gravidez não planejada foram relatados. Usar método contraceptivo adicional de barreira durante e por pelo menos 4 semanas após o uso." },
  { id: nid(), drug1: "Hypericum perforatum (Erva de São João)", drug2: "Efavirenz",
    risk_level: "high", risk_description: "Redução da eficácia antirretroviral — risco de falha virológica",
    mechanism: "Hypericum induz o CYP3A4 e a glicoproteína-P, reduzindo os níveis de antirretrovirais em até 57%. Pode levar à falha virológica e resistência. Uso contraindicado em pacientes em terapia antirretroviral (TARV)." },
  // ── Ginkgo biloba ──
  { id: nid(), drug1: "Ginkgo biloba", drug2: "Varfarina",
    risk_level: "high", risk_description: "Aumento do risco de sangramento grave",
    mechanism: "Ginkgo inibe o fator ativador de plaquetas e prolonga o tempo de sangramento. Combinado com varfarina, potencializa o efeito anticoagulante. Relatos de hemorragias intracranianas graves. Suspender o Ginkgo 36–72h antes de procedimentos cirúrgicos." },
  { id: nid(), drug1: "Ginkgo biloba", drug2: "Ácido Acetilsalicílico",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento",
    mechanism: "Ginkgo possui efeito antiagregante plaquetário. Combinado com AAS, o efeito antiagregante é somado, aumentando o risco de sangramento gastrointestinal. Usar com cautela em idosos ou doses altas de AAS." },
  { id: nid(), drug1: "Ginkgo biloba", drug2: "Ibuprofeno",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento gastrointestinal",
    mechanism: "Ginkgo inibe a agregação plaquetária. AINEs como ibuprofeno prejudicam a função plaquetária e a mucosa gástrica. A combinação aumenta o risco de sangramento GI. Preferir paracetamol como analgésico." },
  // ── Panax ginseng ──
  { id: nid(), drug1: "Panax ginseng (Ginseng)", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Alteração do efeito anticoagulante",
    mechanism: "Ginseng pode interferir no INR de forma bidirecional via CYP2C9. Monitorar o INR com mais frequência ao iniciar ou suspender o ginseng." },
  { id: nid(), drug1: "Panax ginseng (Ginseng)", drug2: "Insulina",
    risk_level: "moderate", risk_description: "Risco de hipoglicemia",
    mechanism: "Ginseng possui propriedades hipoglicemiantes (estimula secreção de insulina e melhora sensibilidade periférica). Combinado com insulina, pode causar hipoglicemia. Monitorar a glicemia com maior frequência." },
  { id: nid(), drug1: "Panax ginseng (Ginseng)", drug2: "Metformina",
    risk_level: "moderate", risk_description: "Risco de hipoglicemia",
    mechanism: "Ginseng reduz a glicemia por mecanismos próprios. Combinado com metformina, pode potencializar o efeito hipoglicemiante. Monitorar glicemia e ajustar doses se necessário." },
  { id: nid(), drug1: "Panax ginseng (Ginseng)", drug2: "Glibenclamida",
    risk_level: "moderate", risk_description: "Risco de hipoglicemia grave",
    mechanism: "Ginseng combinado com sulfonilureias (glibenclamida), que estimulam a secreção de insulina, pode resultar em hipoglicemia grave. Monitorar intensivamente a glicemia." },
  { id: nid(), drug1: "Panax ginseng (Ginseng)", drug2: "Tranilcipromina",
    risk_level: "high", risk_description: "Risco de reação adversa grave (insônia, cefaleia, mania)",
    mechanism: "Ginseng pode modular monoaminas no SNC. Combinado com inibidores da MAO (tranilcipromina), pode causar insônia intensa, cefaleia, tremores e episódios maníacos. Uso concomitante contraindicado." },
  // ── Allium sativum ──
  { id: nid(), drug1: "Allium sativum (Alho medicinal)", drug2: "Varfarina",
    risk_level: "high", risk_description: "Aumento do risco de sangramento",
    mechanism: "Alho medicinal em doses terapêuticas inibe a agregação plaquetária e possui propriedades anticoagulantes. Combinado com varfarina, pode elevar o INR e aumentar o risco de sangramento. Suspender 7–10 dias antes de cirurgias." },
  { id: nid(), drug1: "Allium sativum (Alho medicinal)", drug2: "Ritonavir",
    risk_level: "high", risk_description: "Redução da eficácia do antirretroviral",
    mechanism: "Alho medicinal induz o CYP3A4 e a glicoproteína-P, reduzindo os níveis de antirretrovirais como ritonavir. Pode causar falha virológica. Evitar suplementos de alho em doses terapêuticas em pacientes em TARV." },
  // ── Glycyrrhiza glabra ──
  { id: nid(), drug1: "Glycyrrhiza glabra (Alcaçuz)", drug2: "Hidroclorotiazida",
    risk_level: "high", risk_description: "Hipocalemia grave — risco de arritmia",
    mechanism: "O ácido glicirrízico inibe a 11β-HSD2, causando pseudoaldosteronismo com perda de potássio. Combinado com tiazídicos (que também causam hipocalemia), o risco de arritmia cardíaca é elevado." },
  { id: nid(), drug1: "Glycyrrhiza glabra (Alcaçuz)", drug2: "Furosemida",
    risk_level: "high", risk_description: "Hipocalemia grave — risco de arritmia",
    mechanism: "Alcaçuz causa pseudoaldosteronismo (perda de potássio). Associado à furosemida, que também depleta potássio, pode causar hipocalemia grave com risco de arritmias ventriculares, especialmente em cardiopatas ou usuários de digoxina." },
  { id: nid(), drug1: "Glycyrrhiza glabra (Alcaçuz)", drug2: "Losartana",
    risk_level: "high", risk_description: "Antagonismo do efeito anti-hipertensivo",
    mechanism: "Alcaçuz causa retenção de sódio e água por pseudoaldosteronismo, antagonizando o efeito dos anti-hipertensivos (ARA II como losartana, IECAs). Pode resultar em hipertensão resistente ao tratamento." },
  { id: nid(), drug1: "Glycyrrhiza glabra (Alcaçuz)", drug2: "Prednisona",
    risk_level: "moderate", risk_description: "Potencialização dos efeitos corticosteroides",
    mechanism: "Alcaçuz inibe o metabolismo do cortisol, potencializando o efeito de corticosteroides como prednisona. Pode aumentar efeitos adversos: hiperglicemia, retenção hídrica, osteoporose e supressão adrenal." },
  // ── Valeriana officinalis ──
  { id: nid(), drug1: "Valeriana officinalis (Valeriana)", drug2: "Diazepam",
    risk_level: "high", risk_description: "Sedação excessiva do sistema nervoso central",
    mechanism: "Valeriana possui atividade GABAérgica (potencializa receptores GABA-A), similar aos benzodiazepínicos. A combinação com diazepam produz sedação aditiva ou sinérgica, com risco de depressão respiratória e quedas. Evitar o uso simultâneo." },
  { id: nid(), drug1: "Valeriana officinalis (Valeriana)", drug2: "Clonazepam",
    risk_level: "high", risk_description: "Sedação excessiva — risco de depressão respiratória",
    mechanism: "Valeriana potencializa a neurotransmissão GABAérgica de forma similar ao clonazepam. A combinação amplifica os efeitos sedativos, com risco de depressão respiratória, especialmente em idosos. Não usar concomitantemente." },
  { id: nid(), drug1: "Valeriana officinalis (Valeriana)", drug2: "Alprazolam",
    risk_level: "high", risk_description: "Sedação excessiva — risco de depressão respiratória",
    mechanism: "Ação GABAérgica da valeriana somada ao alprazolam (benzodiazepínico de alta potência) pode resultar em sedação intensa e risco de parada respiratória. Evitar a combinação, especialmente em idosos e pacientes com DPOC." },
  { id: nid(), drug1: "Valeriana officinalis (Valeriana)", drug2: "Álcool etílico",
    risk_level: "moderate", risk_description: "Potencialização da sedação central",
    mechanism: "Valeriana possui efeito depressor do SNC via receptores GABA-A. O álcool amplifica essa depressão, causando sonolência intensa e comprometimento dos reflexos. Evitar bebidas alcoólicas durante o uso de valeriana." },
  // ── Piper methysticum ──
  { id: nid(), drug1: "Piper methysticum (Kava Kava)", drug2: "Álcool etílico",
    risk_level: "high", risk_description: "Hepatotoxicidade grave",
    mechanism: "Kava Kava pode causar hepatotoxicidade idiossincrática (casos de hepatite fulminante relatados). O álcool amplifica a toxicidade hepática de forma sinérgica. A combinação está associada a casos de insuficiência hepática grave. Kava Kava está proibido em vários países europeus." },
  // ── Passiflora ──
  { id: nid(), drug1: "Passiflora incarnata (Maracujá)", drug2: "Clonazepam",
    risk_level: "moderate", risk_description: "Potencialização da sedação",
    mechanism: "Passiflora possui atividade ansiolítica e sedativa via flavonoides GABAérgicos. Combinada com benzodiazepínicos como clonazepam, pode potencializar a sedação e comprometer a atenção e coordenação motora. Evitar ao dirigir." },
  { id: nid(), drug1: "Passiflora incarnata (Maracujá)", drug2: "Alprazolam",
    risk_level: "moderate", risk_description: "Potencialização da sedação",
    mechanism: "Ação GABAérgica da passiflora pode somar-se ao efeito ansiolítico do alprazolam, causando sedação além do desejado. Monitorar sonolência diurna e evitar atividades que exigem atenção." },
  // ── Camellia sinensis ──
  { id: nid(), drug1: "Camellia sinensis (Chá verde)", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Redução do efeito anticoagulante",
    mechanism: "Chá verde contém vitamina K, que antagoniza a varfarina. Consumo excessivo pode reduzir o INR. Manter o consumo constante e monitorar o INR regularmente." },
  // ── Echinacea ──
  { id: nid(), drug1: "Echinacea purpurea (Equinácea)", drug2: "Ciclosporina",
    risk_level: "high", risk_description: "Redução da eficácia imunossupressora — risco de rejeição",
    mechanism: "Equinácea estimula a resposta imune (linfócitos, citocinas). Esse efeito imunoestimulante é antagonista da ciclosporina, podendo desencadear rejeição em transplantados. Contraindicado em imunossuprimidos." },
  { id: nid(), drug1: "Echinacea purpurea (Equinácea)", drug2: "Tacrolimus",
    risk_level: "high", risk_description: "Antagonismo do efeito imunossupressor — risco de rejeição",
    mechanism: "Equinácea imunoestimula o organismo por múltiplas vias, contrariando o tacrolimus. Pode causar rejeição de órgão ou agravamento de doença autoimune. Contraindicado em transplantados ou com doenças autoimunes tratadas com imunossupressores." },
  // ── Uncaria tomentosa ──
  { id: nid(), drug1: "Uncaria tomentosa (Unha de Gato)", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento",
    mechanism: "Unha de Gato possui propriedades antitrombóticas e antiagregantes. Combinada com varfarina, pode potencializar o efeito anticoagulante. Monitorar INR e suspender antes de cirurgias." },
  // ── Arnica montana ──
  { id: nid(), drug1: "Arnica montana", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento",
    mechanism: "Arnica oral contém helenalina com propriedades antiagregantes plaquetárias. Combinada com varfarina, pode potencializar a anticoagulação. Suspender arnica oral 7 dias antes de cirurgias." },
  // ── Curcuma longa ──
  { id: nid(), drug1: "Curcuma longa (Cúrcuma)", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento",
    mechanism: "Curcumina inibe a agregação plaquetária. Em suplementos (doses terapêuticas), combinada com varfarina, pode elevar o INR e aumentar o risco de sangramento. Monitorar INR ao usar suplementos de cúrcuma." },
  // ── Zingiber officinale ──
  { id: nid(), drug1: "Zingiber officinale (Gengibre)", drug2: "Varfarina",
    risk_level: "moderate", risk_description: "Aumento do risco de sangramento",
    mechanism: "Gengibre em doses terapêuticas (suplementos) inibe a tromboxano sintetase e a agregação plaquetária. Combinado com varfarina, pode elevar o INR. Monitorar INR e suspender suplementos 7–10 dias antes de cirurgias." },
].filter(e => !existingPairs.has(e.drug1 + '||' + e.drug2));

ints.push(...newInts);
fs.writeFileSync(intPath, JSON.stringify(ints, null, 2), 'utf8');
console.log('Added', newInts.length, 'interactions. Total:', ints.length);
