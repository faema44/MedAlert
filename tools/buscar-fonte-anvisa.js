#!/usr/bin/env node
/**
 * Procura FONTE para as interações órfãs dentro das bulas que já hospedamos.
 *
 * 847 entradas (31%) não têm procedência — e carregam 281 dos 429 alertas CRÍTICOS. Não dá
 * para comprar base licenciada num app gratuito, o drugs.com bloqueia automação no robots.txt,
 * e o Micromedex proíbe redistribuir. Mas a BULA da ANVISA é oficial, é em português, é
 * gratuita e JÁ ESTÁ no nosso disco: 768 medicamentos com seção de interações extraída
 * (src/data/bula-interacoes.json).
 *
 * A lógica é direta: se a bula da Varfarina cita a amiodarona na seção de interações, isso
 * É a fonte da interação Varfarina × Amiodarona. Basta procurar.
 *
 * O CASAMENTO USA A REGRA DE IDENTIDADE DO PRÓPRIO APP (identityTokens, transpilado de
 * drugSearch.ts). Sem isso a busca reencontraria os mesmos alarmes falsos que passamos o dia
 * matando: "cloridrato" apareceria em qualquer bula, "sodio" em quase todas, e o token "bra"
 * casaria dentro de "toBRAmicina". Auditoria que reimplementa a regra audita a si mesma.
 *
 * SÓ CONFIRMA, NUNCA REBAIXA: quem já tem fonte fica como está. E "não achou na bula" NÃO
 * quer dizer que a interação é falsa — quer dizer que ela continua sem lastro que possamos
 * citar, e que o app deve seguir avisando sem afirmar.
 *
 * USO:  node tools/buscar-fonte-anvisa.js            (relatório)
 *       node tools/buscar-fonte-anvisa.js --gravar   (grava source: "ANVISA" nas confirmadas)
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const GRAVAR = process.argv.includes('--gravar');
const ts = require(path.join(ROOT, 'node_modules/typescript'));

// ── regra de identidade REAL do app ──────────────────────────────────────────
const tsPath = path.join(ROOT, 'src/utils/drugSearch.ts');
const src = fs.readFileSync(tsPath, 'utf8');
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const jsPath = path.join(ROOT, 'src/utils/drugSearch.js');
const mod = new Module(jsPath);
mod.filename = jsPath;
mod.paths = Module._nodeModulePaths(path.dirname(jsPath));
mod.require = Module.createRequire(jsPath);
mod._compile(out, jsPath);
const { getBulaUrl, getPhytoBulaUrl, checkInteractions, loadExternalInteractions } = mod.exports;

const DB = require(path.join(ROOT, 'src/data/medications-db.json')).medications;
const INTER = require(path.join(ROOT, 'src/data/interactions.json'));
const BULAS = require(path.join(ROOT, 'src/data/bula-interacoes.json'));
loadExternalInteractions(INTER);

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[()\/+]/g, ' ').replace(/\s+/g, ' ').trim();

const BULA_BASE = 'https://www.alertamedico.ia.br/bulas';
function slugDe(entry) {
  const url = (entry.category === 'Fitoterápico' ? getPhytoBulaUrl : getBulaUrl)(entry.genericName, undefined);
  return url.startsWith(BULA_BASE) ? url.slice(BULA_BASE.length + 1, -4) : null;
}

// genérico do banco -> texto da seção de interações da SUA bula
const bulaDe = new Map();
for (const e of DB) {
  const s = slugDe(e);
  if (s && BULAS[s]) bulaDe.set(e.genericName, { slug: s, ...BULAS[s] });
}

// Palavras do nome de um lado que servem para PROCURAR na bula. Curtas e genéricas ficam de
// fora: "sodio" aparece em quase toda bula, "bra" casaria dentro de "toBRAmicina".
const GENERICAS = new Set([
  'acido', 'cloridrato', 'sulfato', 'sodio', 'potassio', 'calcio', 'ferro', 'zinco', 'cloreto',
  'carbonato', 'fosfato', 'acetato', 'humana', 'ocular', 'suplementos', 'outros', 'medicamentos',
  'inibidores', 'antagonistas', 'agentes', 'derivados', 'sais', 'doses', 'grupo', 'classe',
]);
const buscaveis = nome => [...new Set(norm(nome).split(/[\s,;]+/))]
  .filter(t => t.length >= 6 && !GENERICAS.has(t));

// A bula cita `alvo`? Devolve a PALAVRA que casou (ou null). Exige começo de palavra, para
// não casar substring solta no meio de outro nome.
function bulaCita(texto, alvo) {
  const t = norm(texto);
  return alvo.find(p => new RegExp(`(^|[^a-z])${p.slice(0, -1)}`, 'i').test(t)) ?? null;
}

// A palavra que confirmou é o NOME de um fármaco, ou o nome de uma CLASSE?
//   nominal  — a bula da claritromicina diz "lovastatina ou sinvastatina". Citação forte.
//   classe   — a bula do lítio diz "uso de diuréticos, pois o risco de intoxicação se eleva".
//              Também é citação legítima (tiazídico É diurético), mas é mais larga.
// As duas valem como fonte ANVISA; a distinção existe para não vendermos uma pela outra.
const NOMES_DE_FARMACO = new Set(
  DB.flatMap(e => norm(e.genericName).split(/[\s,]+/)).filter(t => t.length >= 6)
);
const ehNominal = palavra => NOMES_DE_FARMACO.has(palavra);

// Quais genéricos do banco pertencem a cada lado da interação.
//
// Aqui NÃO dá para chamar checkInteractions() por par: seriam 768 genéricos × 847 órfãs × 2
// lados, cada chamada varrendo 2768 interações — bilhões de operações. Então o casamento é
// feito com os tokens de identidade, PRÉ-COMPUTADOS uma vez por nome.
//
// A regra é a mesma do drugSearch.ts (sal/forma não é identidade; contra-íon é marcado pelo
// genitivo; peça curta só casa em início de palavra). Ela está replicada de propósito — e o
// que ela decide aqui é só QUEM PROCURAR na bula. Quem dá o veredito final é a BULA: ou ela
// cita o outro fármaco, ou não cita.
const SEM_IDENTIDADE = new Set([
  'acido', 'acida', 'cloridrato', 'dicloridrato', 'bromidrato', 'mesilato', 'besilato',
  'maleato', 'tartarato', 'succinato', 'fumarato', 'valerato', 'propionato', 'dipropionato',
  'furoato', 'pamoato', 'oxalato', 'gluconato', 'acetato', 'citrato', 'lactato', 'nitrato',
  'sulfato', 'cloreto', 'carbonato', 'bicarbonato', 'fosfato', 'hidroxido', 'oxido',
  'humana', 'humano', 'ocular', 'oftalmico', 'topico', 'sais', 'suplementos',
  'com', 'sem', 'dos', 'das', 'por', 'para', 'seus', 'suas', 'outros', 'outras',
]);
const IONS = new Set([
  'sodio', 'sodica', 'sodico', 'potassio', 'potassica', 'potassico', 'calcio', 'calcica',
  'calcico', 'magnesio', 'aluminio', 'zinco', 'ferro', 'ferroso', 'ferrica', 'ferrico',
]);
const GENITIVOS = new Set(['de', 'do', 'da']);

function identidade(nome) {
  const set = new Set();
  for (const alt of nome.split(/[/+()]/)) {
    const seq = norm(alt).split(/[\s,]+/).filter(Boolean);
    const palavras = seq.filter(t => t.length >= 3 && !SEM_IDENTIDADE.has(t));
    const contra = new Set();
    for (let k = 1; k < seq.length; k++) {
      if (IONS.has(seq[k]) && GENITIVOS.has(seq[k - 1])) contra.add(seq[k]);
    }
    const resto = palavras.filter(t => !contra.has(t));
    for (const t of (resto.length ? resto : palavras)) set.add(t);
  }
  return [...set];
}
const casa = (a, b) => (a.length >= 6 ? b.includes(a) : b.split(/[\s-]+/).some(w => w.startsWith(a)));
const ligados = (as, bs) => as.some(a => bs.some(b => casa(a, b) || casa(b, a)));

const idDoGenerico = new Map([...bulaDe.keys()].map(g => [g, identidade(g)]));

function genericosDoLado(inter, lado) {
  const tk = identidade(lado === 1 ? inter.drug1 : inter.drug2);
  return [...bulaDe.keys()].filter(g => ligados(tk, idDoGenerico.get(g)));
}

const orfas = INTER.filter(i => !i.source || i.source === 'desconhecida');
console.log(`${INTER.length} interações · ${orfas.length} sem fonte (${orfas.filter(i => i.risk_level === 'critical').length} críticas)`);
console.log(`${bulaDe.size} medicamentos do banco têm seção de interações na bula\n`);

const confirmadas = new Map();   // id -> { bula, slug, cabecalho }
for (const i of orfas) {
  for (const lado of [1, 2]) {
    const alvo = buscaveis(lado === 1 ? i.drug2 : i.drug1);
    if (!alvo.length) continue;
    for (const g of genericosDoLado(i, lado)) {
      const b = bulaDe.get(g);
      if (!b) continue;
      // Procura nas DUAS seções. A contraindicação não é um extra: interação fatal não é
      // chamada de "interação" na bula, é PROIBIÇÃO — a sildenafila só cita nitrato lá.
      const emInter = b.texto ? bulaCita(b.texto, alvo) : null;
      const emContra = !emInter && b.contra ? bulaCita(b.contra, alvo) : null;
      const palavra = emInter || emContra;
      if (!palavra) continue;
      confirmadas.set(i.id, {
        medicamento: g, slug: b.slug,
        secao: emInter ? 'interações' : 'contraindicações',
        palavra, nominal: ehNominal(palavra),
      });
      break;
    }
    if (confirmadas.has(i.id)) break;
  }
}

const crit = orfas.filter(i => i.risk_level === 'critical');
const critOk = crit.filter(i => confirmadas.has(i.id)).length;
const nominais = [...confirmadas.values()].filter(c => c.nominal).length;
console.log(`CONFIRMADAS pela bula: ${confirmadas.size} de ${orfas.length}  (${Math.round(100 * confirmadas.size / orfas.length)}%)`);
console.log(`   citando o FÁRMACO pelo nome: ${nominais}`);
console.log(`   citando só a CLASSE:         ${confirmadas.size - nominais}   (ex.: a bula do lítio diz "diuréticos", não "tiazídico")`);
console.log(`   entre as CRÍTICAS:  ${critOk} de ${crit.length}  (${Math.round(100 * critOk / crit.length)}%)\n`);

console.log('AMOSTRA (críticas confirmadas):');
for (const i of crit.filter(x => confirmadas.has(x.id)).slice(0, 10)) {
  const c = confirmadas.get(i.id);
  console.log(`   [${i.id}] ${i.drug1}  ×  ${i.drug2}`);
  console.log(`        bula de ${c.medicamento} → ${c.secao}, casou em "${c.palavra}" ${c.nominal ? '(nome)' : '(classe)'}`);
}
console.log('\nAINDA SEM FONTE (críticas):');
for (const i of crit.filter(x => !confirmadas.has(x.id)).slice(0, 10)) {
  console.log(`   [${i.id}] ${i.drug1}  ×  ${i.drug2}`);
}

if (!GRAVAR) { console.log('\n[relatório] use --gravar para escrever source: "ANVISA" nas confirmadas'); process.exit(0); }

// Guarda TAMBÉM qual bula confirmou: sem isso o app diria "fonte: ANVISA" sem poder mostrar
// ONDE — e citação que não se pode conferir não vale muito mais que afirmação sem fonte.
const saida = INTER.map(i => {
  const c = confirmadas.get(i.id);
  if (!c) return i;
  const { id, source, ...resto } = i;
  return { id, source: 'ANVISA', source_bula: c.slug, ...resto };
});
fs.writeFileSync(path.join(ROOT, 'src/data/interactions.json'), JSON.stringify(saida, null, 2) + '\n');
console.log(`\n✓ ${confirmadas.size} entradas marcadas com source: "ANVISA" + source_bula`);
