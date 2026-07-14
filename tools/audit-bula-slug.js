#!/usr/bin/env node
/**
 * O slug da bula bate com um PDF que EXISTE?
 *
 * "Losartana Potássica" — como o nome vem escrito na CAIXA — gerava losartana-potassica.pdf,
 * que não existe (a bula publicada é losartana.pdf). O link morria em silêncio e o botão da
 * bula nem aparecia. Este gate compara o slug de CADA nome da base contra a pasta site/bulas,
 * e também contra as variações com sal que o usuário digita à mão.
 *
 * Usa o getBulaUrl REAL (drugSearch.ts transpilado) — auditoria que reimplementa a regra
 * audita a si mesma.
 *
 * USO:  node tools/audit-bula-slug.js          (relatório)
 *       node tools/audit-bula-slug.js --gate   (falha se uma REGRESSÃO aparecer)
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const GATE = process.argv.includes('--gate');
const ts = require(path.join(ROOT, 'node_modules/typescript'));

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
const { getBulaUrl, nomeDaBaseParaBula } = mod.exports;

const DB = require(path.join(ROOT, 'src/data/medications-db.json')).medications;
const BULAS = new Set(
  fs.readdirSync(path.join(ROOT, 'site/bulas'))
    .filter(f => f.endsWith('.pdf'))
    .map(f => f.slice(0, -4))
);

const slugDe = (nome, marca) => getBulaUrl(nome, marca).split('/').pop().replace(/\.pdf$/, '');

// ── 1. todo nome da base tem que continuar achando a sua bula ────────────────
const semBula = [];
for (const e of DB) {
  if (e.category === 'Fitoterápico') continue;
  const slug = slugDe(e.genericName);
  if (!BULAS.has(slug)) semBula.push(`${e.genericName}  →  ${slug}.pdf`);
}

// ── 2. o nome COMO ESTÁ NA CAIXA (com o sal) tem que achar a mesma bula ──────
// Estes são os que o usuário digita à mão e que antes não abriam nada.
const CAIXA = [
  'Losartana Potássica', 'Levotiroxina Sódica', 'Maleato de Enalapril',
  'Cloridrato de Metformina', 'Besilato de Anlodipino',
  'Dipropionato de Betametasona', 'Cloridrato de Sertralina', 'Valproato de Sódio',
  'Cloreto de Potássio', 'Sulfato Ferroso',
];

// Não resolvem, e está CERTO não resolverem — a regra recusa quando é ambíguo, em vez de
// chutar. Ficam aqui para o gate não reclamar deles, e para ninguém "consertar" sem pensar.
const CAIXA_AMBIGUA = {
  'Succinato de Metoprolol':
    'a base tem "Metoprolol" E "Metoprolol Succinato" — succinato (liberação prolongada) e ' +
    'tartarato (imediata) têm bulas DIFERENTES. Resolver para "Metoprolol" abriria a bula ' +
    'errada. Só sai daqui quando a bula do succinato for publicada.',
};
const caixa = CAIXA.map(nome => {
  const slug = slugDe(nome);
  return { nome, slug, base: nomeDaBaseParaBula(nome), ok: BULAS.has(slug) };
});

console.log(`${DB.length} medicamentos · ${BULAS.size} bulas publicadas\n`);

console.log('NOME COMO ESTÁ NA CAIXA:');
for (const c of caixa) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome.padEnd(30)} → ${c.slug}.pdf${c.base ? '   (base: ' + c.base + ')' : '   (não resolveu)'}`);
}
for (const [nome, motivo] of Object.entries(CAIXA_AMBIGUA)) {
  console.log(`  ~ ${nome.padEnd(30)} não resolve DE PROPÓSITO`);
  console.log(`      ${motivo}`);
}

console.log(`\nNOMES DA BASE SEM BULA PUBLICADA: ${semBula.length}`);
for (const s of semBula.slice(0, 12)) console.log('   ' + s);
if (semBula.length > 12) console.log(`   … +${semBula.length - 12}`);

// ── gate ────────────────────────────────────────────────────────────────────
// O teto é o que JÁ existia: muitos fármacos simplesmente não têm bula publicada, e isso não
// é regressão. O que o gate impede é o número CRESCER — ou seja, uma mudança na regra do slug
// quebrar um link que funcionava.
const TETO_SEM_BULA = 331;
const caixaQuebrada = caixa.filter(c => !c.ok);

if (GATE) {
  const falhas = [];
  if (semBula.length > TETO_SEM_BULA) falhas.push(`${semBula.length} nomes da base sem bula (teto ${TETO_SEM_BULA})`);
  if (caixaQuebrada.length) falhas.push(`${caixaQuebrada.length} nome(s) com sal não acham bula: ${caixaQuebrada.map(c => c.nome).join(', ')}`);
  if (falhas.length) {
    console.error('\nGATE: ' + falhas.join(' · '));
    process.exit(1);
  }
  console.log('\n✓ GATE OK');
}
