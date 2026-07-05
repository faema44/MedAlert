import { DrugInteraction } from '../types';

interface MedEntry {
  genericName: string;
  brands: string[];
  category: string;
  rxcui?: string; // só presente para substâncias únicas — combos são decompostos em runtime
}

let DB: MedEntry[] = [];
// Cache brand→generic resolutions so we don't scan DB on every checkInteractions call
const resolveCache = new Map<string, string>();
const normalizeCache = new Map<string, string>();
// Pre-normalized drug1/drug2 tokens for each interaction — rebuilt when interactions load
let INTERACTION_TOKENS: Array<{ tokens1: string[]; tokens2: string[] }> = [];
// normalized genericName -> rxcui — rebuilt whenever DB changes
let RXCUI_BY_NAME: Map<string, string> = new Map();
const rxcuiSetCache = new Map<string, Set<string>>();

function buildRxcuiIndex() {
  RXCUI_BY_NAME = new Map();
  for (const entry of DB) {
    if (entry.rxcui) RXCUI_BY_NAME.set(normalize(entry.genericName), entry.rxcui);
  }
  rxcuiSetCache.clear();
}

let DB_VERSION: string | undefined;

// Seed synchronously at module load so suggestions work before syncMedicationsDb completes
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundled = require('../data/medications-db.json');
  if (bundled?.medications?.length) { DB = bundled.medications; DB_VERSION = bundled.version; }
} catch { /* bundled data unavailable, syncMedicationsDb will fill later */ }
buildRxcuiIndex();

export function loadExternalDb(data: { version?: string; medications: MedEntry[] }): void {
  if (!data?.medications?.length) return;
  // Prefer by version (e.g. "2026-06-30") when both sides have one — a curated cleanup
  // can *shrink* the list (removing a duplicate, a bad entry), and a stale cached copy
  // with more rows must not win just because it's bigger. Fall back to length only when
  // version info is missing (older cached payloads).
  const isNewer = data.version && DB_VERSION
    ? data.version > DB_VERSION
    : data.medications.length > DB.length;
  if (isNewer) {
    DB = data.medications;
    DB_VERSION = data.version;
    resolveCache.clear();
    buildRxcuiIndex();
  }
}
let ALL_INTERACTIONS: DrugInteraction[] = [];

export function getAllInteractions(): DrugInteraction[] {
  return ALL_INTERACTIONS;
}

// "ácido" recurs across unrelated drugs (Ácido Valpróico, Ácido Acetilsalicílico, Ácido Fólico...);
// as a standalone token it causes false-positive interaction matches between them.
const GENERIC_QUALIFIER_TOKENS = new Set(['acido', 'acida']);

function buildInteractionTokens() {
  INTERACTION_TOKENS = ALL_INTERACTIONS.map(i => ({
    tokens1: normalize(i.drug1).split(/[\s,]+/).filter(t => t.length >= 3 && !GENERIC_QUALIFIER_TOKENS.has(t)),
    tokens2: normalize(i.drug2).split(/[\s,]+/).filter(t => t.length >= 3 && !GENERIC_QUALIFIER_TOKENS.has(t)),
  }));
}

