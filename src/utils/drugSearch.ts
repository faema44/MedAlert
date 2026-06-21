import { DrugInteraction } from '../types';

interface MedEntry {
  genericName: string;
  brands: string[];
  category: string;
}

let DB: MedEntry[] = [];

export function loadExternalDb(data: { version?: string; medications: MedEntry[] }): void {
  if (!data?.medications?.length) return;
  if (data.medications.length > DB.length) {
    DB = data.medications;
  }
}
let ALL_INTERACTIONS: DrugInteraction[] = [];

export function getAllInteractions(): DrugInteraction[] {
  return ALL_INTERACTIONS;
}

export function loadExternalInteractions(data: DrugInteraction[]): void {
  if (!data?.length) return;
  if (data.length > ALL_INTERACTIONS.length) {
    ALL_INTERACTIONS = data;
  }
}

export interface DrugSuggestion {
  label: string;        // text shown in chip
  genericName: string;  // fills the generic name field
  brandName?: string;   // fills the commercial name field (when isBrand)
  firstBrand?: string;  // first real commercial brand (for generic-match suggestions)
  category: string;
  bulaUrl: string;
  isBrand?: boolean;    // matched via brand name
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()\/+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Bula URL (ANVISA Bulário Eletrônico — fonte oficial brasileira) ───────────

function toSlug(name: string): string {
  return name
    .split('+')[0].split('/')[0].trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function getBulaUrl(genericName: string, _brandName?: string): string {
  return `${BULA_BASE}/${toSlug(genericName)}.pdf`;
}

const PHYTO_BULA_MAP: Record<string, string> = {
  // 15 bulas padrão ANVISA (IN 04/2014)
  'aesculus hippocastanum': 'castanha-da-india',
  'castanha da india':      'castanha-da-india',
  'allium sativum':         'alho',
  'alho medicinal':         'alho',
  'cynara scolymus':        'alcachofra',
  'alcachofra':             'alcachofra',
  'echinacea purpurea':     'equinacea',
  'equinacea':              'equinacea',
  'rhamnus purshiana':      'cascara-sagrada',
  'cascara sagrada':        'cascara-sagrada',
  'ginkgo biloba':          'ginkgo-biloba',
  'glycine max':            'soja-isoflavona',
  'soja':                   'soja-isoflavona',
  'hypericum perforatum':   'erva-de-sao-joao',
  'erva de sao joao':       'erva-de-sao-joao',
  'paullinia cupana':       'guarana',
  'guarana':                'guarana',
  'piper methysticum':      'kava-kava',
  'kava kava':              'kava-kava',
  'senna alexandrina':      'sene',
  'sene':                   'sene',
  'serenoa repens':         'saw-palmetto',
  'saw palmetto':           'saw-palmetto',
  'valeriana officinalis':  'valeriana',
  'valeriana':              'valeriana',
  'passiflora incarnata':   'maracuja',
  'maracuja':               'maracuja',
  'silybum marianum':       'silimarina',
  'silimarina':             'silimarina',
  // bulas de produtos registrados na ANVISA
  'maytenus ilicifolia':    'espinheira-santa',
  'espinheira santa':       'espinheira-santa',
  'mikania glomerata':      'guaco',
  'guaco':                  'guaco',
  'centella asiatica':      'centella-asiatica',
  'cimicifuga racemosa':    'cimicifuga',
  'cimicifuga':             'cimicifuga',
  'panax ginseng':          'ginseng',
  'ginseng':                'ginseng',
};

const BULA_BASE = 'https://www.alertamedico.ia.br/bulas';

export function getPhytoBulaUrl(genericName: string, brandName?: string): string {
  const key = normalize(genericName.split('(')[0].split('/')[0].trim());
  const slug = Object.entries(PHYTO_BULA_MAP).find(([k]) => key.includes(k) || k.includes(key))?.[1];
  if (slug) return `${BULA_BASE}/${slug}.pdf`;
  if (brandName) return getBulaUrl(genericName, brandName);
  const name = genericName.split('(')[0].split('/')[0].trim();
  return `https://www.google.com/search?q=${encodeURIComponent(`bula fitoterápico ${name}`)}`;
}

// Salt/descriptor prefixes (normalized — no accents)
const SALT_PREFIXES = [
  'maleato', 'besilato', 'cloridrato', 'fumarato', 'tartarato', 'succinato',
  'mesilato', 'acetato', 'citrato', 'fosfato', 'sulfato', 'carbonato',
  'gluconato', 'dicloridrato', 'bromidrato', 'dimesilato', 'monoidrato',
  'acido', 'alfa-', 'oxido', 'complexo',
];
// Salt modifier words that appear inside compound brand names
const SALT_WORDS = [
  'sodico', 'sodica', 'potassico', 'potassica', 'magnesio',
  'calcico', 'calcica', 'dietilamonio', 'estearato',
];
// Generic manufacturer labels (not real brand names)
const MANUFACTURER_SUFFIXES = [
  ' ems', ' mk', ' merck', ' medley', ' sandoz', ' eurofarma', ' germed', ' generico',
];

function getFirstCommercialBrand(brands: string[], genericName: string): string | undefined {
  const gl = normalize(genericName);
  const glFirst = gl.split(' ')[0];
  const glWords = new Set(gl.split(' '));

  return brands.find(b => {
    const bln = normalize(b);
    // 1. Known salt/descriptor prefix
    if (SALT_PREFIXES.some(p => bln.startsWith(p))) return false;
    // 2. Salt modifier word embedded in brand name (e.g. "Omeprazol Magnésio", "Naproxeno Sódico")
    if (SALT_WORDS.some(w => bln.includes(w))) return false;
    // 3. Generic manufacturer label (e.g. "Furosemida EMS", "Sinvastatina EMS")
    if (MANUFACTURER_SUFFIXES.some(s => bln.endsWith(s))) return false;
    // 4. Brand starts with the generic's first word (e.g. "Atorvastatina Cálcica", "Captopril Merck")
    if (glFirst.length >= 5 && bln.startsWith(glFirst)) return false;
    // 5. Brand is a distinct word inside the generic name (e.g. "Colecalciferol" in "Vitamina D3 (Colecalciferol)")
    if (bln.length >= 5 && glWords.has(bln)) return false;
    // 6. Near-identical INN variant: brand is almost the same length as generic and nearly matches
    //    (e.g. "Metformin" for "Metformina", "Furosemide" for "Furosemida")
    if (gl.length >= 6 && bln.length >= gl.length - 4 && gl.includes(bln)) return false;
    if (gl.length >= 7 && bln.length >= gl.length - 3) {
      const compareLen = Math.max(5, Math.min(bln.length, gl.length) - 2);
      if (bln.substring(0, compareLen) === gl.substring(0, compareLen)) return false;
    }
    return true;
  });
}

export interface DbEntry { genericName: string; brands: string[]; category: string; }

export function getAllMedsList(): DbEntry[] {
  return DB.filter(e => e.category !== 'Fitoterápico')
    .sort((a, b) => a.genericName.localeCompare(b.genericName, 'pt-BR'));
}

export function getAllPhytoList(): DbEntry[] {
  return DB.filter(e => e.category === 'Fitoterápico')
    .sort((a, b) => a.genericName.localeCompare(b.genericName, 'pt-BR'));
}

// ─── Local suggestions ────────────────────────────────────────────────────────

export function isPhytotherapic(name: string): boolean {
  const n = normalize(name);
  return DB.some(e => e.category === 'Fitoterápico' && (normalize(e.genericName).includes(n) || e.brands.some(b => normalize(b).includes(n))));
}

export function getPhytotherapics(): DrugSuggestion[] {
  return DB
    .filter(e => e.category === 'Fitoterápico')
    .map(e => {
      const fb = getFirstCommercialBrand(e.brands, e.genericName) ?? e.brands[0];
      return {
        label: e.genericName,
        genericName: e.genericName,
        firstBrand: fb,
        category: e.category,
        bulaUrl: getBulaUrl(e.genericName, fb),
      };
    });
}

export function isPhytotherapicInteraction(i: DrugInteraction): boolean {
  const phytoNorms = DB
    .filter(e => e.category === 'Fitoterápico')
    .map(e => normalize(e.genericName).split(' ')[0]);
  return phytoNorms.some(p => normalize(i.drug1).startsWith(p) || normalize(i.drug2).startsWith(p));
}

export function getSuggestions(input: string, max = 7, categoryFilter?: string): DrugSuggestion[] {
  const q = normalize(input);
  if (q.length < 2) return [];

  // score: 0 = generic starts with query, 1 = brand starts with query,
  //        2 = generic contains query, 3 = brand contains query
  const scored: Array<{ score: number; s: DrugSuggestion }> = [];
  const addedGenerics = new Set<string>();

  for (const entry of DB) {
    if (categoryFilter && entry.category !== categoryFilter) continue;

    const gNorm = normalize(entry.genericName);
    const fb = getFirstCommercialBrand(entry.brands, entry.genericName);

    if (gNorm.includes(q)) {
      scored.push({
        score: gNorm.startsWith(q) ? 0 : 2,
        s: {
          label: entry.genericName,
          genericName: entry.genericName,
          firstBrand: fb,
          category: entry.category,
          bulaUrl: getBulaUrl(entry.genericName, fb),
        },
      });
      addedGenerics.add(gNorm);
      continue;
    }

    const matchedBrand = entry.brands.find(b => normalize(b).includes(q));
    if (matchedBrand && !addedGenerics.has(gNorm)) {
      const bNorm = normalize(matchedBrand);
      scored.push({
        score: bNorm.startsWith(q) ? 1 : 3,
        s: {
          label: `${matchedBrand}  →  ${entry.genericName}`,
          genericName: entry.genericName,
          brandName: matchedBrand,
          category: entry.category,
          bulaUrl: getBulaUrl(entry.genericName, matchedBrand),
          isBrand: true,
        },
      });
      addedGenerics.add(gNorm);
    }
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map(r => r.s);
}

// ─── Interaction check ────────────────────────────────────────────────────────

function resolveGeneric(name: string): string {
  const n = normalize(name);
  for (const entry of DB) {
    if (entry.brands.some(b => normalize(b) === n)) return entry.genericName;
  }
  return name;
}

function entryMatchesName(entry: string, name: string): boolean {
  const resolved = resolveGeneric(name);
  const candidates = resolved !== name ? [resolved, name] : [name];

  for (const c of candidates) {
    const cNorm = normalize(c);
    if (cNorm.length < 3) continue;
    const entryNorm = normalize(entry);
    const tokens = entryNorm.split(/[\s,]+/).filter(t => t.length >= 3);
    if (tokens.some(t => t.includes(cNorm) || cNorm.includes(t))) return true;
  }
  return false;
}

export function checkSubstanceInteractions(drugName: string, userMedNames: string[]): DrugInteraction[] {
  if (drugName.trim().length < 3 || userMedNames.length === 0) return [];
  const seen = new Set<string>();
  const results: DrugInteraction[] = [];
  for (const interaction of ALL_INTERACTIONS) {
    if (seen.has(interaction.id)) continue;
    const m1 = entryMatchesName(interaction.drug1, drugName);
    const m2 = entryMatchesName(interaction.drug2, drugName);
    if (m1) {
      const otherIsMed = userMedNames.some(m => entryMatchesName(interaction.drug2, m));
      if (otherIsMed) { seen.add(interaction.id); results.push(interaction); }
    } else if (m2) {
      const otherIsMed = userMedNames.some(m => entryMatchesName(interaction.drug1, m));
      if (otherIsMed) { seen.add(interaction.id); results.push(interaction); }
    }
  }
  const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
  return results.sort((a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3));
}

export function checkInteractions(
  newDrug: string,
  existingMedNames: string[],
): DrugInteraction[] {
  if (newDrug.trim().length < 3 || existingMedNames.length === 0) return [];

  const seen = new Set<string>();
  const results: DrugInteraction[] = [];

  for (const interaction of ALL_INTERACTIONS) {
    if (seen.has(interaction.id)) continue;

    const m1 = entryMatchesName(interaction.drug1, newDrug);
    const m2 = entryMatchesName(interaction.drug2, newDrug);

    if (m1 && existingMedNames.some(m => entryMatchesName(interaction.drug2, m))) {
      seen.add(interaction.id); results.push(interaction);
    } else if (m2 && existingMedNames.some(m => entryMatchesName(interaction.drug1, m))) {
      seen.add(interaction.id); results.push(interaction);
    }
  }

  const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
  return results.sort((a, b) => order[a.risk_level] - order[b.risk_level]);
}
