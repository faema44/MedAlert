#!/usr/bin/env node
/**
 * Preenche o `source_ref` das entradas de erva-de-são-joão que declaram FDA sem nomear documento.
 *
 * O problema: 7 entradas dizem `source: "FDA"` com `source_ref` vazio. O cartão então exibe
 * "Fonte: bulas do FDA" — uma procedência que a pessoa NÃO tem como conferir, porque não diz
 * QUAL bula. O documento é a bula do ALOPÁTICO (a do glecaprevir cita erva-de-são-joão, não o
 * contrário: suplemento não tem bula no FDA).
 *
 * Confirmação de TEXTO, como o resto do projeto: se a bula americana do fármaco X menciona
 * "St. John's wort" / "hypericum", isso É a fonte. Nada é gerado; o que falta é o lastro.
 *
 * NÃO inventa: quando a bula não menciona, a entrada fica como está e aparece no relatório para
 * decisão humana. Preencher source_ref sem confirmar seria trocar uma citação vaga por uma
 * citação FALSA — pior que o problema original.
 *
 * USO:  node tools/completar-fonte-hypericum.js            (só relatório)
 *       node tools/completar-fonte-hypericum.js --gravar   (grava os source_ref confirmados)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const INTER = path.join(ROOT, 'src/data/interactions.json');
const CACHE = path.join(os.tmpdir(), 'medalert-fda-hypericum.json');
const GRAVAR = process.argv.includes('--gravar');

// PT → nome que o openFDA conhece. Escrito à mão: são 7.
const EN = {
  'Dienogeste': 'dienogest',
  'Estrogênios conjugados': 'estrogens, conjugated',
  'Glecaprevir': 'glecaprevir',
  'Ledipasvir': 'ledipasvir',
  'Nifedipino': 'nifedipine',
  'Pibrentasvir': 'pibrentasvir',
  'Safinamida': 'safinamide',
};

// Como a bula americana escreve a erva. "hypericum" pega o nome botânico; as duas grafias de
// "St John's" existem no mesmo corpus (com e sem ponto, com aspa curva e reta).
const ERVA = /st\.?\s*john'?’?s\s*wort|hypericum/i;

const SECOES = ['boxed_warning', 'contraindications', 'warnings_and_cautions', 'drug_interactions', 'warnings'];

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

async function secoesDe(en) {
  if (cache[en]) return cache[en];
  // generic_name primeiro; se não achar, tenta substance_name (nomes de combo entram por lá).
  let j = await get(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:%22${encodeURIComponent(en)}%22&limit=5`);
  if (!j || !j.results) {
    j = await get(`https://api.fda.gov/drug/label.json?search=openfda.substance_name:%22${encodeURIComponent(en)}%22&limit=5`);
  }
  const secs = {};
  for (const s of SECOES) secs[s] = '';
  for (const r of (j && j.results) || []) {
    for (const s of SECOES) if (r[s]) secs[s] += ' ' + [].concat(r[s]).join(' ');
  }
  cache[en] = secs; salvar();
  await new Promise(r => setTimeout(r, 400));
  return secs;
}

(async () => {
  const dados = JSON.parse(fs.readFileSync(INTER, 'utf8'));
  const alvos = dados.filter(e => e.source === 'FDA' && !e.source_ref
    && /hypericum/i.test(`${e.drug1} ${e.drug2}`));

  console.log(`\n  ${alvos.length} entradas de erva-de-são-joão dizendo "FDA" sem nomear a bula\n`);

  let confirmados = 0;
  const semLastro = [];

  for (const e of alvos) {
    // O alopático é o lado que NÃO é a erva.
    const alo = /hypericum/i.test(e.drug1) ? e.drug2 : e.drug1;
    const en = EN[alo];
    if (!en) { semLastro.push([e.id, alo, 'sem tradução']); continue; }

    const secs = await secoesDe(en);
    const achou = SECOES.find(s => secs[s] && ERVA.test(secs[s]));
    if (achou) {
      console.log(`  ✓ ${e.id.padEnd(9)} ${alo.padEnd(24)} a bula cita a erva em: ${achou}`);
      if (GRAVAR) e.source_ref = alo;
      confirmados++;
    } else {
      console.log(`  ✗ ${e.id.padEnd(9)} ${alo.padEnd(24)} a bula NÃO menciona a erva`);
      semLastro.push([e.id, alo, 'bula não menciona']);
    }
  }

  console.log(`\n  confirmados: ${confirmados}   sem lastro: ${semLastro.length}`);
  if (semLastro.length) {
    console.log('\n  Estes seguem declarando FDA sem documento. Decisão humana: ou some outra fonte,');
    console.log('  ou o source vira "desconhecida" — que é honesto e o app já sabe exibir.');
    for (const [id, alo, pq] of semLastro) console.log(`      ${id}  ${alo}  (${pq})`);
  }

  if (GRAVAR && confirmados) {
    fs.writeFileSync(INTER, JSON.stringify(dados, null, 2) + '\n');
    console.log(`\n  ✍ gravado. NÃO ESQUEÇA: npm run sign:data (senão o app rejeita os dados em silêncio).`);
  } else if (!GRAVAR) {
    console.log('\n  (relatório apenas — rode com --gravar para aplicar)');
  }
  console.log('');
})();
