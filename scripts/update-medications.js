'use strict';
/**
 * Agente de atualização do banco de medicamentos.
 *
 * Fontes tentadas (em ordem):
 *   1. ANVISA Dados Abertos — ZIP com CSV de todos os medicamentos registrados
 *   2. Scraping do Bulário BVS (Biblioteca Virtual em Saúde)
 *   3. Scraping do bulas.med.br
 *
 * Uso:
 *   node scripts/update-medications.js
 *
 * O resultado é salvo em src/data/medications-db.json (merge, nunca sobrescreve).
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DB_PATH = path.join(__dirname, '../src/data/medications-db.json');
const TIMEOUT_MS = 15_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'MedAlertApp/1.0 (health app; medicamentos BR)',
        'Accept': 'application/json, text/html, */*',
        ...options.headers,
      },
      ...options,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout — ${url}`)); });
  });
}

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[()\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Load existing DB ─────────────────────────────────────────────────────────

function loadDb() {
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveDb(db) {
  db.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log(`✅ Banco salvo: ${db.medications.length} medicamentos`);
}

// Find existing entry or create new one (merge, never duplicate)
function upsert(db, genericName, brands, category) {
  const normNew = normalize(genericName);
  const existing = db.medications.find(m => normalize(m.genericName) === normNew);
  if (existing) {
    let changed = false;
    for (const b of brands) {
      if (!existing.brands.some(x => normalize(x) === normalize(b))) {
        existing.brands.push(b);
        changed = true;
      }
    }
    if (category && !existing.category) { existing.category = category; changed = true; }
    if (changed) console.log(`  ↺ Atualizado: ${genericName}`);
  } else {
    db.medications.push({ genericName, brands, category: category || '' });
    console.log(`  + Adicionado: ${genericName}`);
  }
}

// ─── Source 1: ANVISA Dados Abertos ──────────────────────────────────────────
// CSV público: https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.zip
// Colunas relevantes: NOME_PRODUTO, PRINCIPIO_ATIVO, SITUACAO_REGISTRO

async function fetchAnvisaOpenData(db) {
  console.log('\n[1] Tentando ANVISA Dados Abertos...');
  const zipUrl = 'https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.zip';

  let zipBuf;
  try {
    zipBuf = await get(zipUrl, { rejectUnauthorized: false });
  } catch (e) {
    console.log(`    ✗ Falhou: ${e.message}`);
    return false;
  }

  // Decompress ZIP manually (find first file entry)
  try {
    const entries = parseZip(zipBuf);
    const csvEntry = entries.find(e => e.name.endsWith('.csv') || e.name.endsWith('.CSV'));
    if (!csvEntry) throw new Error('CSV não encontrado no ZIP');

    const csvText = csvEntry.data.toString('latin1'); // ANVISA usa ISO-8859-1
    const lines = csvText.split('\n');
    const header = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));

    const nameIdx = header.findIndex(h => /nome.produto/i.test(h));
    const substIdx = header.findIndex(h => /principio.ativo|substancia/i.test(h));
    const sitIdx = header.findIndex(h => /situacao/i.test(h));

    if (nameIdx < 0 || substIdx < 0) throw new Error(`Colunas não encontradas: ${header.join(', ')}`);

    let added = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.trim().replace(/^"|"$/g, ''));
      if (!cols[nameIdx] || !cols[substIdx]) continue;
      // Skip cancelled/expired registrations
      if (sitIdx >= 0 && cols[sitIdx] && !/ativo|valido/i.test(cols[sitIdx])) continue;

      const brand = toTitleCase(cols[nameIdx]);
      const generic = toTitleCase(cols[substIdx]);
      upsert(db, generic, [brand], '');
      if (++added % 1000 === 0) process.stdout.write(`    ${added} processados...\r`);
    }
    console.log(`\n    ✓ ANVISA: ${added} registros processados`);
    return true;
  } catch (e) {
    console.log(`    ✗ Parse falhou: ${e.message}`);
    return false;
  }
}

// Minimal ZIP parser (local file entries only, no data descriptor)
function parseZip(buf) {
  const entries = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
    const flags = buf.readUInt16LE(i + 6);
    const compression = buf.readUInt16LE(i + 8);
    const compressedSize = buf.readUInt32LE(i + 18);
    const fileNameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + fileNameLen).toString('utf8');
    const dataStart = i + 30 + fileNameLen + extraLen;
    const compressedData = buf.slice(dataStart, dataStart + compressedSize);
    let data;
    if (compression === 0) {
      data = compressedData;
    } else if (compression === 8) {
      try { data = zlib.inflateRawSync(compressedData); } catch { data = compressedData; }
    }
    if (data) entries.push({ name, data });
    i = dataStart + compressedSize;
  }
  return entries;
}

function toTitleCase(s) {
  return s.toLowerCase().replace(/(?:^|\s|-)\S/g, c => c.toUpperCase()).trim();
}

// ─── Source 2: Bulário BVS ────────────────────────────────────────────────────
// https://bulario.bvs.br — possui busca JSON não documentada

async function fetchBvsBulario(db) {
  console.log('\n[2] Tentando Bulário BVS (BIREME)...');
  const terms = ['metformina', 'varfarina', 'enalapril', 'omeprazol', 'losartana',
                 'atorvastatina', 'metoprolol', 'amoxicilina', 'fluoxetina', 'prednisona'];
  let found = 0;

  for (const term of terms) {
    try {
      const url = `http://bulario.bvs.br/index.php?txtName=${encodeURIComponent(term)}&Submit=Buscar`;
      const html = (await get(url)).toString('utf8');
      // Extract medication names from search results
      const matches = [...html.matchAll(/class="result-item[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi)];
      for (const m of matches) {
        const name = m[1].trim();
        if (name.length > 2) { upsert(db, name, [], ''); found++; }
      }
    } catch { /* continue */ }
  }

  if (found > 0) {
    console.log(`    ✓ BVS: ${found} nomes encontrados`);
    return true;
  }
  console.log('    ✗ BVS: sem resultados');
  return false;
}

