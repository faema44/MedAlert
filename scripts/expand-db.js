/**
 * Expande o medications-db.json:
 *  - Remove entradas inválidas do scraper
 *  - Adiciona medicamentos faltantes por classe terapêutica
 * Execute: node scripts/expand-db.js
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../src/data/medications-db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// ── 1. Remove lixo do scraper ────────────────────────────────────────────────
const BOGUS = new Set([
  'Busque por', 'Novidades no BulasMed', 'Bulas mais buscadas',
  'BulasMed App', 'Cadastre-se', 'BULASMED NAS REDES SOCIAIS',
]);
db.medications = db.medications.filter(m => m.category && !BOGUS.has(m.genericName));

// ── 2. Helper ────────────────────────────────────────────────────────────────
const existingNames = new Set(db.medications.map(m => m.genericName.toLowerCase()));

function add(entries) {
  for (const e of entries) {
    if (!existingNames.has(e.genericName.toLowerCase())) {
      db.medications.push(e);
      existingNames.add(e.genericName.toLowerCase());
    }
  }
}

// ── 3. Adições ───────────────────────────────────────────────────────────────

// Antidepressivos (complemento)
add([
  { genericName: 'Mirtazapina', brands: ['Remeron', 'Mirtazol', 'Mirtaz'], category: 'Antidepressivo' },
  { genericName: 'Bupropiona', brands: ['Wellbutrin', 'Zyban', 'Bup', 'Bupium'], category: 'Antidepressivo' },
  { genericName: 'Trazodona', brands: ['Trittico', 'Trazodil'], category: 'Antidepressivo' },
  { genericName: 'Fluvoxamina', brands: ['Luvox', 'Fevarin'], category: 'Antidepressivo' },
  { genericName: 'Agomelatina', brands: ['Valdoxan', 'Thymanax'], category: 'Antidepressivo' },
  { genericName: 'Vortioxetina', brands: ['Brintellix', 'Trintellix'], category: 'Antidepressivo' },
  { genericName: 'Levomilnaciprana', brands: ['Fetzima'], category: 'Antidepressivo' },
  { genericName: 'Vilazodona', brands: ['Viibryd'], category: 'Antidepressivo' },
  { genericName: 'Reboxetina', brands: ['Edronax'], category: 'Antidepressivo' },
  { genericName: 'Maprotilina', brands: ['Ludiomil'], category: 'Antidepressivo Tricíclico' },
  { genericName: 'Doxepina', brands: ['Sinequan', 'Deptran'], category: 'Antidepressivo Tricíclico' },
  { genericName: 'Trimipramina', brands: ['Surmontil'], category: 'Antidepressivo Tricíclico' },
]);

// Antipsicóticos (complemento)
add([
  { genericName: 'Ziprasidona', brands: ['Geodon', 'Zeldox'], category: 'Antipsicótico' },
  { genericName: 'Paliperidona', brands: ['Invega', 'Xeplion'], category: 'Antipsicótico' },
  { genericName: 'Lurasidona', brands: ['Latuda'], category: 'Antipsicótico' },
  { genericName: 'Amisulprida', brands: ['Solian'], category: 'Antipsicótico' },
  { genericName: 'Asenapina', brands: ['Saphris', 'Sycrest'], category: 'Antipsicótico' },
  { genericName: 'Brexpiprazol', brands: ['Rexulti'], category: 'Antipsicótico' },
  { genericName: 'Cariprazina', brands: ['Reagila', 'Vraylar'], category: 'Antipsicótico' },
  { genericName: 'Iloperidona', brands: ['Fanapt'], category: 'Antipsicótico' },
  { genericName: 'Clorpromazina', brands: ['Amplictil', 'Thorazine'], category: 'Antipsicótico' },
  { genericName: 'Levomepromazina', brands: ['Neozine', 'Nozinan'], category: 'Antipsicótico' },
  { genericName: 'Tioridazina', brands: ['Melleril'], category: 'Antipsicótico' },
  { genericName: 'Flufenazina', brands: ['Prolixin', 'Modecate'], category: 'Antipsicótico' },
  { genericName: 'Perfenazina', brands: ['Trilafon'], category: 'Antipsicótico' },
  { genericName: 'Pimozida', brands: ['Orap'], category: 'Antipsicótico' },
  { genericName: 'Sulpirida', brands: ['Equilid', 'Dogmatil'], category: 'Antipsicótico' },
]);

// Anticonvulsivantes (complemento)
add([
  { genericName: 'Oxcarbazepina', brands: ['Trileptal', 'Oxcarb'], category: 'Anticonvulsivante' },
  { genericName: 'Lacosamida', brands: ['Vimpat'], category: 'Anticonvulsivante' },
  { genericName: 'Zonisamida', brands: ['Zonegran'], category: 'Anticonvulsivante' },
  { genericName: 'Perampanel', brands: ['Fycompa'], category: 'Anticonvulsivante' },
  { genericName: 'Eslicarbazepina', brands: ['Zebinix'], category: 'Anticonvulsivante' },
  { genericName: 'Vigabatrina', brands: ['Sabril'], category: 'Anticonvulsivante' },
  { genericName: 'Primidona', brands: ['Mysoline', 'Primidon'], category: 'Anticonvulsivante' },
  { genericName: 'Etossuximida', brands: ['Zarontin'], category: 'Anticonvulsivante' },
  { genericName: 'Clobazam', brands: ['Frisium', 'Urbanyl'], category: 'Anticonvulsivante' },
  { genericName: 'Nitrazepam', brands: ['Mogadon'], category: 'Anticonvulsivante' },
  { genericName: 'Clonazepam', brands: ['Rivotril', 'Klonopin'], category: 'Anticonvulsivante' },
  { genericName: 'Rufinamida', brands: ['Inovelon', 'Banzel'], category: 'Anticonvulsivante' },
  { genericName: 'Canabidiol', brands: ['Epidiolex', 'Cannabis Medicinal'], category: 'Anticonvulsivante' },
]);

// TDAH
add([
  { genericName: 'Metilfenidato', brands: ['Ritalina', 'Ritalina LA', 'Concerta', 'Medikinet', 'Ritalin'], category: 'TDAH' },
  { genericName: 'Lisdexanfetamina', brands: ['Vyvanse', 'Elvanse'], category: 'TDAH' },
  { genericName: 'Atomoxetina', brands: ['Strattera', 'Tomoxetina'], category: 'TDAH' },
  { genericName: 'Guanfacina', brands: ['Intuniv', 'Tenex'], category: 'TDAH' },
]);

// Relaxantes musculares
add([
  { genericName: 'Ciclobenzaprina', brands: ['Miosan', 'Flexeril', 'Tensodox'], category: 'Relaxante Muscular' },
  { genericName: 'Carisoprodol', brands: ['Soma', 'Doril', 'Beserol'], category: 'Relaxante Muscular' },
  { genericName: 'Baclofeno', brands: ['Lioresal', 'Baclon'], category: 'Relaxante Muscular' },
  { genericName: 'Tizanidina', brands: ['Sirdalud', 'Ternelin'], category: 'Relaxante Muscular' },
  { genericName: 'Orfenadrina', brands: ['Norflex', 'Dorflex'], category: 'Relaxante Muscular' },
  { genericName: 'Metocarbamol', brands: ['Robaxin', 'Robaxisal'], category: 'Relaxante Muscular' },
  { genericName: 'Clorzoxazona', brands: ['Paraflex', 'Miorel'], category: 'Relaxante Muscular' },
  { genericName: 'Tolperisona', brands: ['Mydocalm'], category: 'Relaxante Muscular' },
  { genericName: 'Carisoprodol + Diclofenaco + Cafeína', brands: ['Torsilax', 'Miorrelax Plus'], category: 'Relaxante Muscular' },
  { genericName: 'Ciclobenzaprina + Diclofenaco', brands: ['Tandrilax'], category: 'Relaxante Muscular' },
]);

// Anti-Parkinsonianos (complemento)
add([
  { genericName: 'Pramipexol', brands: ['Mirapex', 'Sifrol', 'Pramipexol EMS'], category: 'Antiparkinsoniano' },
  { genericName: 'Ropinirol', brands: ['Requip', 'Adartrel'], category: 'Antiparkinsoniano' },
  { genericName: 'Rasagilina', brands: ['Azilect'], category: 'Antiparkinsoniano' },
  { genericName: 'Selegilina', brands: ['Eldepryl', 'Jumex'], category: 'Antiparkinsoniano' },
  { genericName: 'Entacapona', brands: ['Comtan'], category: 'Antiparkinsoniano' },
  { genericName: 'Levodopa + Carbidopa + Entacapona', brands: ['Stalevo'], category: 'Antiparkinsoniano' },
  { genericName: 'Amantadina', brands: ['Mantidan', 'Symmetrel'], category: 'Antiparkinsoniano' },
  { genericName: 'Biperideno', brands: ['Akineton'], category: 'Antiparkinsoniano' },
  { genericName: 'Prociclidina', brands: ['Kemadrin'], category: 'Antiparkinsoniano' },
  { genericName: 'Rotigotina', brands: ['Neupro'], category: 'Antiparkinsoniano' },
]);

// Respiratory – broncodilatadores e corticoides inalatórios (complemento)
add([
  { genericName: 'Indacaterol', brands: ['Onbrize Breezhaler', 'Arcapta'], category: 'Broncodilatador' },
  { genericName: 'Olodaterol', brands: ['Striverdi Respimat'], category: 'Broncodilatador' },
  { genericName: 'Umeclidínio', brands: ['Incruse Ellipta'], category: 'Broncodilatador' },
  { genericName: 'Aclidínio', brands: ['Bretaris Genuair', 'Tudorza'], category: 'Broncodilatador' },
  { genericName: 'Glicopirrônio', brands: ['Seebri Breezhaler', 'Enerzair'], category: 'Broncodilatador' },
  { genericName: 'Terbutalina', brands: ['Bricanyl'], category: 'Broncodilatador' },
  { genericName: 'Indacaterol + Glicopirrônio', brands: ['Ultibro Breezhaler', 'Xoterna'], category: 'Broncodilatador' },
  { genericName: 'Umeclidínio + Vilanterol', brands: ['Anoro Ellipta'], category: 'Broncodilatador' },
  { genericName: 'Tiotropio + Olodaterol', brands: ['Inspiolto Respimat', 'Spiolto'], category: 'Broncodilatador' },
  { genericName: 'Glicopirrônio + Formoterol', brands: ['Bevespi Aerosphere'], category: 'Broncodilatador' },
  { genericName: 'Ciclesonida', brands: ['Alvesco'], category: 'Corticosteroide Inalatório' },
  { genericName: 'Mometasona Inalatória', brands: ['Asmanex', 'Dulera'], category: 'Corticosteroide Inalatório' },
  { genericName: 'Fluticasona + Vilanterol', brands: ['Relvar Ellipta', 'Breo Ellipta'], category: 'Broncodilatador + Corticosteroide' },
  { genericName: 'Fluticasona + Umeclidínio + Vilanterol', brands: ['Trelegy Ellipta'], category: 'Broncodilatador + Corticosteroide' },
  { genericName: 'Budesonida + Formoterol + Glicopirrônio', brands: ['Breztri Aerosphere', 'Trixeo'], category: 'Broncodilatador + Corticosteroide' },
  { genericName: 'Mometasona + Formoterol', brands: ['Dulera', 'Zenhale'], category: 'Broncodilatador + Corticosteroide' },
  { genericName: 'Montelucaste', brands: ['Singulair', 'Montelair', 'Monovin'], category: 'Anti-leucotrieno' },
  { genericName: 'Teofilina', brands: ['Aminofilina', 'Teolong'], category: 'Broncodilatador' },
  { genericName: 'Omalizumabe', brands: ['Xolair'], category: 'Imunobiológico' },
  { genericName: 'Dupilumabe', brands: ['Dupixent'], category: 'Imunobiológico' },
  { genericName: 'Mepolizumabe', brands: ['Nucala'], category: 'Imunobiológico' },
  { genericName: 'Benralizumabe', brands: ['Fasenra'], category: 'Imunobiológico' },
]);

// Anti-histamínicos (complemento)
add([
  { genericName: 'Desloratadina', brands: ['Desalex', 'Aerius', 'Desloratamed'], category: 'Anti-histamínico' },
  { genericName: 'Levocetirizina', brands: ['Zyxem', 'Zirtec', 'Xuzal'], category: 'Anti-histamínico' },
  { genericName: 'Bilastina', brands: ['Blokium', 'Bilaxten'], category: 'Anti-histamínico' },
  { genericName: 'Rupatadina', brands: ['Rupafin'], category: 'Anti-histamínico' },
  { genericName: 'Ebastina', brands: ['Ebastel', 'Kestine'], category: 'Anti-histamínico' },
  { genericName: 'Hidroxizina', brands: ['Atarax', 'Hixizine'], category: 'Anti-histamínico' },
  { genericName: 'Prometazina', brands: ['Fenergan', 'Amplictil'], category: 'Anti-histamínico' },
  { genericName: 'Difenidramina', brands: ['Benadryl', 'Benotan'], category: 'Anti-histamínico' },
  { genericName: 'Clemastina', brands: ['Tavist'], category: 'Anti-histamínico' },
  { genericName: 'Mequitazina', brands: ['Primalan'], category: 'Anti-histamínico' },
]);

// Mucolíticos e antitussígenos
add([
  { genericName: 'N-Acetilcisteína', brands: ['Fluimucil', 'Mucosolvan', 'Acetilcisteína'], category: 'Mucolítico' },
  { genericName: 'Ambroxol', brands: ['Mucosolvan', 'Mucovit', 'Ambrol'], category: 'Mucolítico' },
  { genericName: 'Bromexina', brands: ['Bisolvon', 'Bisolbrume'], category: 'Mucolítico' },
  { genericName: 'Erdosteína', brands: ['Iretus', 'Erdomed'], category: 'Mucolítico' },
  { genericName: 'Carbocisteína', brands: ['Mucofluid', 'Rhinathiol'], category: 'Mucolítico' },
  { genericName: 'Dextran', brands: ['Benfeito'], category: 'Mucolítico' },
  { genericName: 'Dextrometorfano', brands: ['Robitussin', 'Histamin'], category: 'Antitussígeno' },
  { genericName: 'Levodropropizina', brands: ['Levopront', 'Antuss'], category: 'Antitussígeno' },
  { genericName: 'Clobutinol', brands: ['Silomat'], category: 'Antitussígeno' },
  { genericName: 'Benzonatato', brands: ['Tessalon'], category: 'Antitussígeno' },
]);

// Antieméticos e procinéticos
add([
  { genericName: 'Ondansetrona', brands: ['Zofran', 'Vonau', 'Odansetron'], category: 'Antiemético' },
  { genericName: 'Granisetrona', brands: ['Kytril', 'Granisetron'], category: 'Antiemético' },
  { genericName: 'Palonosetrona', brands: ['Aloxi'], category: 'Antiemético' },
  { genericName: 'Metoclopramida', brands: ['Plasil', 'Reglan'], category: 'Antiemético/Procinético' },
  { genericName: 'Domperidona', brands: ['Motilium', 'Motildon'], category: 'Antiemético/Procinético' },
  { genericName: 'Bromoprida', brands: ['Digesan', 'Bromoprida EMS'], category: 'Antiemético/Procinético' },
  { genericName: 'Dimenidrinato', brands: ['Dramin', 'Dramin B6'], category: 'Antiemético' },
  { genericName: 'Escopolamina', brands: ['Transcope', 'Buscapina'], category: 'Antiemético' },
  { genericName: 'Aprepitanto', brands: ['Emend'], category: 'Antiemético' },
  { genericName: 'Netupitanto + Palonosetrona', brands: ['Akynzeo'], category: 'Antiemético' },
  { genericName: 'Dronabinol', brands: ['Marinol'], category: 'Antiemético' },
]);

// GI – antiespasmódicos e protetores
add([
  { genericName: 'Butilescopolamina', brands: ['Buscopan', 'Buscapan'], category: 'Antiespasmódico' },
  { genericName: 'Mebeverina', brands: ['Duspatalin', 'Colotal'], category: 'Antiespasmódico' },
  { genericName: 'Pinavério', brands: ['Dicetel'], category: 'Antiespasmódico' },
  { genericName: 'Diciclomina', brands: ['Bentyl', 'Mergenzil'], category: 'Antiespasmódico' },
  { genericName: 'Trimebutina', brands: ['Debridat', 'Bumetin'], category: 'Antiespasmódico' },
  { genericName: 'Dipirona + Butilescopolamina', brands: ['Buscopan Composto', 'Espasmolar Plus'], category: 'Antiespasmódico' },
  { genericName: 'Mesalazina', brands: ['Asacol', 'Pentasa', 'Mesacol'], category: 'Anti-inflamatório Intestinal' },
  { genericName: 'Sulfassalazina', brands: ['Salazopyrin', 'Azulfidine'], category: 'Anti-inflamatório Intestinal' },
  { genericName: 'Budesonida Oral', brands: ['Entocort', 'Budesonida Oral'], category: 'Anti-inflamatório Intestinal' },
  { genericName: 'Infliximabe (Crohn)', brands: ['Remicade', 'Inflectra'], category: 'Imunobiológico' },
  { genericName: 'Vedolizumabe', brands: ['Entyvio'], category: 'Imunobiológico' },
  { genericName: 'Ustecinumabe', brands: ['Stelara'], category: 'Imunobiológico' },
]);

// Laxativos e constipação
add([
  { genericName: 'Lactulose', brands: ['Lactulose', 'Constilac', 'Duphalac'], category: 'Laxativo' },
  { genericName: 'Polietilenoglicol', brands: ['Movicol', 'Muvinlax', 'Glycolax'], category: 'Laxativo' },
  { genericName: 'Bisacodil', brands: ['Dulcolax', 'Bisacodil'], category: 'Laxativo' },
  { genericName: 'Picossulfato de Sódio', brands: ['Laxoberon', 'Evacuol'], category: 'Laxativo' },
  { genericName: 'Sene', brands: ['Tamarine', 'Herbalax'], category: 'Laxativo' },
  { genericName: 'Plantago Ovata', brands: ['Metamucil', 'Psyllium'], category: 'Laxativo' },
  { genericName: 'Linaclotida', brands: ['Linzess', 'Constella'], category: 'Laxativo/Pró-secretório' },
  { genericName: 'Lubiprostona', brands: ['Amitiza'], category: 'Laxativo/Pró-secretório' },
  { genericName: 'Loperamida', brands: ['Imosec', 'Imodium'], category: 'Antidiarreico' },
  { genericName: 'Raceadotril', brands: ['Tiorfix', 'Hidrasec'], category: 'Antidiarreico' },
  { genericName: 'Rifaximina', brands: ['Xifaxan', 'Rifacol'], category: 'Antibiótico Intestinal' },
]);

// H2 e outros gastroprotetores
add([
  { genericName: 'Famotidina', brands: ['Famox', 'Pepcid', 'Famoxal'], category: 'Gastroprotetor' },
  { genericName: 'Cimetidina', brands: ['Tagamet'], category: 'Gastroprotetor' },
  { genericName: 'Sucralfato', brands: ['Sulcrafato', 'Carafate'], category: 'Gastroprotetor' },
  { genericName: 'Vonoprazana', brands: ['Takecab', 'Voquezna'], category: 'Gastroprotetor' },
  { genericName: 'Misoprostol', brands: ['Cytotec'], category: 'Gastroprotetor' },
  { genericName: 'Ácido Ursodesoxicólico', brands: ['Ursacol', 'Urso', 'Ursodiol'], category: 'Hepatoprotetor' },
  { genericName: 'Silimarina', brands: ['Legalon', 'Siliver'], category: 'Hepatoprotetor' },
]);

// Antibióticos (complemento)
add([
  { genericName: 'Doxiciclina', brands: ['Vibramicina', 'Doxitrat', 'Doxiciclina EMS'], category: 'Antibiótico' },
  { genericName: 'Minociclina', brands: ['Minomycin', 'Minocin'], category: 'Antibiótico' },
  { genericName: 'Sulfametoxazol + Trimetoprima', brands: ['Bactrim', 'Sulfatrim', 'Septra'], category: 'Antibiótico' },
  { genericName: 'Nitrofurantoína', brands: ['Macrodantina', 'Macrobid'], category: 'Antibiótico' },
  { genericName: 'Fosfomicina', brands: ['Monuril', 'Fosfocina'], category: 'Antibiótico' },
  { genericName: 'Vancomicina', brands: ['Vancocin', 'Vancomicina EMS'], category: 'Antibiótico' },
  { genericName: 'Clindamicina', brands: ['Dalacin C', 'Clindacin'], category: 'Antibiótico' },
  { genericName: 'Linezolida', brands: ['Zyvox', 'Linezolida EMS'], category: 'Antibiótico' },
  { genericName: 'Cefepima', brands: ['Maxcef', 'Cefepima EMS'], category: 'Antibiótico' },
  { genericName: 'Ceftazidima', brands: ['Fortaz', 'Ceftazidima EMS'], category: 'Antibiótico' },
  { genericName: 'Cefixima', brands: ['Cefspan', 'Cefixima'], category: 'Antibiótico' },
  { genericName: 'Cefadroxil', brands: ['Droxil', 'Cefadroxil EMS'], category: 'Antibiótico' },
  { genericName: 'Ceftarolina', brands: ['Teflaro', 'Zinforo'], category: 'Antibiótico' },
  { genericName: 'Meropeném', brands: ['Meronem', 'Meropenem EMS'], category: 'Antibiótico' },
  { genericName: 'Imipeném + Cilastatina', brands: ['Tienam'], category: 'Antibiótico' },
  { genericName: 'Ertapeném', brands: ['Invanz'], category: 'Antibiótico' },
  { genericName: 'Rifampicina', brands: ['Rifampin', 'Rifocina'], category: 'Antibiótico/Antituberculoso' },
  { genericName: 'Isoniazida', brands: ['INH', 'Isoniazida EMS'], category: 'Antituberculoso' },
  { genericName: 'Etambutol', brands: ['Myambutol', 'Etambutol EMS'], category: 'Antituberculoso' },
  { genericName: 'Pirazinamida', brands: ['PZA', 'Pirazinamida EMS'], category: 'Antituberculoso' },
  { genericName: 'Rifampicina + Isoniazida + Pirazinamida + Etambutol', brands: ['RHZE', 'Rifinah'], category: 'Antituberculoso' },
  { genericName: 'Dapsona', brands: ['Dapsona EMS'], category: 'Antibiótico' },
  { genericName: 'Cloranfenicol', brands: ['Quemicetina', 'Cloranfenicol'], category: 'Antibiótico' },
  { genericName: 'Teicoplanina', brands: ['Targocid'], category: 'Antibiótico' },
  { genericName: 'Daptomicina', brands: ['Cubicin'], category: 'Antibiótico' },
  { genericName: 'Tigecilina', brands: ['Tygacil'], category: 'Antibiótico' },
  { genericName: 'Colistina', brands: ['Coly-Mycin', 'Colistina EMS'], category: 'Antibiótico' },
]);

// Antifúngicos (complemento)
add([
  { genericName: 'Terbinafina', brands: ['Lamisil', 'Terbinafina EMS'], category: 'Antifúngico' },
  { genericName: 'Anfotericina B', brands: ['Fungizone', 'Abelcet', 'AmBisome'], category: 'Antifúngico' },
  { genericName: 'Griseofulvina', brands: ['Grisovin', 'Fulvicin'], category: 'Antifúngico' },
  { genericName: 'Cetoconazol', brands: ['Nizoral', 'Cetoconazol EMS'], category: 'Antifúngico' },
  { genericName: 'Caspofungina', brands: ['Cancidas'], category: 'Antifúngico' },
  { genericName: 'Micafungina', brands: ['Mycamine'], category: 'Antifúngico' },
  { genericName: 'Anidulafungina', brands: ['Ecalta', 'Eraxis'], category: 'Antifúngico' },
  { genericName: 'Posaconazol', brands: ['Noxafil'], category: 'Antifúngico' },
  { genericName: 'Isavuconazol', brands: ['Cresemba'], category: 'Antifúngico' },
  { genericName: 'Nistatina', brands: ['Mycostatin', 'Nistatina EMS'], category: 'Antifúngico' },
]);

// Antivirais
add([
  { genericName: 'Aciclovir', brands: ['Zovirax', 'Aciclovir EMS', 'Herpevir'], category: 'Antiviral' },
  { genericName: 'Valaciclovir', brands: ['Valtrex', 'Valaciclovir EMS'], category: 'Antiviral' },
  { genericName: 'Fanciclovir', brands: ['Famvir'], category: 'Antiviral' },
  { genericName: 'Ganciclovir', brands: ['Cymevene', 'Cytovene'], category: 'Antiviral' },
  { genericName: 'Oseltamivir', brands: ['Tamiflu'], category: 'Antiviral' },
  { genericName: 'Zanamivir', brands: ['Relenza'], category: 'Antiviral' },
  { genericName: 'Sofosbuvir', brands: ['Sovaldi', 'Epclusa'], category: 'Antiviral (Hepatite C)' },
  { genericName: 'Sofosbuvir + Velpatasvir', brands: ['Epclusa'], category: 'Antiviral (Hepatite C)' },
  { genericName: 'Glecaprevir + Pibrentasvir', brands: ['Mavyret'], category: 'Antiviral (Hepatite C)' },
  { genericName: 'Ledipasvir + Sofosbuvir', brands: ['Harvoni'], category: 'Antiviral (Hepatite C)' },
  { genericName: 'Tenofovir', brands: ['Viread', 'Tenofovir EMS'], category: 'Antiviral (Hepatite B / HIV)' },
  { genericName: 'Entecavir', brands: ['Baraclude'], category: 'Antiviral (Hepatite B)' },
  { genericName: 'Tenofovir + Emtricitabina', brands: ['Truvada', 'Descovy'], category: 'Antirretroviral' },
  { genericName: 'Tenofovir + Emtricitabina + Efavirenz', brands: ['Atripla'], category: 'Antirretroviral' },
  { genericName: 'Tenofovir + Emtricitabina + Dolutegravir', brands: ['Triumeq', 'Biktarvy'], category: 'Antirretroviral' },
  { genericName: 'Dolutegravir', brands: ['Tivicay'], category: 'Antirretroviral' },
  { genericName: 'Bictegravir + Emtricitabina + TAF', brands: ['Biktarvy'], category: 'Antirretroviral' },
  { genericName: 'Raltegravir', brands: ['Isentress'], category: 'Antirretroviral' },
  { genericName: 'Lopinavir + Ritonavir', brands: ['Kaletra'], category: 'Antirretroviral' },
  { genericName: 'Darunavir', brands: ['Prezista'], category: 'Antirretroviral' },
  { genericName: 'Ritonavir', brands: ['Norvir'], category: 'Antirretroviral' },
  { genericName: 'Efavirenz', brands: ['Stocrin', 'Sustiva'], category: 'Antirretroviral' },
  { genericName: 'Nevirapina', brands: ['Viramune'], category: 'Antirretroviral' },
]);

// Antiparasitários
add([
  { genericName: 'Albendazol', brands: ['Zentel', 'Albendazol EMS'], category: 'Antiparasitário' },
  { genericName: 'Mebendazol', brands: ['Pantelmin', 'Mebendazol EMS'], category: 'Antiparasitário' },
  { genericName: 'Ivermectina', brands: ['Stromectol', 'Revectina', 'Mectimax'], category: 'Antiparasitário' },
  { genericName: 'Praziquantel', brands: ['Biltricide', 'Cestox'], category: 'Antiparasitário' },
  { genericName: 'Nitazoxanida', brands: ['Annita', 'Alinia'], category: 'Antiparasitário' },
  { genericName: 'Metronidazol (antiparasitário)', brands: ['Flagyl', 'Metronix'], category: 'Antiparasitário' },
  { genericName: 'Cloroquina', brands: ['Reuquinol', 'Cloroquina EMS'], category: 'Antiparasitário/Antimalárico' },
  { genericName: 'Hidroxicloroquina', brands: ['Plaquinol', 'Quinerva'], category: 'Antiparasitário/Imunorregulador' },
  { genericName: 'Primaquina', brands: ['Primaquina EMS'], category: 'Antimalárico' },
  { genericName: 'Artemeter + Lumefantrina', brands: ['Coartem', 'Riamet'], category: 'Antimalárico' },
  { genericName: 'Pirimetamina', brands: ['Daraprim'], category: 'Antiprotozoário' },
]);

// Oftalmológicos
add([
  { genericName: 'Latanoprost', brands: ['Xalatan', 'Latanoprost EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Bimatoprost', brands: ['Lumigan', 'Bimatoprost EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Travoprost', brands: ['Travatan'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Tafluprost', brands: ['Saflutan', 'Taflotan'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Timolol Ocular', brands: ['Timoptol', 'Timolol EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Brimonidina', brands: ['Alphagan', 'Brimonidina EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Dorzolamida', brands: ['Trusopt', 'Dorzolamida EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Brinzolamida', brands: ['Azopt', 'Brinzolamida EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Dorzolamida + Timolol', brands: ['Cosopt', 'Dorzolamida+Timolol EMS'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Bimatoprost + Timolol', brands: ['Ganfort'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Latanoprost + Timolol', brands: ['Xalacom', 'Latanoprost+Timolol'], category: 'Oftalmológico (glaucoma)' },
  { genericName: 'Nepafenaco', brands: ['Nevanac', 'Nepafenaco EMS'], category: 'Oftalmológico (anti-inflamatório)' },
  { genericName: 'Cetorolaco Ocular', brands: ['Acular', 'Cetorolaco EMS'], category: 'Oftalmológico (anti-inflamatório)' },
  { genericName: 'Prednisolona Ocular', brands: ['Predfort', 'Pred Forte'], category: 'Oftalmológico (anti-inflamatório)' },
  { genericName: 'Dexametasona Ocular', brands: ['Maxidex', 'Tobradex'], category: 'Oftalmológico (anti-inflamatório)' },
  { genericName: 'Tobramicina + Dexametasona', brands: ['Tobradex', 'Tobrasone'], category: 'Oftalmológico' },
  { genericName: 'Ciprofloxacino Ocular', brands: ['Ciloxan', 'Cipro HC'], category: 'Oftalmológico (antibiótico)' },
  { genericName: 'Moxifloxacino Ocular', brands: ['Vigamox', 'Moxeza'], category: 'Oftalmológico (antibiótico)' },
  { genericName: 'Ranibizumabe', brands: ['Lucentis'], category: 'Oftalmológico (anti-VEGF)' },
  { genericName: 'Bevacizumabe', brands: ['Avastin'], category: 'Oftalmológico (anti-VEGF) / Oncológico' },
  { genericName: 'Aflibercept', brands: ['Eylea', 'Zaltrap'], category: 'Oftalmológico (anti-VEGF)' },
]);

// Bexiga hiperativa e alfa-bloqueadores
add([
  { genericName: 'Solifenacina', brands: ['Vesicare', 'Solifen'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Tolterodina', brands: ['Detrol', 'Uroton'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Oxibutinina', brands: ['Ditropan', 'Oxibutinina EMS'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Fesoterodina', brands: ['Toviaz'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Mirabegrona', brands: ['Betmiga', 'Myrbetriq'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Imidafenacina', brands: ['Uritos'], category: 'Urológico (bexiga hiperativa)' },
  { genericName: 'Doxazosina', brands: ['Cardura', 'Doxazomed'], category: 'Urológico/Anti-hipertensivo' },
  { genericName: 'Terazosina', brands: ['Hytrin', 'Itrin'], category: 'Urológico/Anti-hipertensivo' },
  { genericName: 'Alfuzosina', brands: ['Xatral', 'Alfuzosin'], category: 'Urológico' },
  { genericName: 'Silodosina', brands: ['Urorec', 'Silodosina EMS'], category: 'Urológico' },
  { genericName: 'Dutasterida + Tansulosina', brands: ['Duodart', 'Jalyn'], category: 'Urológico' },
  { genericName: 'Desmopressina', brands: ['DDAVP', 'Minirin'], category: 'Urológico/Hormonal' },
  { genericName: 'Vardenafila', brands: ['Levitra', 'Vivanza'], category: 'Urológico/Cardiovascular' },
  { genericName: 'Avanafila', brands: ['Stendra', 'Spedra'], category: 'Urológico' },
  { genericName: 'Alfaprostadil', brands: ['Caverject', 'MUSE'], category: 'Urológico' },
]);

// Hormônios e contraceptivos
add([
  { genericName: 'Estradiol', brands: ['Estradot', 'Climara', 'Progynon'], category: 'Hormônio Feminino' },
  { genericName: 'Progesterona', brands: ['Utrogestan', 'Prometrium', 'Crinone'], category: 'Hormônio Feminino' },
  { genericName: 'Tibolona', brands: ['Livial', 'Tibocina'], category: 'Hormônio Feminino' },
  { genericName: 'Noretisterona', brands: ['Primolut-Nor', 'Noregyna'], category: 'Contraceptivo/Hormonal' },
  { genericName: 'Levonorgestrel', brands: ['Postinor', 'Plan B', 'Mirena'], category: 'Contraceptivo' },
  { genericName: 'Desogestrel', brands: ['Cerazette', 'Nactali'], category: 'Contraceptivo' },
  { genericName: 'Drospirenona + Etinilestradiol', brands: ['Yasmin', 'Yaz', 'Elani Ciclo'], category: 'Contraceptivo' },
  { genericName: 'Gestodeno + Etinilestradiol', brands: ['Harmonet', 'Gynera', 'Minulet'], category: 'Contraceptivo' },
  { genericName: 'Levonorgestrel + Etinilestradiol', brands: ['Microvlar', 'Nordette', 'Triphasil'], category: 'Contraceptivo' },
  { genericName: 'Desogestrel + Etinilestradiol', brands: ['Mercilon', 'Marvelon'], category: 'Contraceptivo' },
  { genericName: 'Norelgestromina + Etinilestradiol', brands: ['Evra', 'Ortho Evra'], category: 'Contraceptivo' },
  { genericName: 'Etonogestrel', brands: ['Implanon', 'Nexplanon'], category: 'Contraceptivo' },
  { genericName: 'Etonogestrel + Etinilestradiol', brands: ['NuvaRing'], category: 'Contraceptivo' },
  { genericName: 'Testosterona', brands: ['Nebido', 'Durateston', 'Androgel'], category: 'Hormônio Masculino' },
  { genericName: 'DHEA (Desidroepiandrosterona)', brands: ['Fidelin', 'Prasteron'], category: 'Hormônio' },
  { genericName: 'Somatropina (GH)', brands: ['Genotropin', 'Norditropin', 'Saizen'], category: 'Hormônio' },
]);

// Osteoporose (complemento)
add([
  { genericName: 'Zoledronato', brands: ['Zometa', 'Aclasta', 'Zoledrônico'], category: 'Osteoporose' },
  { genericName: 'Denosumabe', brands: ['Prolia', 'Xgeva'], category: 'Osteoporose/Oncológico' },
  { genericName: 'Teriparatida', brands: ['Forteo', 'Terrosa'], category: 'Osteoporose' },
  { genericName: 'Raloxifeno', brands: ['Evista', 'Optruma'], category: 'Osteoporose/Antineoplásico' },
  { genericName: 'Romosozumabe', brands: ['Evenity'], category: 'Osteoporose' },
  { genericName: 'Carbonato de Cálcio', brands: ['Caltrate', 'Calcigenol', 'Os-Cal'], category: 'Suplemento' },
  { genericName: 'Carbonato de Cálcio + Vitamina D', brands: ['Cálcio + D', 'Caltrate D', 'Os-Cal D'], category: 'Suplemento' },
]);

// Reumatológicos (complemento)
add([
  { genericName: 'Azatioprina', brands: ['Imuran', 'Imunossupress'], category: 'Imunossupressor' },
  { genericName: 'Micofenolato de Mofetila', brands: ['CellCept', 'Mofetil'], category: 'Imunossupressor' },
  { genericName: 'Micofenolato de Sódio', brands: ['Myfortic'], category: 'Imunossupressor' },
  { genericName: 'Sirolimo', brands: ['Rapamune'], category: 'Imunossupressor' },
  { genericName: 'Everolimo', brands: ['Certican', 'Zortress', 'Afinitor'], category: 'Imunossupressor/Oncológico' },
  { genericName: 'Leflunomida', brands: ['Arava', 'Leflunomida EMS'], category: 'DMARD' },
  { genericName: 'Rituximabe', brands: ['MabThera', 'Rixathon'], category: 'Imunobiológico' },
  { genericName: 'Abatacepte', brands: ['Orencia'], category: 'Imunobiológico' },
  { genericName: 'Tocilizumabe', brands: ['Actemra', 'RoActemra'], category: 'Imunobiológico' },
  { genericName: 'Secuquinumabe', brands: ['Cosentyx'], category: 'Imunobiológico' },
  { genericName: 'Ixequizumabe', brands: ['Taltz'], category: 'Imunobiológico' },
  { genericName: 'Golimumabe', brands: ['Simponi'], category: 'Imunobiológico' },
  { genericName: 'Certolizumabe', brands: ['Cimzia'], category: 'Imunobiológico' },
  { genericName: 'Belimumabe', brands: ['Benlysta'], category: 'Imunobiológico' },
  { genericName: 'Barisitinibe', brands: ['Olumiant'], category: 'Inibidor JAK' },
  { genericName: 'Tofacitinibe', brands: ['Xeljanz'], category: 'Inibidor JAK' },
  { genericName: 'Upadacitinibe', brands: ['Rinvoq'], category: 'Inibidor JAK' },
  { genericName: 'Filgotinibe', brands: ['Jyseleca'], category: 'Inibidor JAK' },
  { genericName: 'Colchicina (gota)', brands: ['Colchimed', 'Colchicina EMS'], category: 'Antigotoso' },
]);

// Oncológicos (complemento)
add([
  { genericName: 'Capecitabina', brands: ['Xeloda', 'Capecitabina EMS'], category: 'Oncológico' },
  { genericName: 'Imatinibe', brands: ['Gleevec', 'Glivec', 'Imatinibe EMS'], category: 'Oncológico' },
  { genericName: 'Erlotinibe', brands: ['Tarceva'], category: 'Oncológico' },
  { genericName: 'Gefitinibe', brands: ['Iressa'], category: 'Oncológico' },
  { genericName: 'Osimertinibe', brands: ['Tagrisso'], category: 'Oncológico' },
  { genericName: 'Sunitinibe', brands: ['Sutent'], category: 'Oncológico' },
  { genericName: 'Sorafenibe', brands: ['Nexavar'], category: 'Oncológico' },
  { genericName: 'Lenalidomida', brands: ['Revlimid'], category: 'Oncológico' },
  { genericName: 'Talidomida', brands: ['Thalidomide', 'Talidomida Celgene'], category: 'Oncológico/Imunomodulador' },
  { genericName: 'Bortezomibe', brands: ['Velcade'], category: 'Oncológico' },
  { genericName: 'Carboplatina', brands: ['Paraplatin', 'Carboplatina EMS'], category: 'Oncológico' },
  { genericName: 'Cisplatina', brands: ['Platinol', 'Cisplatina EMS'], category: 'Oncológico' },
  { genericName: 'Paclitaxel', brands: ['Taxol', 'Paclitaxel EMS'], category: 'Oncológico' },
  { genericName: 'Docetaxel', brands: ['Taxotere', 'Docetaxel EMS'], category: 'Oncológico' },
  { genericName: 'Doxorrubicina', brands: ['Adriamycin', 'Caelyx'], category: 'Oncológico' },
  { genericName: 'Ciclofosfamida', brands: ['Cytoxan', 'Endoxan'], category: 'Oncológico' },
  { genericName: 'Metotrexato (oncológico)', brands: ['MTX', 'Methotrexate'], category: 'Oncológico/DMARD' },
  { genericName: 'Pembrolizumabe', brands: ['Keytruda'], category: 'Oncológico (imunoterapia)' },
  { genericName: 'Nivolumabe', brands: ['Opdivo'], category: 'Oncológico (imunoterapia)' },
  { genericName: 'Atezolizumabe', brands: ['Tecentriq'], category: 'Oncológico (imunoterapia)' },
  { genericName: 'Trastuzumabe', brands: ['Herceptin', 'Kanjinti'], category: 'Oncológico' },
  { genericName: 'Bevacizumabe (oncológico)', brands: ['Avastin'], category: 'Oncológico' },
  { genericName: 'Cetuximabe', brands: ['Erbitux'], category: 'Oncológico' },
]);

// Analgésicos (complemento)
add([
  { genericName: 'Nimesulida', brands: ['Nisulid', 'Sulid', 'Nimesil'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Piroxicam', brands: ['Feldene', 'Piroxicam EMS'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Indometacina', brands: ['Indocid', 'Indometacina EMS'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Tenoxicam', brands: ['Tilatil', 'Tenoxil'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Lornoxicam', brands: ['Xefo', 'Lornox'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Cetorolaco', brands: ['Toradol', 'Toragesic'], category: 'Anti-inflamatório (AINE)' },
  { genericName: 'Parecoxibe', brands: ['Dynastat'], category: 'Anti-inflamatório (COX-2)' },
  { genericName: 'Fentanila', brands: ['Durogesic', 'Fentanest'], category: 'Analgésico Opioide' },
  { genericName: 'Buprenorfina', brands: ['Temgesic', 'Buprenex', 'Belbuca'], category: 'Analgésico Opioide' },
  { genericName: 'Metadona', brands: ['Metadona EMS', 'Methadone'], category: 'Analgésico Opioide' },
  { genericName: 'Hidrocodona', brands: ['Vicodin', 'Norco'], category: 'Analgésico Opioide' },
  { genericName: 'Nalbufina', brands: ['Nubain'], category: 'Analgésico Opioide' },
  { genericName: 'Naloxona', brands: ['Narcan', 'Kloxxado'], category: 'Antagonista Opioide' },
  { genericName: 'Naltrexona', brands: ['Revia', 'Vivitrol'], category: 'Antagonista Opioide' },
  { genericName: 'Tapentadol', brands: ['Palexia', 'Nucynta'], category: 'Analgésico Opioide' },
  { genericName: 'Paracetamol + Codeína', brands: ['Tylex', 'Codamin'], category: 'Analgésico' },
  { genericName: 'Dipirona + Orfenadrina + Cafeína', brands: ['Dorflex'], category: 'Analgésico' },
  { genericName: 'Dipirona + Butilescopolamina', brands: ['Buscopan Composto'], category: 'Analgésico/Antiespasmódico' },
]);

// Cardiovascular (complemento)
add([
  { genericName: 'Propafenona', brands: ['Rytmonorm', 'Ritmonorm'], category: 'Antiarrítmico' },
  { genericName: 'Sotalol', brands: ['Sotacor', 'Betapace'], category: 'Antiarrítmico' },
  { genericName: 'Flecainida', brands: ['Tambocor'], category: 'Antiarrítmico' },
  { genericName: 'Dronedarona', brands: ['Multaq'], category: 'Antiarrítmico' },
  { genericName: 'Ivabradina', brands: ['Procoralan', 'Coralan'], category: 'Cardiovascular' },
  { genericName: 'Sacubitril + Valsartana', brands: ['Entresto'], category: 'Cardiovascular (IC)' },
  { genericName: 'Tolvaptana', brands: ['Samsca', 'Jinarc'], category: 'Cardiovascular' },
  { genericName: 'Bosentana', brands: ['Tracleer'], category: 'Hipertensão Pulmonar' },
  { genericName: 'Macitentan', brands: ['Opsumit'], category: 'Hipertensão Pulmonar' },
  { genericName: 'Sildenafila (HP)', brands: ['Revatio', 'Viagra'], category: 'Hipertensão Pulmonar/Urológico' },
  { genericName: 'Tadalafila (HP)', brands: ['Adcirca', 'Cialis'], category: 'Hipertensão Pulmonar/Urológico' },
  { genericName: 'Riociguate', brands: ['Adempas'], category: 'Hipertensão Pulmonar' },
  { genericName: 'Digoxina', brands: ['Digoxina EMS', 'Lanoxin'], category: 'Cardiovascular/Antiarrítmico' },
  { genericName: 'Metoprolol Succinato', brands: ['Selozok', 'Toprol-XL'], category: 'Anti-hipertensivo' },
  { genericName: 'Bisoprolol + Hidroclorotiazida', brands: ['Lodoz', 'Concor Plus'], category: 'Anti-hipertensivo' },
  { genericName: 'Nebivolol + Hidroclorotiazida', brands: ['Nebilet Plus'], category: 'Anti-hipertensivo' },
  { genericName: 'Carvedilol + Hidroclorotiazida', brands: ['Dilatrend HCT'], category: 'Anti-hipertensivo' },
  { genericName: 'Atenolol + Clortalidona', brands: ['Tenoretic', 'Normopres'], category: 'Anti-hipertensivo' },
  { genericName: 'Cilostazol', brands: ['Pletal', 'Cloplat'], category: 'Antiagregante Plaquetário' },
  { genericName: 'Dipiridamol', brands: ['Persantin', 'Aggrenox'], category: 'Antiagregante Plaquetário' },
  { genericName: 'Ticlopidina', brands: ['Ticlid', 'Tyklid'], category: 'Antiagregante Plaquetário' },
  { genericName: 'AAS + Clopidogrel', brands: ['Plavix + AAS', 'Aggrenox'], category: 'Antiagregante Plaquetário' },
  { genericName: 'Fondaparinux', brands: ['Arixtra'], category: 'Anticoagulante' },
  { genericName: 'Dalteparina', brands: ['Fragmin'], category: 'Anticoagulante' },
  { genericName: 'Nadroparina', brands: ['Fraxiparina', 'Fraxodi'], category: 'Anticoagulante' },
  { genericName: 'Mononitrato de Isossorbida 60mg', brands: ['Monocordil', 'Mononit'], category: 'Cardiovascular' },
  { genericName: 'Dinitrato de Isossorbida', brands: ['Isordil', 'Isoket'], category: 'Cardiovascular' },
  { genericName: 'Hidralazina', brands: ['Apresolina', 'Nepresol'], category: 'Anti-hipertensivo' },
  { genericName: 'Metildopa', brands: ['Aldomet', 'Metildopa EMS'], category: 'Anti-hipertensivo' },
  { genericName: 'Clonidina', brands: ['Atensina', 'Catapres'], category: 'Anti-hipertensivo' },
  { genericName: 'Minoxidil', brands: ['Loniten', 'Rogaine'], category: 'Anti-hipertensivo/Dermatológico' },
  { genericName: 'Indapamida', brands: ['Natrilix', 'Indapamida EMS'], category: 'Diurético' },
  { genericName: 'Acetazolamida', brands: ['Diamox'], category: 'Diurético' },
]);

// Vitaminas e suplementos
add([
  { genericName: 'Vitamina C (Ácido Ascórbico)', brands: ['Cebion', 'Redoxon', 'Vigor-C'], category: 'Vitamina' },
  { genericName: 'Vitamina E (Tocoferol)', brands: ['E-Vit', 'Ephynal', 'Vit E'], category: 'Vitamina' },
  { genericName: 'Vitamina K (Fitomenadiona)', brands: ['Kanakion', 'Mephyton'], category: 'Vitamina' },
  { genericName: 'Complexo B', brands: ['Neurofor', 'Neurobiom', 'Cobal B12'], category: 'Vitamina' },
  { genericName: 'Vitamina D3 (Colecalciferol)', brands: ['Addera D3', 'Depura', 'Bio-D'], category: 'Vitamina' },
  { genericName: 'Zinco', brands: ['Zincovit', 'Zinc Suplements'], category: 'Suplemento' },
  { genericName: 'Ômega-3', brands: ['Ômega Heart', 'Omegafort'], category: 'Suplemento' },
  { genericName: 'Ferro Polimaltosado', brands: ['Noripurum', 'Hemfer', 'Uniferon'], category: 'Suplemento' },
  { genericName: 'Sacarato de Hidróxido Férrico', brands: ['Noripurum EV', 'Venofer'], category: 'Suplemento' },
  { genericName: 'Eritropoetina Alfa', brands: ['Eritromax', 'Hemax'], category: 'Hematopoético' },
  { genericName: 'Darbepoetina Alfa', brands: ['Aranesp'], category: 'Hematopoético' },
]);

// Dermatológico oral
add([
  { genericName: 'Isotretinoína', brands: ['Roacutan', 'Neotrex', 'Acnova'], category: 'Dermatológico' },
  { genericName: 'Acitretina', brands: ['Neotigason', 'Soriatane'], category: 'Dermatológico' },
  { genericName: 'Espironolactona (acne)', brands: ['Aldactone', 'Spironolactone'], category: 'Diurético/Dermatológico' },
  { genericName: 'Doxiciclina (acne)', brands: ['Vibramicina', 'Doryx'], category: 'Antibiótico/Dermatológico' },
]);

// Ansiolíticos / Hipnóticos (complemento)
add([
  { genericName: 'Zolpidem', brands: ['Stilnox', 'Zolpidem EMS', 'Ambien'], category: 'Hipnótico' },
  { genericName: 'Zopiclona', brands: ['Imovane', 'Zopiclona EMS'], category: 'Hipnótico' },
  { genericName: 'Eszopiclona', brands: ['Lunesta'], category: 'Hipnótico' },
  { genericName: 'Zaleplon', brands: ['Sonata'], category: 'Hipnótico' },
  { genericName: 'Melatonina', brands: ['Melatol', 'Circadin', 'Melatonin'], category: 'Hipnótico' },
  { genericName: 'Bromazepam', brands: ['Lexotan', 'Bromazepam EMS'], category: 'Benzodiazepínico' },
  { genericName: 'Cloxazolam', brands: ['Olcadil'], category: 'Benzodiazepínico' },
  { genericName: 'Clorazepato', brands: ['Tranxilene'], category: 'Benzodiazepínico' },
  { genericName: 'Oxazepam', brands: ['Seresta'], category: 'Benzodiazepínico' },
  { genericName: 'Triazolam', brands: ['Halcion'], category: 'Benzodiazepínico' },
  { genericName: 'Buspirona', brands: ['Buspar', 'Ansitec'], category: 'Ansiolítico' },
]);

// Migranoso (complemento)
add([
  { genericName: 'Naratriptano', brands: ['Naramig', 'Naratriptano EMS'], category: 'Antimigranoso' },
  { genericName: 'Almotriptano', brands: ['Almogran'], category: 'Antimigranoso' },
  { genericName: 'Eletriptano', brands: ['Relpax'], category: 'Antimigranoso' },
  { genericName: 'Ergotamina', brands: ['Cafergot', 'Ergotamina EMS'], category: 'Antimigranoso' },
  { genericName: 'Dihidroergotamina', brands: ['Dihydergot', 'Migranal'], category: 'Antimigranoso' },
  { genericName: 'Lasmiditan', brands: ['Reyvow'], category: 'Antimigranoso' },
  { genericName: 'Ubrogepanto', brands: ['Ubrelvy'], category: 'Antimigranoso' },
  { genericName: 'Rimegepanto', brands: ['Nurtec ODT'], category: 'Antimigranoso' },
  { genericName: 'Erenumabe', brands: ['Aimovig'], category: 'Antimigranoso (preventivo)' },
  { genericName: 'Fremanezumabe', brands: ['Ajovy'], category: 'Antimigranoso (preventivo)' },
  { genericName: 'Galcanezumabe', brands: ['Emgality'], category: 'Antimigranoso (preventivo)' },
]);

// Dependência química / álcool / tabaco
add([
  { genericName: 'Vareniclina', brands: ['Champix', 'Chantix'], category: 'Dependência (tabaco)' },
  { genericName: 'Dissulfiram', brands: ['Antabuse', 'Antietanol'], category: 'Dependência (álcool)' },
  { genericName: 'Acamprosato', brands: ['Campral'], category: 'Dependência (álcool)' },
  { genericName: 'Nicotina (adesivo/pastilha)', brands: ['Nicorette', 'Niquitin'], category: 'Dependência (tabaco)' },
]);

// Hipnótico/Sedação (outros)
add([
  { genericName: 'Propofol', brands: ['Diprivan', 'Propofol EMS'], category: 'Anestésico' },
  { genericName: 'Cetamina', brands: ['Ketalar', 'Ketamin'], category: 'Anestésico' },
  { genericName: 'Dexmedetomidina', brands: ['Precedex', 'Dexdor'], category: 'Sedativo' },
]);

// ── 4. Atualiza versão e salva ───────────────────────────────────────────────
db.version = new Date().toISOString().slice(0, 10);
db.source = 'Curadoria manual + ANVISA (base expandida)';

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`✅ Banco atualizado: ${db.medications.length} medicamentos`);
