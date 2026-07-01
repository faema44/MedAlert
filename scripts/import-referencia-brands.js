/**
 * Enriquece medications-db.json com nomes comerciais do registro ANVISA/CMED
 * (scripts/referencia.csv — coluna F = NO_PRODUTO/marca, coluna I = DS_SUBSTANCIA/genérico).
 *
 * Só adiciona marcas a genéricos de substância única que JÁ existem no banco
 * (casamento por nome normalizado, removendo sais/hidratos como "cloridrato de",
 * "sódico", "tri-hidratado" etc). Não cria entradas novas nem mexe em combinações
 * (substâncias separadas por "|" no CSV) — risco de atribuir marca ao genérico errado.
 *
 * Gera também scripts/referencia-unmatched.csv com as substâncias de único
 * ingrediente que não têm entrada no banco, para revisão manual depois.
 *
 * Execute: node scripts/import-referencia-brands.js
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../src/data/medications-db.json');
const CSV_PATH = path.join(__dirname, 'referencia.csv');
const REPORT_PATH = path.join(__dirname, 'referencia-unmatched.csv');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

let csvText = fs.readFileSync(CSV_PATH, 'utf8');
if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
const rows = csvText.split(/\r\n|\n/).filter(Boolean).slice(1).map(l => l.split(';'));

function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[()\/+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sais/hidratos que aparecem como PREFIXO ("cloridrato de X")
const SALT_PREFIXES = [
  'maleato de', 'besilato de', 'cloridrato de', 'dicloridrato de', 'fumarato de',
  'hemifumarato de', 'tartarato de', 'succinato de', 'mesilato de', 'dimesilato de',
  'acetato de', 'citrato de', 'napsilato de', 'fosfato de', 'sulfato de',
  'carbonato de', 'gluconato de', 'bromidrato de', 'monoidrato de', 'cilexetila de',
  'decanoato de', 'difosfato de', 'trometamina de', 'complexo de', 'oxido de',
  'cloreto de', 'benzoato de',
];

// Sais/hidratos que aparecem como SUFIXO ("diclofenaco sódico", "amoxicilina tri-hidratada")
const SALT_SUFFIXES = [
  'sodico', 'sodica', 'potassico', 'potassica', 'calcico', 'calcica',
  'magnesico', 'magnesica', 'dissodico', 'dissodica',
  'monoidratado', 'monoidratada', 'di-hidratado', 'di-hidratada',
  'tri-hidratado', 'tri-hidratada', 'anidro', 'anidra',
];

// Variantes de sufixo -ino/-ina do DCB (nomenclatura ANVISA) que não batem por
// igualdade direta com o nome curado no banco (ex: CSV usa "nifedipino", banco usa "Nifedipina")
const INN_SUFFIX_ALIASES = {
  'nifedipino': 'nifedipina',
};

function stripSalt(rawName) {
  let n = normalize(rawName);
  for (const p of SALT_PREFIXES) {
    if (n.startsWith(p + ' ')) { n = n.slice(p.length).trim(); break; }
  }
  for (const s of SALT_SUFFIXES) {
    if (n.endsWith(' ' + s)) { n = n.slice(0, -s.length).trim(); break; }
  }
  return n;
}

function toTitleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(w => (w.length <= 2 && !/^[aeiou]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ── Índice do banco: só entradas de substância única (sem "+" no genericName) ──
const dbIndex = new Map(); // chave normalizada -> entry
for (const m of db.medications) {
  if (m.genericName.includes('+')) continue; // combinação — fora de escopo
  const candidates = new Set([stripSalt(m.genericName)]);
  const parenMatch = m.genericName.match(/\(([^)]+)\)/);
  if (parenMatch) {
    candidates.add(stripSalt(parenMatch[1]));
    candidates.add(stripSalt(m.genericName.replace(/\([^)]*\)/, '')));
  }
  for (const key of candidates) {
    if (key && !dbIndex.has(key)) dbIndex.set(key, m);
  }
}

// ── Agrupa marcas do CSV por substância normalizada ──
const bySubst = new Map(); // chave normalizada -> Set(marca original)
const substancesRaw = new Map(); // chave -> nome original (para o relatório)
for (const r of rows) {
  const brand = (r[5] || '').trim();
  const subst = (r[8] || '').trim();
  if (!brand || !subst) continue;
  if (subst.includes('|')) continue; // combinação — fora de escopo
  const key = stripSalt(subst);
  if (!key) continue;
  if (!bySubst.has(key)) bySubst.set(key, new Set());
  bySubst.get(key).add(brand);
  if (!substancesRaw.has(key)) substancesRaw.set(key, subst);
}

// ── Merge ──
let entriesUpdated = 0;
let brandsAdded = 0;
const unmatched = [];

for (const [key, brands] of bySubst.entries()) {
  const entry = dbIndex.get(key) ?? dbIndex.get(INN_SUFFIX_ALIASES[key]);
  if (!entry) {
    unmatched.push([substancesRaw.get(key), brands.size, [...brands].slice(0, 5)]);
    continue;
  }
  let addedHere = 0;
  for (const rawBrand of brands) {
    const normBrand = normalize(rawBrand);
    if (normBrand === key) continue; // produto "genérico puro" (nome = substância)
    const already = entry.brands.some(b => normalize(b) === normBrand);
    if (already) continue;
    entry.brands.push(toTitleCase(rawBrand));
    addedHere++;
  }
  if (addedHere > 0) {
    entriesUpdated++;
    brandsAdded += addedHere;
  }
}

db.version = new Date().toISOString().slice(0, 10) + '-referencia';
db.source = db.source + ' + ANVISA/CMED referencia.csv (marcas)';

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');

unmatched.sort((a, b) => b[1] - a[1]);
const reportLines = ['substancia;qtd_marcas;exemplo_marcas'];
for (const [subst, count, sample] of unmatched) {
  reportLines.push(`${subst};${count};${sample.join(', ')}`);
}
fs.writeFileSync(REPORT_PATH, reportLines.join('\n'), 'utf8');

console.log(`Genericos atualizados: ${entriesUpdated}`);
console.log(`Marcas novas adicionadas: ${brandsAdded}`);
console.log(`Substancias sem entrada no banco: ${unmatched.length} (ver ${path.basename(REPORT_PATH)})`);
console.log(`Total de genericos no banco: ${db.medications.length}`);