// ─── Source 3: bulas.med.br ────────────────────────────────────────────────────

async function fetchBulasMedBr(db) {
  console.log('\n[3] Tentando bulas.med.br...');
  const searchTerms = ['metformina', 'atenolol', 'amoxicilina', 'ibuprofeno'];
  let found = 0;

  for (const term of searchTerms) {
    try {
      const url = `https://www.bulas.med.br/?busca=${encodeURIComponent(term)}`;
      const html = (await get(url)).toString('utf8');
      // Extract <h2> or <h3> medication names from search results
      const nameMatches = [...html.matchAll(/<(?:h2|h3)[^>]*>([A-ZÀ-Ü][A-Za-zÀ-ÿ\s\-+]+)<\/(?:h2|h3)>/g)];
      for (const m of nameMatches) {
        const name = m[1].trim();
        if (name.length > 3 && name.length < 80) { upsert(db, name, [], ''); found++; }
      }
    } catch { /* continue */ }
  }

  if (found > 0) {
    console.log(`    ✓ bulas.med.br: ${found} nomes encontrados`);
    return true;
  }
  console.log('    ✗ bulas.med.br: sem resultados');
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  MedAlert — Agente de Atualização de Banco   ║');
  console.log('╚══════════════════════════════════════════════╝');

  const db = loadDb();
  const before = db.medications.length;
  console.log(`\nBanco atual: ${before} medicamentos (${db.version})`);

  let anySuccess = false;
  anySuccess = await fetchAnvisaOpenData(db) || anySuccess;
  anySuccess = await fetchBvsBulario(db) || anySuccess;
  anySuccess = await fetchBulasMedBr(db) || anySuccess;

  const after = db.medications.length;
  console.log(`\n📊 Resultado: ${before} → ${after} medicamentos (+${after - before})`);

  if (anySuccess || after > before) {
    saveDb(db);
  } else {
    console.log('\n⚠️  Nenhuma fonte respondeu. Banco não alterado.');
    console.log('   Dica: verifique sua conexão e tente novamente mais tarde.');
  }
}

main().catch(e => { console.error('\n❌ Erro fatal:', e.message); process.exit(1); });