export function loadExternalInteractions(data: DrugInteraction[]): void {
  if (!data?.length) return;
  if (data.length > ALL_INTERACTIONS.length) {
    ALL_INTERACTIONS = data;
    resolveCache.clear();
    buildInteractionTokens();
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
  const cached = normalizeCache.get(s);
  if (cached !== undefined) return cached;
  const result = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()\/+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  normalizeCache.set(s, result);
  return result;
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

// Bulas de liberação prolongada baixadas à parte (posologia/farmacocinética
// diferem da versão de liberação imediata do mesmo genérico) — só cobre os
// poucos casos com bula própria confirmada na ANVISA, não o genérico inteiro.
const XR_BRAND_PATTERN = /\b(xr|mr|sr|cr|od|lp|retard|xl)\b/i;
const XR_BULA_SLUGS: Record<string, string> = {
  'metformina':  'metformina-xr',
  'gliclazida':  'gliclazida-mr',
  'venlafaxina': 'venlafaxina-xr',
  'quetiapina':  'quetiapina-xr',
};

export function getBulaUrl(genericName: string, brandName?: string): string {
  if (brandName && XR_BRAND_PATTERN.test(brandName)) {
    const xrSlug = XR_BULA_SLUGS[normalize(genericName)];
    if (xrSlug) return `${BULA_BASE}/${xrSlug}.pdf`;
  }
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
  'matricaria recutita':    'camomila',
  'camomila':               'camomila',
  'peumus boldus':          'boldo',
  'boldo':                  'boldo',
  'camellia sinensis':      'cha-verde',
  'cha verde':              'cha-verde',
  'uncaria tomentosa':      'unha-de-gato',
  'unha de gato':           'unha-de-gato',
  'curcuma longa':          'curcuma',
  'curcuma':                'curcuma',
  'mentha piperita':        'hortela-pimenta',
  'hortela pimenta':        'hortela-pimenta',
  'salvia miltiorrhiza':    'salvia-milthiorrizae',
  'danshen':                'salvia-milthiorrizae',
  'salvia officinalis':     'salvia',
  'salvia':                 'salvia',
  'arctostaphylos uva-ursi': 'uva-ursi',
  'uva ursi':               'uva-ursi',
  'tanacetum parthenium':   'tanaceto',
  'tanaceto':               'tanaceto',
  'salix alba':             'salgueiro',
  'salgueiro':              'salgueiro',
  'zingiber officinale':    'gengibre',
  'gengibre':               'gengibre',
  'pimpinella anisum':      'erva-doce',
  'erva doce':              'erva-doce',
  'arnica montana':         'arnica',
  'glycyrrhiza glabra':     'alcacuz',
  'alcacuz':                'alcacuz',
  'eucalyptus globulus':    'eucalipto',
  'melissa officinalis':    'melissa',
  'erva cidreira':          'melissa',
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

// Unsorted — for membership checks where order doesn't matter, avoids the locale-aware sort cost
export function getAllMedGenericNames(): string[] {
  return DB.filter(e => e.category !== 'Fitoterápico').map(e => e.genericName);
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

    const matchedBrands = entry.brands.filter(b => normalize(b).includes(q));
    if (matchedBrands.length > 0 && !addedGenerics.has(gNorm)) {
      addedGenerics.add(gNorm);
      for (const matchedBrand of matchedBrands) {
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
      }
    }
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map(r => r.s);
}

// ─── Interaction check ────────────────────────────────────────────────────────

function resolveGeneric(name: string): string {
  if (resolveCache.has(name)) return resolveCache.get(name)!;
  const n = normalize(name);
  for (const entry of DB) {
    if (entry.brands.some(b => normalize(b) === n)) {
      resolveCache.set(name, entry.genericName);
      return entry.genericName;
    }
  }
  resolveCache.set(name, name);
  return name;
}

// Match a name against pre-computed token array (no DB scan)
function tokensMatchName(tokens: string[], name: string): boolean {
  const resolved = resolveGeneric(name);
  const candidates = resolved !== name ? [resolved, name] : [name];
  for (const c of candidates) {
    const cNorm = normalize(c);
    if (cNorm.length < 3) continue;
    if (tokens.some(t => t.includes(cNorm) || cNorm.includes(t))) return true;
  }
  return false;
}

// RxCUI(s) for a med name — decomposes combo names ("X + Y") into each ingredient's
// own RxCUI rather than trusting a single combo-product id (those differ from the
// ids of their components, which would silently break combo matching).
function rxcuisForName(name: string): Set<string> {
  if (rxcuiSetCache.has(name)) return rxcuiSetCache.get(name)!;
  const resolved = resolveGeneric(name);
  const parts = resolved.split(/[+/]/).map(p => normalize(p)).filter(p => p.length >= 3);
  const set = new Set<string>();
  for (const p of parts) {
    const r = RXCUI_BY_NAME.get(p);
    if (r) set.add(r);
  }
  rxcuiSetCache.set(name, set);
  return set;
}

// Fuzzy text match OR'd with an exact RxCUI match — RxCUI can only ADD a match the
// fuzzy text comparison missed (synonyms/spelling variants with no shared word, e.g.
// "Aspirina" vs "AAS (Ácido Acetilsalicílico)"). It never overrides/rejects a fuzzy
// match: this dataset routinely uses one representative drug for a whole family
// (e.g. "Citalopram" standing in for Escitalopram too), and RxCUI is strict per
// substance — using it to reject would silently drop real, sometimes critical interactions.
function matchesSide(tokens: string[], rxcuis: string[] | undefined, name: string): boolean {
  if (tokensMatchName(tokens, name)) return true;
  if (!rxcuis || !rxcuis.length) return false;
  const candidateRxcuis = rxcuisForName(name);
  if (!candidateRxcuis.size) return false;
  return rxcuis.some(r => candidateRxcuis.has(r));
}

function entryMatchesName(entry: string, name: string): boolean {
  const tokens = normalize(entry).split(/[\s,]+/).filter(t => t.length >= 3);
  return tokensMatchName(tokens, name);
}

export function checkSubstanceInteractions(drugName: string, userMedNames: string[]): DrugInteraction[] {
  if (drugName.trim().length < 3 || userMedNames.length === 0) return [];
  const seen = new Set<string>();
  const results: DrugInteraction[] = [];
  for (let i = 0; i < ALL_INTERACTIONS.length; i++) {
    const interaction = ALL_INTERACTIONS[i];
    if (seen.has(interaction.id)) continue;
    const { tokens1, tokens2 } = INTERACTION_TOKENS[i] ?? { tokens1: [], tokens2: [] };
    const m1 = matchesSide(tokens1, interaction.drug1_rxcuis, drugName);
    const m2 = m1 ? false : matchesSide(tokens2, interaction.drug2_rxcuis, drugName);
    if (m1) {
      if (userMedNames.some(m => matchesSide(tokens2, interaction.drug2_rxcuis, m))) { seen.add(interaction.id); results.push(interaction); }
    } else if (m2) {
      if (userMedNames.some(m => matchesSide(tokens1, interaction.drug1_rxcuis, m))) { seen.add(interaction.id); results.push(interaction); }
    }
  }
  const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
  return results.sort((a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3));
}

// Álcool e barbitúricos nunca aparecem na lista de medicamentos do próprio usuário
// (ninguém cadastra "Álcool" como remédio que toma), então essas interações precisam
// ser sinalizadas de forma independente de existingMedNames — um aviso permanente por
// medicamento, não condicionado a outro cadastro do usuário.
const ALCOHOL_TERMS = ['alcool', 'etanol', 'alcohol'];
const BARBITURATE_TERMS = ['barbiturico', 'barbiturate', 'fenobarbital', 'pentobarbital', 'secobarbital', 'amobarbital', 'tiopental'];

// null quando `name` não é álcool nem barbitúrico — usado tanto para achar essas
// interações "de padrão" (ver checkInteractions) quanto para rotular o aviso na UI.
export function alcoholOrBarbiturateKind(name: string): 'alcohol' | 'barbiturate' | null {
  const n = normalize(name);
  if (ALCOHOL_TERMS.some(t => n.includes(t))) return 'alcohol';
  if (BARBITURATE_TERMS.some(t => n.includes(t))) return 'barbiturate';
  return null;
}

function isAlcoholOrBarbiturateName(name: string): boolean {
  return alcoholOrBarbiturateKind(name) !== null;
}

export function checkInteractions(newDrug: string, existingMedNames: string[]): DrugInteraction[] {
  if (newDrug.trim().length < 3) return [];

  const seen = new Set<string>();
  const results: DrugInteraction[] = [];

  for (let i = 0; i < ALL_INTERACTIONS.length; i++) {
    const interaction = ALL_INTERACTIONS[i];
    if (seen.has(interaction.id)) continue;
    const { tokens1, tokens2 } = INTERACTION_TOKENS[i] ?? { tokens1: [], tokens2: [] };
    const m1 = matchesSide(tokens1, interaction.drug1_rxcuis, newDrug);
    const m2 = m1 ? false : matchesSide(tokens2, interaction.drug2_rxcuis, newDrug);
    if (m1 && (isAlcoholOrBarbiturateName(interaction.drug2) || existingMedNames.some(m => matchesSide(tokens2, interaction.drug2_rxcuis, m)))) {
      seen.add(interaction.id); results.push(interaction);
    } else if (m2 && (isAlcoholOrBarbiturateName(interaction.drug1) || existingMedNames.some(m => matchesSide(tokens1, interaction.drug1_rxcuis, m)))) {
      seen.add(interaction.id); results.push(interaction);
    }
  }

  const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
  return results.sort((a, b) => (order[a.risk_level] ?? 3) - (order[b.risk_level] ?? 3));
}
