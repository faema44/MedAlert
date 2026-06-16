/**
 * Adiciona nomes de sais farmacêuticos como aliases de marca,
 * para que buscas por "maleato", "cloridrato", "besilato" etc. funcionem.
 * Execute: node scripts/add-salt-aliases.js
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../src/data/medications-db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// Map: genericName (lowercase) → salt aliases to add to brands[]
const SALT_ALIASES = {
  // ─── Maleato ──────────────────────────────────────────────────────────────
  'enalapril':               ['Maleato de Enalapril'],
  'dexclorfeniramina':       ['Maleato de Dexclorfeniramina'],
  'metildopa':               ['Alfa-Metildopa', 'Cloridrato de Metildopa'],
  'timolol ocular':          ['Maleato de Timolol'],
  // ─── Besilato ─────────────────────────────────────────────────────────────
  'anlodipino':              ['Besilato de Anlodipino', 'Amlodipino', 'Besilato de Amlodipino'],
  'anlodipino + atorvastatina': ['Besilato de Anlodipino + Atorvastatina'],
  // ─── Cloridrato ───────────────────────────────────────────────────────────
  'metformina':              ['Cloridrato de Metformina', 'Metformin'],
  'fluoxetina':              ['Cloridrato de Fluoxetina'],
  'sertralina':              ['Cloridrato de Sertralina'],
  'paroxetina':              ['Cloridrato de Paroxetina'],
  'venlafaxina':             ['Cloridrato de Venlafaxina'],
  'duloxetina':              ['Cloridrato de Duloxetina'],
  'bupropiona':              ['Cloridrato de Bupropiona'],
  'trazodona':               ['Cloridrato de Trazodona'],
  'mirtazapina':             ['Cloridrato de Mirtazapina'],
  'amitriptilina':           ['Cloridrato de Amitriptilina'],
  'imipramina':              ['Cloridrato de Imipramina'],
  'clomipramina':            ['Cloridrato de Clomipramina'],
  'nortriptilina':           ['Cloridrato de Nortriptilina'],
  'quetiapina':              ['Cloridrato de Quetiapina', 'Fumarato de Quetiapina'],
  'risperidona':             ['Cloridrato de Risperidona'],
  'olanzapina':              ['Cloridrato de Olanzapina'],
  'aripiprazol':             ['Cloridrato de Aripiprazol'],
  'clozapina':               ['Cloridrato de Clozapina'],
  'haloperidol':             ['Cloridrato de Haloperidol', 'Decanoato de Haloperidol'],
  'propranolol':             ['Cloridrato de Propranolol'],
  'atenolol':                ['Cloridrato de Atenolol'],
  'metoprolol':              ['Tartarato de Metoprolol', 'Succinato de Metoprolol'],
  'metoprolol succinato':    ['Succinato de Metoprolol'],
  'carvedilol':              ['Mesilato de Carvedilol'],
  'nebivolol':               ['Cloridrato de Nebivolol'],
  'bisoprolol':              ['Fumarato de Bisoprolol'],
  'verapamil':               ['Cloridrato de Verapamil'],
  'diltiazem':               ['Cloridrato de Diltiazem'],
  'hidralazina':             ['Cloridrato de Hidralazina'],
  'clonidina':               ['Cloridrato de Clonidina'],
  'prazosin':                ['Cloridrato de Prazosina', 'Prazosina'],
  'doxazosina':              ['Mesilato de Doxazosina'],
  'terazosina':              ['Cloridrato de Terazosina'],
  'alfuzosina':              ['Cloridrato de Alfuzosina'],
  'ciprofloxacino':          ['Cloridrato de Ciprofloxacino'],
  'levofloxacino':           ['Cloridrato de Levofloxacino'],
  'moxifloxacino':           ['Cloridrato de Moxifloxacino'],
  'doxiciclina':             ['Cloridrato de Doxiciclina', 'Monoiydrato de Doxiciclina'],
  'minociclina':             ['Cloridrato de Minociclina'],
  'ranitidina':              ['Cloridrato de Ranitidina'],
  'tramadol':                ['Cloridrato de Tramadol'],
  'morfina':                 ['Sulfato de Morfina', 'Cloridrato de Morfina'],
  'codeína':                 ['Fosfato de Codeína', 'Cloridrato de Codeína'],
  'fentanila':               ['Citrato de Fentanila', 'Fentanyl'],
  'buprenorfina':            ['Cloridrato de Buprenorfina'],
  'metadona':                ['Cloridrato de Metadona'],
  'naloxona':                ['Cloridrato de Naloxona'],
  'naltrexona':              ['Cloridrato de Naltrexona'],
  'tapentadol':              ['Cloridrato de Tapentadol'],
  'ciclobenzaprina':         ['Cloridrato de Ciclobenzaprina'],
  'tizanidina':              ['Cloridrato de Tizanidina'],
  'orfenadrina':             ['Cloridrato de Orfenadrina', 'Citrato de Orfenadrina'],
  'metilfenidato':           ['Cloridrato de Metilfenidato'],
  'atomoxetina':             ['Cloridrato de Atomoxetina'],
  'ambroxol':                ['Cloridrato de Ambroxol'],
  'bromexina':               ['Cloridrato de Bromexina'],
  'ondansetrona':            ['Cloridrato de Ondansetrona'],
  'granisetrona':            ['Cloridrato de Granisetrona'],
  'metoclopramida':          ['Cloridrato de Metoclopramida'],
  'domperidona':             ['Cloridrato de Domperidona'],
  'bromoprida':              ['Cloridrato de Bromoprida'],
  'dimenidrinato':           ['Cloridrato de Dimenidrinato'],
  'amiodarona':              ['Cloridrato de Amiodarona'],
  'sotalol':                 ['Cloridrato de Sotalol'],
  'flecainida':              ['Acetato de Flecainida'],
  'propafenona':             ['Cloridrato de Propafenona'],
  'varfarina':               ['Varfarina Sódica'],
  'donepezila':              ['Cloridrato de Donepezila', 'Cloridrato de Donepezil'],
  'memantina':               ['Cloridrato de Memantina'],
  'galantamina':             ['Cloridrato de Galantamina', 'Bromidrato de Galantamina'],
  'pramipexol':              ['Cloridrato de Pramipexol', 'Dicloridrato de Pramipexol'],
  'ropinirol':               ['Cloridrato de Ropinirol'],
  'biperideno':              ['Cloridrato de Biperideno'],
  'amantadina':              ['Cloridrato de Amantadina'],
  'solifenacina':            ['Succinato de Solifenacina'],
  'tolterodina':             ['Tartarato de Tolterodina'],
  'oxibutinina':             ['Cloridrato de Oxibutinina'],
  'fesoterodina':            ['Fumarato de Fesoterodina'],
  'vardenafila':             ['Cloridrato de Vardenafila'],
  'tadalafila (hp)':         ['Tadalafila'],
  'sildenafila (hp)':        ['Sildenafila', 'Citrato de Sildenafila'],
  'lisdexanfetamina':        ['Dimesilato de Lisdexanfetamina'],
  'guanfacina':              ['Cloridrato de Guanfacina'],
  'clonazepam':              ['Cloridrato de Clonazepam'],
  'aciclovir':               ['Aciclovir Sódico'],
  'valaciclovir':            ['Cloridrato de Valaciclovir'],
  'colchicina (gota)':       ['Colchicina', 'Colchicum'],
  'metronidazol (antiparasitário)': ['Metronidazol', 'Benzoato de Metronidazol'],
  // ─── Fumarato ─────────────────────────────────────────────────────────────
  'quetiapina':              ['Fumarato de Quetiapina'],
  'formoterol':              ['Fumarato de Formoterol'],
  // ─── Fosfato ──────────────────────────────────────────────────────────────
  'cloroquina':              ['Difosfato de Cloroquina'],
  'hidroxicloroquina':       ['Sulfato de Hidroxicloroquina'],
  // ─── Outros sais comuns ───────────────────────────────────────────────────
  'lítio':                   ['Carbonato de Lítio'],
  'magnésio':                ['Óxido de Magnésio', 'Sulfato de Magnésio', 'Cloreto de Magnésio'],
  'ferro polimaltosado':     ['Complexo de Hidróxido de Ferro', 'Ferro (III) Polimaltosado'],
  'zinco':                   ['Sulfato de Zinco', 'Gluconato de Zinco'],
  'captopril':               ['Captopril Merck', 'Captopril EMS'],
  'losartana':               ['Losartana Potássica'],
  'valsartana':              ['Valsartana Sódica'],
  'candesartana':            ['Cilexetila de Candesartana'],
  'irbesartana':             ['Irbesartana'],
  'telmisartana':            ['Telmisartana'],
  'omeprazol':               ['Omeprazol Sódico', 'Omeprazol Magnésio'],
  'esomeprazol':             ['Esomeprazol Magnésio', 'Esomeprazol Sódico'],
  'pantoprazol':             ['Pantoprazol Sódico'],
  'sinvastatina':            ['Sinvastatina EMS'],
  'atorvastatina':           ['Atorvastatina Cálcica'],
  'rosuvastatina':           ['Rosuvastatina Cálcica'],
  'pravastatina':            ['Pravastatina Sódica'],
  'fluvastatina':            ['Fluvastatina Sódica'],
  'levotiroxina':            ['Levotiroxina Sódica'],
  'alopurinol':              ['Alopurinol EMS'],
  'furosemida':              ['Furosemide', 'Furosemida EMS'],
  'espironolactona':         ['Espironolactona EMS'],
  'hidroclorotiazida':       ['Hidroclorotiazida EMS', 'HCTZ'],
  'ácido acetilsalicílico':  ['AAS', 'Aspirina'],
  'ibuprofeno':              ['Ibuprofeno Sódico'],
  'diclofenaco':             ['Diclofenaco de Sódio', 'Diclofenaco Potássico', 'Diclofenaco de Dietilamônio'],
  'naproxeno':               ['Naproxeno Sódico'],
  'cetorolaco':              ['Trometamina de Cetorolaco'],
  'prednisona':              ['Prednisona EMS'],
  'prednisolona':            ['Acetato de Prednisolona', 'Succinato de Prednisolona'],
  'dexametasona':            ['Acetato de Dexametasona', 'Dexametasona Fosfato'],
  'vitamina c (ácido ascórbico)': ['Vitamina C', 'Ácido Ascórbico'],
  'vitamina d3 (colecalciferol)': ['Vitamina D3', 'Colecalciferol', 'Vitamina D'],
  'vitamina k (fitomenadiona)':   ['Vitamina K', 'Fitomenadiona', 'Vitamina K1'],
  'carbonato de cálcio':          ['Cálcio', 'Cal'],
  'carbonato de cálcio + vitamina d': ['Cálcio + Vitamina D'],
  'ômega-3':                 ['Ômega 3', 'EPA', 'DHA', 'Óleo de Peixe'],
  'isotretinoína':           ['Ácido 13-cis-Retinoico'],
};

let updated = 0;
let notFound = 0;

for (const [name, aliases] of Object.entries(SALT_ALIASES)) {
  const entry = db.medications.find(
    m => m.genericName.toLowerCase() === name.toLowerCase()
  );
  if (!entry) {
    // Try partial match
    const partial = db.medications.find(
      m => m.genericName.toLowerCase().includes(name.toLowerCase())
    );
    if (partial) {
      for (const alias of aliases) {
        if (!partial.brands.includes(alias)) {
          partial.brands.unshift(alias);
          updated++;
        }
      }
    } else {
      notFound++;
    }
    continue;
  }
  for (const alias of aliases) {
    if (!entry.brands.includes(alias)) {
      entry.brands.unshift(alias);
      updated++;
    }
  }
}

db.version = new Date().toISOString().slice(0, 10);

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
console.log(`✅ ${updated} aliases adicionados`);
console.log(`⚠️  ${notFound} medicamentos não encontrados no DB (aliases ignorados)`);
console.log(`📦 Total de medicamentos: ${db.medications.length}`);

// Quick sanity check
const enalapril = db.medications.find(m => m.genericName === 'Enalapril');
console.log('Enalapril brands:', enalapril?.brands);
