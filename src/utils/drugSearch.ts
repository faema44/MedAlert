import dbData from '../data/medications-db.json';
import interactionsData from '../data/interactions.json';
import { DrugInteraction } from '../types';

interface MedEntry {
  genericName: string;
  brands: string[];
  category: string;
}

let DB: MedEntry[] = (dbData as { medications: MedEntry[] }).medications;

export function loadExternalDb(data: { version?: string; medications: MedEntry[] }): void {
  if (!data?.medications?.length) return;
  if (data.medications.length > DB.length) {
    DB = data.medications;
  }
}
let ALL_INTERACTIONS: DrugInteraction[] = interactionsData as DrugInteraction[];

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

export function getBulaUrl(genericName: string, brandName?: string): string {
  const slug = toSlug(brandName ?? genericName);
  return `https://consultaremedios.com.br/${slug}/bula`;
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

// ─── Local suggestions ────────────────────────────────────────────────────────

export function getSuggestions(input: string, max = 7): DrugSuggestion[] {
  const q = normalize(input);
  if (q.length < 2) return [];

  const results: DrugSuggestion[] = [];
  const addedGenerics = new Set<string>();

  for (const entry of DB) {
    if (results.length >= max) break;

    const gNorm = normalize(entry.genericName);
    const fb = getFirstCommercialBrand(entry.brands, entry.genericName);

    // Match on generic name
    if (gNorm.includes(q)) {
      results.push({
        label: entry.genericName,
        genericName: entry.genericName,
        firstBrand: fb,
        category: entry.category,
        bulaUrl: getBulaUrl(entry.genericName, fb),
      });
      addedGenerics.add(gNorm);
      continue;
    }

    // Match on brand names
    const matchedBrand = entry.brands.find(b => normalize(b).includes(q));
    if (matchedBrand && !addedGenerics.has(gNorm)) {
      results.push({
        label: `${matchedBrand}  →  ${entry.genericName}`,
        genericName: entry.genericName,
        brandName: matchedBrand,
        category: entry.category,
        bulaUrl: getBulaUrl(entry.genericName, matchedBrand),
        isBrand: true,
      });
      addedGenerics.add(gNorm);
    }
  }

  return results;
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
