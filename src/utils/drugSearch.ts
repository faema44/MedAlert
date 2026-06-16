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
const ALL_INTERACTIONS = interactionsData as DrugInteraction[];

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

export function getBulaUrl(genericName: string): string {
  // Use only the first active ingredient for compound names (e.g. "Amoxicilina + Clavulanato")
  const mainName = genericName.split('+')[0].split('/')[0].trim();
  return (
    'https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=' +
    encodeURIComponent(mainName.toUpperCase())
  );
}

// Salt/descriptor prefixes that are NOT commercial brand names
const SALT_PREFIXES = [
  'maleato', 'besilato', 'cloridrato', 'fumarato', 'tartarato', 'succinato',
  'mesilato', 'acetato', 'citrato', 'fosfato', 'sulfato', 'carbonato',
  'gluconato', 'dicloridrato', 'bromidrato', 'dimesilato', 'monoidrato',
  'monoiydrato', 'ácido', 'alfa-', 'óxido', 'complexo',
];

function getFirstCommercialBrand(brands: string[]): string | undefined {
  return brands.find(b => {
    const bl = b.toLowerCase();
    return !SALT_PREFIXES.some(p => bl.startsWith(p));
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
    const bulaUrl = getBulaUrl(entry.genericName);

    // Match on generic name
    if (gNorm.includes(q)) {
      results.push({
        label: entry.genericName,
        genericName: entry.genericName,
        firstBrand: getFirstCommercialBrand(entry.brands),
        category: entry.category,
        bulaUrl,
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
        bulaUrl,
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
