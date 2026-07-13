#!/usr/bin/env node
/**
 * Auditoria do MOTOR de interações — não do conteúdo da base.
 *
 * O casamento fármaco × interação quebra o nome da interação em palavras e aceita o alerta
 * se UMA delas casar. Isso já produziu 1273 alertas falsos: "Cloridrato de Cefepime"
 * (antibiótico) herdava o alerta do "Cloridrato de amiodarona"; "Ergotamina" herdava o da
 * "Colchicina (gota)" porque contém "gota"; "Aminoácidos" virava um NOAC ("ami-NOAC-idos").
 * Alarme falso em app de medicamento não é ruído inofensivo — ensina o usuário a ignorar o
 * alerta que importa.
 *
 * Duas checagens, ambas usando a checkInteractions() REAL (o drugSearch.ts é transpilado,
 * nunca reimplementado — auditoria que reimplementa a regra audita a si mesma):
 *
 *   1. ALARME FALSO: fármaco que só casa com a interação por um token que não identifica
 *      princípio ativo (sal, éster, forma, conectivo). Tem que ser ZERO.
 *   2. ALERTA MORTO: interação que não dispara nem para os seus próprios dois fármacos.
 *      Tem que ser ZERO — senão a entrada existe na base e nunca avisa ninguém.
 *
 * USO:  node tools/audit-interactions.js          (relatório)
 *       node tools/audit-interactions.js --gate   (falha o build se houver qualquer um)
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const GATE = process.argv.includes('--gate');
const ts = require(path.join(ROOT, 'node_modules/typescript'));

// ── carrega o drugSearch.ts de produção ──────────────────────────────────────
const tsPath = path.join(ROOT, 'src/utils/drugSearch.ts');
const out = ts.transpileModule(fs.readFileSync(tsPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const jsPath = path.join(ROOT, 'src/utils/drugSearch.js');
const mod = new Module(jsPath);
mod.filename = jsPath;
mod.paths = Module._nodeModulePaths(path.dirname(jsPath));
mod.require = Module.createRequire(jsPath);
mod._compile(out, jsPath);
const { checkInteractions, loadExternalInteractions } = mod.exports;

const DB = require(path.join(ROOT, 'src/data/medications-db.json')).medications;
const INTER = require(path.join(ROOT, 'src/data/interactions.json'));
loadExternalInteractions(INTER);   // sem isto ALL_INTERACTIONS fica VAZIO e tudo "passa"

// sanidade do próprio arnês: se este par não alerta, o teste está quebrado, não a base
if (checkInteractions('Varfarina', ['AAS']).length === 0) {
  console.error('ARNÊS QUEBRADO: Varfarina + AAS não alertou — a base não carregou.');
  process.exit(2);
}

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[()\/+]/g, ' ').replace(/\s+/g, ' ').trim();

// Espelha GENERIC_QUALIFIER_TOKENS do drugSearch.ts. Só serve para PROPOR suspeitos —
// quem dá o veredito final é sempre a checkInteractions() acima.
const SEM_IDENTIDADE = new Set([
  'acido', 'acida',
  'cloridrato', 'dicloridrato', 'bromidrato', 'mesilato', 'besilato', 'maleato',
  'tartarato', 'succinato', 'fumarato', 'valerato', 'propionato', 'dipropionato',
  'furoato', 'pamoato', 'oxalato', 'gluconato', 'acetato', 'citrato', 'lactato', 'nitrato',
  'sulfato', 'cloreto', 'carbonato', 'bicarbonato', 'fosfato',
  'humana', 'humano', 'ocular', 'oftalmico', 'topico', 'sais', 'suplementos',
  'com', 'sem', 'dos', 'das', 'por', 'para', 'seus', 'suas', 'outros', 'outras',
]);
const palavras = d => norm(d).split(/[\s,]+/).filter(t => t.length >= 3);

// ── 1. alarme falso ──────────────────────────────────────────────────────────
const genericos = DB.map(e => e.genericName).filter(g => norm(g).length >= 3);
const falsos = [];
for (const it of INTER) {
  for (const lado of ['drug1', 'drug2']) {
    const t = palavras(it[lado]);
    const vazios = t.filter(x => SEM_IDENTIDADE.has(x));
    if (!vazios.length) continue;
    const identidade = t.filter(x => !SEM_IDENTIDADE.has(x));
    const outro = it[lado === 'drug1' ? 'drug2' : 'drug1'];
    for (const g of genericos) {
      const n = norm(g);
      if (!vazios.some(x => x.includes(n) || n.includes(x))) continue;      // não casa nem pelo token vazio
      if (identidade.some(x => x.includes(n) || n.includes(x))) continue;   // casa pelo nome real: legítimo
      if (checkInteractions(g, [outro]).some(r => r.id === it.id)) {
        falsos.push({ id: it.id, generico: g, inter: it[lado], outro, risco: it.risk_level });
      }
    }
  }
}

// ── 2. alerta morto ──────────────────────────────────────────────────────────
const mortos = INTER.filter(i => !checkInteractions(i.drug1, [i.drug2]).some(r => r.id === i.id));

// ── relatório ────────────────────────────────────────────────────────────────
console.log(`${DB.length} medicamentos · ${INTER.length} interações\n`);

if (falsos.length) {
  console.log(`🔴 ALARME FALSO (${falsos.length}) — o fármaco não tem nada a ver com a interação`);
  for (const f of falsos.slice(0, 25)) {
    console.log(`   ${f.generico}  →  herda "${f.inter}" × ${f.outro}  [${f.id} ${f.risco}]`);
  }
  if (falsos.length > 25) console.log(`   … +${falsos.length - 25}`);
  console.log();
} else {
  console.log('✓ nenhum alarme falso por token sem identidade');
}

if (mortos.length) {
  console.log(`\n⚫ ALERTA MORTO (${mortos.length}) — a interação não dispara nem para os próprios fármacos`);
  for (const i of mortos.slice(0, 25)) console.log(`   [${i.id}] ${i.drug1}  ×  ${i.drug2}`);
  if (mortos.length > 25) console.log(`   … +${mortos.length - 25}`);
} else {
  console.log('✓ toda interação dispara para os seus próprios dois fármacos');
}

if (GATE && (falsos.length || mortos.length)) {
  console.error(`\nGATE: ${falsos.length} alarme(s) falso(s) e ${mortos.length} alerta(s) morto(s).`);
  process.exit(1);
}
