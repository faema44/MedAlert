#!/usr/bin/env node
/**
 * Onde a bula do FDA coloca cada par de SANGRAMENTO — para decidir o NÍVEL.
 *
 * Contexto: 17 entradas marcadas `moderate` descrevem o desfecho como "hemorragia grave". O
 * selo diz Moderado e o texto diz grave. Antes de mexer no texto (que amaciaria o alerta) é
 * preciso saber se o erro está no NÍVEL.
 *
 * O critério é o mesmo que o projeto já usa: confirmação de TEXTO, não geração. A pergunta ao
 * openFDA é onde a bula de A cita B:
 *
 *   boxed_warning        → é o aviso mais forte que existe numa bula americana
 *   contraindications    → "não use junto" (a lição da sildenafila: interação fatal não é
 *                          chamada de interação, é proibição)
 *   warnings_and_cautions→ advertência
 *   drug_interactions    → menção comum
 *
 * Isto NÃO decide sozinho: entrega a evidência para a decisão humana. Nenhum nível é gravado.
 *
 * USO:  node tools/classificar-sangramento-fda.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(require('os').tmpdir(), 'medalert-fda-sangramento.json');

// PT → EN. Escrito à mão porque são 17 pares: tradução morfológica erraria
// ("varfarina"→"varfarine") e o RxNav seria uma dependência a mais para 30 nomes.
const EN = {
  'Arnica montana': 'arnica', 'Varfarina': 'warfarin',
  'Ácido acetilsalicílico': 'aspirin', 'Ibuprofeno': 'ibuprofen',
  'Allium sativum (Alho medicinal)': 'garlic', 'Aspirina': 'aspirin',
  'Dalteparina': 'dalteparin', 'Itraconazol': 'itraconazole',
  'Enoxaparina': 'enoxaparin', 'Fondaparinux': 'fondaparinux',
  'Griseofulvina': 'griseofulvin', 'Heparina': 'heparin', 'Ticlopidina': 'ticlopidine',
  'Omeprazol': 'omeprazole', 'Cilostazol': 'cilostazol', 'Dabigatrana': 'dabigatran',
  'Rivaroxabana': 'rivaroxaban', 'Prasugrel': 'prasugrel', 'Ticagrelor': 'ticagrelor',
  'Cefazolina': 'cefazolin', 'Ceftriaxona': 'ceftriaxone',
  'Fluoxetina': 'fluoxetine', 'Álcool/etanol': 'alcohol', 'Nadroparina': 'nadroparin',
};

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const salvar = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

function get(url) {
  return new Promise(res => {
    https.get(url, { headers: { 'User-Agent': 'MedAlert-audit' } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}

const SECOES = ['boxed_warning', 'contraindications', 'warnings_and_cautions', 'drug_interactions'];

async function label(en) {
  if (cache[en]) return cache[en];
  const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:%22${encodeURIComponent(en)}%22&limit=5`;
  const j = await get(url);
  const secs = {};
  for (const s of SECOES) secs[s] = '';
  for (const r of (j && j.results) || []) {
    for (const s of SECOES) if (r[s]) secs[s] += ' ' + [].concat(r[s]).join(' ');
  }
  cache[en] = secs; salvar();
  await new Promise(r => setTimeout(r, 400));   // educado com a API
  return secs;
}

// A bula americana cita CLASSE, não o nome: o boxed warning da enoxaparina fala de "NSAIDs",
// nunca de "ibuprofen". Procurar só o nome dava "não citado" para pares que estão na advertência
// mais forte que existe — falso negativo na direção perigosa. Cada fármaco carrega, além do
// próprio nome, os termos de classe sob os quais a bula do outro o mencionaria.
const CLASSE = {
  ibuprofen:    ['NSAID', 'nonsteroidal anti-?inflammatory'],
  aspirin:      ['NSAID', 'nonsteroidal anti-?inflammatory', 'salicylate', 'antiplatelet', 'platelet aggregation inhibitor'],
  ticlopidine:  ['antiplatelet', 'platelet aggregation inhibitor', 'thienopyridine'],
  prasugrel:    ['antiplatelet', 'platelet aggregation inhibitor', 'thienopyridine'],
  ticagrelor:   ['antiplatelet', 'platelet aggregation inhibitor'],
  cilostazol:   ['antiplatelet', 'platelet aggregation inhibitor'],
  warfarin:     ['anticoagulant', 'vitamin K antagonist'],
  heparin:      ['anticoagulant'],
  enoxaparin:   ['anticoagulant', 'low molecular weight heparin'],
  dalteparin:   ['anticoagulant', 'low molecular weight heparin'],
  nadroparin:   ['anticoagulant', 'low molecular weight heparin'],
  fondaparinux: ['anticoagulant'],
  dabigatran:   ['anticoagulant'],
  rivaroxaban:  ['anticoagulant'],
  cefazolin:    ['cephalosporin'],
  ceftriaxone:  ['cephalosporin'],
  fluoxetine:   ['SSRI', 'serotonin reuptake inhibitor'],
};

/** Onde a bula de `de` cita `alvo` (pelo nome OU pela classe dele) — seção mais forte. */
async function onde(de, alvo) {
  const secs = await label(de);
  if (!secs) return null;
  const termos = [alvo, ...(CLASSE[alvo] || [])];
  const re = new RegExp(termos.map(t => `\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|'), 'i');
  for (const s of SECOES) if (secs[s] && re.test(secs[s])) return s;
  return null;
}

(async () => {
  const inter = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/interactions.json'), 'utf8'));
  const alvos = inter.filter(e => e.risk_level === 'moderate'
    && /grave|fatal/i.test(e.risk_description || '')
    && /hemorrag|sangramento/i.test(e.risk_description || ''));

  console.log(`\n  ${alvos.length} pares de sangramento — onde a bula do FDA cita cada um\n`);
  const peso = { boxed_warning: 4, contraindications: 3, warnings_and_cautions: 2, drug_interactions: 1 };
  const linhas = [];

  for (const e of alvos) {
    const a = EN[e.drug1], b = EN[e.drug2];
    if (!a || !b) { linhas.push([e.id, `${e.drug1} + ${e.drug2}`, 'SEM TRADUÇÃO', 0]); continue; }
    const ab = await onde(a, b);
    const ba = await onde(b, a);
    const melhor = [ab, ba].filter(Boolean).sort((x, y) => peso[y] - peso[x])[0] || null;
    linhas.push([e.id, `${e.drug1} + ${e.drug2}`, melhor || '— não citado —', peso[melhor] || 0]);
  }

  linhas.sort((x, y) => y[3] - x[3]);
  for (const [id, par, sec] of linhas) console.log(`  ${id.padEnd(9)} ${par.padEnd(46)} ${sec}`);

  console.log(`\n  boxed_warning/contraindications = evidência para SUBIR o nível.`);
  console.log(`  drug_interactions apenas         = menção comum, moderate defensável.`);
  console.log(`  não citado                       = o FDA não sustenta; olhar a fonte original.\n`);
})();
