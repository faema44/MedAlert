// Combinados: o PDF que o APP pediria cita TODOS os ativos, ou só o primeiro?
//
// O risco desta família é específico: combo e ingrediente puro colidem no mesmo slug quando o
// slug sai do primeiro ingrediente. Quem toma "Losartana + Hidroclorotiazida" abriria a bula da
// losartana pura — mesmo fármaco no título, metade do remédio faltando na bula.
//
// Usa o getBulaUrl DE VERDADE (transpilado de drugSearch.ts), não uma reimplementação: o que
// interessa é o arquivo que o app pede, não o que eu acho que ele pede.
const fs = require('fs');
const path = require('path');
const os = require('os');
const ts = require('typescript');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const BULAS_DIR = path.join(ROOT, 'site', 'bulas');
const TXT_DIR = path.join(os.tmpdir(), 'medalert-bulas-txt');
const DRUG_SEARCH = path.join(ROOT, 'src/utils/drugSearch.ts');

const js = ts.transpileModule(fs.readFileSync(DRUG_SEARCH, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, Module.createRequire(DRUG_SEARCH));
const { getBulaUrl } = mod.exports;

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const { medications } = require(path.join(ROOT, 'src/data/medications-db.json'));
const combos = medications.filter(m => (m.genericName || '').includes('+'));

let temTudo = 0, semPdf = [], soUm = [], semTexto = [];

for (const m of combos) {
  const url = getBulaUrl(m.genericName, m.brandNames && m.brandNames[0]);
  const arquivo = url.split('/').pop();
  const base = arquivo.replace(/\.pdf$/, '');
  if (!fs.existsSync(path.join(BULAS_DIR, arquivo))) { semPdf.push(`${m.genericName}  →  ${arquivo}`); continue; }

  const txtPath = path.join(TXT_DIR, `${base}.txt`);
  if (!fs.existsSync(txtPath)) { semTexto.push(arquivo); continue; }
  const txt = norm(fs.readFileSync(txtPath, 'utf8').slice(0, 5000));

  const ings = m.genericName.split('+').map(s => s.trim());
  // Radical de 8 letras: casa "hidroclorotiazida" com a grafia da bula sem casar coisas curtas.
  const faltando = ings.filter(i => {
    const raiz = norm(i).split(' ').filter(w => w.length >= 5).map(w => w.slice(0, 8));
    return raiz.length > 0 && !raiz.some(r => txt.includes(r));
  });
  if (faltando.length) soUm.push(`${arquivo}  → não cita: ${faltando.join(', ')}  (de "${m.genericName}")`);
  else temTudo++;
}

console.log(`\n  ${combos.length} medicamentos combinados na base\n`);
console.log(`  ✓ PDF presente e citando TODOS os ativos: ${temTudo}`);
console.log(`  · sem PDF publicado (backlog conhecido):  ${semPdf.length}`);
if (semTexto.length) console.log(`  · PDF sem texto extraído ainda:          ${semTexto.length}`);

if (soUm.length) {
  console.log(`\n  ✗ PDF serve o combo mas NÃO cita todos os ativos: ${soUm.length}`);
  for (const l of soUm) console.log(`      ${l}`);
} else {
  console.log('\n  ✓ Nenhum combo abrindo bula que esquece um dos ativos.');
}
console.log('');
if (process.argv.includes('--gate') && soUm.length) process.exit(1);
