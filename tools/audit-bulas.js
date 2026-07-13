#!/usr/bin/env node
/**
 * Audita o CONTEÚDO dos PDFs publicados em site/bulas: confere se a bula que o app
 * abre para um medicamento é mesmo a bula daquele medicamento.
 *
 * O erro que isso pega (já aconteceu duas vezes): a bula de um medicamento COMPOSTO
 * é salva no slug do primeiro princípio ativo, então "Bupropiona" abre a bula do
 * Contrave (naltrexona + bupropiona). O nome do arquivo fica certo, o conteúdo não —
 * nenhuma checagem de slug pega isso, só a leitura do PDF.
 *
 * Usa o getBulaUrl REAL de src/utils/drugSearch.ts (transpilado na hora), igual
 * tools/export-bulas-csv.js — a auditoria testa o que o app faz, não uma cópia.
 *
 * Pré-requisito: texto dos PDFs já extraído com
 *   pdftotext -enc UTF-8 -f 1 -l 2 <pdf> <txtdir>/<slug>.txt
 * (o -enc UTF-8 não é opcional: sem ele os acentos viram lixo e tudo vira falso positivo)
 *
 * USO: node tools/audit-bulas.js <txtdir>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Module } = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const DRUG_SEARCH_PATH = path.join(ROOT, 'src/utils/drugSearch.ts');
const BULAS_DIR = path.join(ROOT, 'site/bulas');

// Texto dos PDFs. Sem argumento, extrai sozinho num cache temporário (só o que mudou) —
// assim `npm run test:bulas` roda sem preparo nenhum.
const TXT_DIR = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1])
  || path.join(os.tmpdir(), 'medalert-bulas-txt');

function extrairTextos() {
  fs.mkdirSync(TXT_DIR, { recursive: true });
  const pdfs = fs.readdirSync(BULAS_DIR).filter(f => f.endsWith('.pdf'));
  let novos = 0;
  for (const pdf of pdfs) {
    const txt = path.join(TXT_DIR, `${pdf.slice(0, -4)}.txt`);
    const src = path.join(BULAS_DIR, pdf);
    if (fs.existsSync(txt) && fs.statSync(txt).mtimeMs >= fs.statSync(src).mtimeMs) continue;
    // -enc UTF-8 não é opcional: sem ele os acentos viram lixo e tudo vira falso positivo
    const r = spawnSync('pdftotext', ['-enc', 'UTF-8', '-f', '1', '-l', '6', src, txt]);
    if (r.error) {
      console.error('pdftotext não encontrado — instale o poppler (é ele que lê o PDF).');
      process.exit(2);
    }
    novos++;
  }
  if (novos) console.log(`✓ texto extraído de ${novos} PDF(s) novo(s)/alterado(s)`);
}
extrairTextos();

const srcTs = fs.readFileSync(DRUG_SEARCH_PATH, 'utf8');
const js = ts.transpileModule(srcTs, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, Module.createRequire(DRUG_SEARCH_PATH));
const { getBulaUrl, getPhytoBulaUrl } = mod.exports;

const BULA_BASE = 'https://www.alertamedico.ia.br/bulas';
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const { medications } = require(path.join(ROOT, 'src/data/medications-db.json'));

// Princípios ativos que a bula tem que citar. Nem todo composto usa "+":
// "Sulfametoxazol-trimetoprima" une os dois por hífen, e procurar a string literal
// (que não existe em bula nenhuma) reprovaria a bula CERTA do Bactrim. Mas hífen nem
// sempre separa ativo ("Interferon beta-1a"), então só desmembra quando sobram 2+
// pedaços com cara de nome de fármaco (>= 6 letras).
// Espelha ativos_esperados() em site/bulas/download_bulas.py.
function ativosEsperados(genericName) {
  return genericName.split('+').flatMap(p => {
    const parte = norm(p.split('(')[0].split('/')[0]);
    if (!parte) return [];
    const sub = parte.split('-').map(s => s.trim()).filter(s => s.length >= 6);
    return sub.length >= 2 ? sub : [parte];
  });
}

// ─── slug -> medicamentos do banco que apontam pra ele ─────────────────────────
const existentes = new Set(
  fs.readdirSync(BULAS_DIR).filter(f => f.endsWith('.pdf')).map(f => f.slice(0, -4)));

const porSlug = new Map();   // slug -> [{ genericName, parts:Set }]
const semPdf = [];           // medicamento cujo slug não tem PDF publicado

for (const entry of medications) {
  const { genericName, category } = entry;
  const url = (category === 'Fitoterápico' ? getPhytoBulaUrl : getBulaUrl)(genericName, undefined);
  if (!url.startsWith(BULA_BASE)) continue;            // fitoterápico que cai no Google
  const slug = url.slice(BULA_BASE.length + 1, -4);
  const parts = new Set(ativosEsperados(genericName));
  if (!existentes.has(slug)) { semPdf.push({ genericName, slug, category }); continue; }
  if (!porSlug.has(slug)) porSlug.set(slug, []);
  porSlug.get(slug).push({ genericName, parts, category });
}

// ─── vocabulário de princípios ativos, pra achar ingrediente ESTRANHO na bula ──
// só nomes longos: "sal", "ferro", "acido" dariam falso positivo em qualquer texto
// EXCIPIENTES: estão no banco como suplemento (estearato de magnésio, manitol…), mas
// aparecem na composição de QUALQUER comprimido — como princípio ativo intruso são
// sempre falso positivo.
const EXCIPIENTES = [
  'magnesio', 'carmelose', 'manitol', 'carbonato de calcio', 'cloreto de sodio',
  'acido citrico', 'acido ascorbico', 'simeticona', 'dioxido de titanio',
  'bicarbonato de sodio', 'sacarose', 'lactose', 'povidona', 'glicose',
];
const VOCAB = [];
for (const { genericName } of medications) {
  for (const p of genericName.split('+')) {
    const n = norm(p.split('(')[0].split('/')[0]);
    if (n.length >= 7 && !VOCAB.includes(n) && !EXCIPIENTES.some(e => n.includes(e) || e.includes(n))) VOCAB.push(n);
  }
}

// Palavras de sal/ligação que aparecem no nome mas NÃO identificam o princípio ativo:
// sem isto "Ferro Sulfato" casa com "sulfato de glicosamina" pela palavra "sulfato".
const SAIS = new Set([
  'cloridrato', 'dicloridrato', 'sulfato', 'acetato', 'fosfato', 'citrato',
  'succinato', 'maleato', 'mesilato', 'besilato', 'bromidrato', 'tartarato',
  'fumarato', 'nitrato', 'gluconato', 'carbonato', 'pidolato', 'oxalato',
  'sodico', 'sodica', 'potassico', 'calcico', 'calcica', 'monoidratado',
  'monoidratada', 'hidratado', 'hidratada', 'acido', 'complexo',
]);

// Sal/forma distinguem PRODUTOS diferentes do mesmo fármaco: benzilpenicilina benzatina
// (IM de depósito) não é a potássica (EV); insulina NPH não é a regular.
const QUALIFICADORES = [
  'benzatina', 'procaina', 'potassica', 'cristalina',
  'nph', 'regular', 'glargina', 'lispro', 'aspart', 'detemir', 'degludeca',
  'succinato', 'tartarato',
];

// raiz do nome, pra casar "bupropiona" com "cloridrato de bupropiona" e plurais/sais
const raiz = n => n.replace(/[aeo]$/, '');
const mencionado = (texto, ing) => texto.includes(raiz(ing));

// Tolera variação de sufixo ("Zoledronato" ↔ "ácido zoledrônico") cortando as 4 letras
// finais de nome longo. Cortar mais abriria a porta pro bug original: com prefixo curto,
// "eritromicina" casaria com ERITROMAX (que é alfaepoetina). "eritromi" não casa com
// "eritromax" — o corte tem que ser conservador.
const em = (t, alvo) => alvo.includes(t) || (t.length >= 9 && alvo.includes(t.slice(0, -4)));

// Palavras do nome que de fato identificam o fármaco (sem sal, sem palavra curta).
const tokensDe = nome => norm(nome).split(/[\s\-+]+/).filter(t => t.length >= 5 && !SAIS.has(t));

// ─── auditoria ─────────────────────────────────────────────────────────────────
const erradas = [];   // nenhum princípio ativo esperado aparece na bula
const combos = [];    // bula é de composto, mas está num slug de ingrediente puro
const vazias = [];    // PDF sem texto extraível (provável scan/imagem)

for (const [slug, meds] of porSlug) {
  const txtPath = path.join(TXT_DIR, `${slug}.txt`);
  if (!fs.existsSync(txtPath)) continue;
  const bruto = fs.readFileSync(txtPath, 'utf8');
  if (norm(bruto).replace(/[^a-z]/g, '').length < 40) { vazias.push({ slug, meds: meds.map(m => m.genericName) }); continue; }

  const texto = norm(bruto);
  // Identificação do medicamento = as primeiras linhas ("MARCA® (ativo1 + ativo2) / laboratório
  // / forma farmacêutica / concentração"). É só aí que um segundo princípio ativo significa
  // medicamento COMPOSTO — mais pra baixo ele pode ser só menção em interação/composição.
  const ident = norm(bruto.split('\n').filter(l => l.trim()).slice(0, 3).join(' '));

  for (const med of meds) {
    const esperados = [...med.parts];
    // Uma palavra só do nome também vale: biológico no Brasil inverte e cola o nome
    // ("Interferon beta-1a" → "betainterferona 1a", "Epoetina alfa" → "alfaepoetina"),
    // então o nome inteiro nunca casa, mas "interferon"/"epoetina" casa dentro da palavra colada.
    const tokens = tokensDe(med.genericName);
    const citado = esperados.some(e => mencionado(texto, e)) || tokens.some(t => em(t, texto));

    if (!citado) {
      erradas.push({ slug, generico: med.genericName, ident: ident.slice(0, 110), motivo: 'não cita o princípio ativo' });
      continue;
    }

    // Sal/forma diferente é outro medicamento, não sinônimo.
    const q = QUALIFICADORES.find(q => esperados.join(' ').includes(q) && !texto.includes(q));
    if (q) {
      erradas.push({ slug, generico: med.genericName, ident: ident.slice(0, 110), motivo: `não é a forma '${q}'` });
      continue;
    }

    if (med.parts.size !== 1) continue;

    // princípio ativo que NÃO faz parte do genérico, declarado na identificação:
    // bula de medicamento COMPOSTO salva no slug do ingrediente puro (caso Bupropiona/Contrave).
    // Compartilhar o radical com o esperado ⇒ é o mesmo fármaco com outro nome, não intruso.
    const intrusos = VOCAB.filter(v =>
      mencionado(ident, v) &&
      !esperados.some(e => v.includes(raiz(e)) || raiz(e).includes(raiz(v))) &&
      !tokens.some(t => em(t, v)));
    // NÃO deduzir "é composto" de um "+" no texto: lá ele também significa "pó + diluente"
    // e reprovaria ~30 bulas corretas. Composto com ativo fora do banco é barrado na origem,
    // pelo NOME do produto no catálogo do fabricante (ver corrigir_bulas_sara.py).
    if (intrusos.length > 0) {
      combos.push({ slug, generico: med.genericName, intrusos, ident: ident.slice(0, 110) });
    }
  }
}

// ─── PDFs IDÊNTICOS em slugs diferentes ───────────────────────────────────────
// A validação de conteúdo acima só procura intruso nas 3 PRIMEIRAS linhas da bula, para
// não afogar em falso positivo. Isso a deixa CEGA para a capa que só traz o nome comercial:
// umeclidinio.pdf era o Trelegy ("Trelegy® / 100mcg + 62,5 mcg + 25 mcg"), uma TRIPLA, e
// passava — nenhum princípio ativo escrito na capa para delatar o intruso.
// O hash não depende de texto nenhum: se dois slugs têm o MESMO arquivo, um dos dois está
// errado, salvo alias legítimo (pravastatina / pravastatina-sodica).
const porHash = new Map();
for (const slug of existentes) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(BULAS_DIR, `${slug}.pdf`))).digest('hex');
  if (!porHash.has(h)) porHash.set(h, []);
  porHash.get(h).push(slug);
}
const duplicados = [...porHash.values()]
  .filter(g => g.length > 1)
  .map(g => g.sort())
  .sort((a, b) => a[0].localeCompare(b[0]));

const linha = '─'.repeat(78);
console.log(`\n${linha}\nAUDITORIA DE CONTEÚDO DAS BULAS`);
console.log(`${existentes.size} PDFs publicados · ${porSlug.size} slugs referenciados pelo app\n${linha}`);

console.log(`\n🟣 MESMO PDF EM SLUGS DIFERENTES (${duplicados.length}) — um dos dois está errado`);
for (const g of duplicados) console.log(`   ${g.join('  ==  ')}`);

console.log(`\n🔴 BULA DE OUTRO MEDICAMENTO (${erradas.length}) — o PDF não confere com o princípio ativo`);
for (const e of erradas) console.log(`   ${e.slug}.pdf  ←  "${e.generico}"  (${e.motivo})\n      bula: ${e.ident}`);

console.log(`\n🟠 BULA DE COMPOSTO EM SLUG DE INGREDIENTE PURO (${combos.length}) — o caso Bupropiona/Contrave`);
for (const c of combos) console.log(`   ${c.slug}.pdf  ←  "${c.generico}"  (bula também traz: ${c.intrusos.join(', ')})\n      bula: ${c.ident}`);

console.log(`\n⚪ PDF SEM TEXTO EXTRAÍVEL (${vazias.length}) — provável digitalização, auditar na mão`);
for (const v of vazias) console.log(`   ${v.slug}.pdf  ←  ${v.meds.join(', ')}`);

console.log(`\n⚫ MEDICAMENTO SEM PDF PUBLICADO (${semPdf.length}) — app abre link quebrado`);
for (const s of semPdf.slice(0, 40)) console.log(`   ${s.slug}.pdf  ←  "${s.genericName}"`);
if (semPdf.length > 40) console.log(`   … e mais ${semPdf.length - 40}`);
console.log('');

// ─── Gate de publicação (--gate) ───────────────────────────────────────────────
// Falha só em bula errada NOVA: as já revisadas na mão estão em bulas-revisadas.json
// (falso positivo de nomenclatura, pendência conhecida, ou fármaco sem versão pura no
// Brasil). Sem essa linha de base o gate reclamaria de tudo e seria ignorado — que é
// como um gate morre.
if (process.argv.includes('--gate')) {
  const revisadas = JSON.parse(fs.readFileSync(path.join(BULAS_DIR, 'bulas-revisadas.json'), 'utf8'));
  const conhecidos = new Set(
    Object.entries(revisadas)
      .filter(([k]) => !k.startsWith('_'))
      .flatMap(([, grupo]) => Object.keys(grupo).filter(s => !s.startsWith('_')))
  );
  const novas = [...erradas, ...combos].filter(e => !conhecidos.has(e.slug));

  // Duplicata de PDF tem a sua própria linha de base: alias de sal é legítimo
  // (pravastatina == pravastatina-sodica), combo em slug puro não é.
  const dupOk = new Set(Object.keys(revisadas.pdf_duplicado_ok ?? {}).filter(k => !k.startsWith('_')));
  const dupNovas = duplicados.filter(g => !dupOk.has(g.join('+')));

  if (novas.length === 0 && dupNovas.length === 0) {
    console.log(`✅ GATE OK — nenhuma bula errada nova (${conhecidos.size} revisadas, ${dupOk.size} duplicatas aceitas)\n`);
    process.exit(0);
  }
  console.error(`❌ GATE FALHOU\n`);
  for (const e of novas) {
    console.error(`   ${e.slug}.pdf  ←  "${e.generico}"`);
    console.error(`      ${e.motivo || `bula de composto (traz também: ${(e.intrusos || []).join(', ')})`}`);
  }
  for (const g of dupNovas) {
    console.error(`   MESMO PDF: ${g.join('  ==  ')}`);
    console.error(`      um dos slugs está com a bula do outro`);
  }
  console.error(`\nConserte a bula, ou — se for alarme falso — registre o motivo em site/bulas/bulas-revisadas.json`);
  console.error(`(duplicata aceita entra em "pdf_duplicado_ok" com a chave "slug-a+slug-b")\n`);
  process.exit(1);
}
