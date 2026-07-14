#!/usr/bin/env node
/**
 * Gera um CSV para conferência manual: uma linha por (bula, medicamento genérico OU
 * marca comercial), com o slug e a URL exatos que o app calcularia — para achar caso
 * de bula errada/faltando antes de mandar pra produção.
 *
 * Usa o slug REAL de src/utils/drugSearch.ts (transpilado na hora), não uma
 * reimplementação — mesmo padrão de tools/check-ota.js.
 *
 * Só entram bulas cujo PDF existe de fato em site/bulas/*.pdf (repo separado,
 * checkout local). Medicamentos cujo slug calculado não bate com nenhum PDF publicado
 * saem numa segunda lista (bulas_faltando.csv) em vez de aparecer como se existissem.
 *
 * USO:
 *   node tools/export-bulas-csv.js
 *   → gera tools/out/bulas.csv e tools/out/bulas_faltando.csv
 */
const fs = require('fs');
const path = require('path');
const { Module } = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DRUG_SEARCH_PATH = path.join(ROOT, 'src/utils/drugSearch.ts');
const BULAS_DIR = path.join(ROOT, 'site/bulas');
const OUT_DIR = path.join(__dirname, 'out');

// ─── Carrega o slug real, do TS de produção ────────────────────────────────────
const src = fs.readFileSync(DRUG_SEARCH_PATH, 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
// require escopado ao diretório de drugSearch.ts, pra `require('../data/medications-db.json')'
// (dentro do próprio arquivo) resolver o caminho certo.
const scopedRequire = Module.createRequire(DRUG_SEARCH_PATH);
new Function('module', 'exports', 'require', js)(mod, mod.exports, scopedRequire);
const { getBulaUrl, getPhytoBulaUrl } = mod.exports;

const BULA_BASE = 'https://www.alertamedico.ia.br/bulas';

// ─── PDFs que existem de verdade ────────────────────────────────────────────────
const slugsExistentes = new Set(
  fs.readdirSync(BULAS_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => f.slice(0, -4))
);
console.log(`✓ ${slugsExistentes.size} PDFs encontrados em site/bulas/`);

function slugFromUrl(url) {
  return url.slice(BULA_BASE.length + 1, -'.pdf'.length);
}

// ─── Base de medicamentos ───────────────────────────────────────────────────────
const { medications } = require(path.join(ROOT, 'src/data/medications-db.json'));
console.log(`✓ ${medications.length} entradas em medications-db.json`);

// slug -> linhas { tipo, nome, generico, categoria }
const porSlug = new Map();
// medicamentos cujo slug calculado não tem PDF publicado
const faltando = [];

function registra(slug, url, tipo, nome, genericName, categoria) {
  if (!slugsExistentes.has(slug)) {
    faltando.push({ slug, url, tipo, nome, genericName, categoria });
    return;
  }
  if (!porSlug.has(slug)) porSlug.set(slug, []);
  porSlug.get(slug).push({ tipo, nome, genericName, categoria });
}

for (const entry of medications) {
  const { genericName, brands, category } = entry;
  const isPhyto = category === 'Fitoterápico';
  const getUrl = isPhyto ? getPhytoBulaUrl : getBulaUrl;

  // genérico (sem marca) — é o que o app usa quando não há commercial_name
  // getPhytoBulaUrl pode cair no Google quando não acha no mapa fitoterápico —
  // isso não é uma bula (nem um slug), então não entra em nenhuma das duas listas.
  const urlGenerico = getUrl(genericName, undefined);
  if (urlGenerico.startsWith(BULA_BASE)) {
    registra(slugFromUrl(urlGenerico), urlGenerico, 'generico', genericName, genericName, category);
  }

  for (const brand of brands || []) {
    const url = getUrl(genericName, brand);
    if (!url.startsWith(BULA_BASE)) continue;
    const slug = slugFromUrl(url);
    registra(slug, url, 'comercial', brand, genericName, category);
  }
}

// ─── CSV ────────────────────────────────────────────────────────────────────────
function csvField(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const linhasBulas = [['slug', 'url_pdf', 'tipo', 'nome', 'generico', 'categoria']];
const slugsOrdenados = [...porSlug.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
for (const slug of slugsOrdenados) {
  const itens = porSlug.get(slug).sort((a, b) =>
    a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : (a.tipo === 'generico' ? -1 : 1));
  for (const it of itens) {
    linhasBulas.push([slug, `${BULA_BASE}/${slug}.pdf`, it.tipo, it.nome, it.genericName, it.categoria]);
  }
}
const csvBulas = linhasBulas.map(r => r.map(csvField).join(';')).join('\n') + '\n';
fs.writeFileSync(path.join(OUT_DIR, 'bulas.csv'), csvBulas, 'utf8');

const linhasFaltando = [['slug_calculado', 'url_esperada', 'tipo', 'nome', 'generico', 'categoria']];
for (const f of faltando.sort((a, b) => a.slug.localeCompare(b.slug, 'pt-BR'))) {
  linhasFaltando.push([f.slug, f.url, f.tipo, f.nome, f.genericName, f.categoria]);
}
const csvFaltando = linhasFaltando.map(r => r.map(csvField).join(';')).join('\n') + '\n';
fs.writeFileSync(path.join(OUT_DIR, 'bulas_faltando.csv'), csvFaltando, 'utf8');

console.log(`✓ ${slugsOrdenados.length} bulas com PDF, ${linhasBulas.length - 1} linhas → tools/out/bulas.csv`);

// Cada MARCA vira uma linha própria, então faltando.length conta linhas, não medicamentos —
// e as marcas quase sempre compartilham a bula do genérico. Reportar o total de linhas como
// "medicamentos sem bula" inflava o buraco em quase 3x (948 em vez de 331) e faria alguém
// concluir que a base de bulas está muito pior do que está.
const genericosSemBula = new Set(faltando.filter(f => f.tipo === 'generico').map(f => f.genericName));
console.log(
  `✓ ${genericosSemBula.size} medicamentos sem bula (de ${medications.length}) — ` +
  `${faltando.length} linhas contando marcas → tools/out/bulas_faltando.csv`
);

// PDFs publicados que nenhum medicamento do banco referencia — pode ser nome legado
// (ex.: "aspirina.pdf" substituído por "aas-acido-acetilsalicilico.pdf") ou slug
// divergente que vale conferir na mão.
const orfaos = [...slugsExistentes].filter(s => !porSlug.has(s)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
const csvOrfaos = ['slug;url_pdf', ...orfaos.map(s => `${csvField(s)};${BULA_BASE}/${s}.pdf`)].join('\n') + '\n';
fs.writeFileSync(path.join(OUT_DIR, 'bulas_orfas.csv'), csvOrfaos, 'utf8');
console.log(`✓ ${orfaos.length} PDFs publicados sem nenhum medicamento apontando → tools/out/bulas_orfas.csv`);
