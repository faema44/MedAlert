'use strict';
/**
 * Agente de atualização do banco de medicamentos.
 *
 * Fonte:
 *   ANVISA Dados Abertos — CSV com todos os medicamentos registrados no
 *   Brasil (nome comercial + princípio ativo já vêm juntos, sem necessidade
 *   de scraping adicional). Bulário BVS e bulas.med.br foram removidos: só
 *   repetiam remédios já conhecidos ou raspavam lixo de navegação do site.
 *
 * Importante: o CSV bruto tem ~29 mil registros técnicos (combinações,
 * nomes botânicos em latim, etc.) — bem mais granular que os ~690 itens
 * curados do banco do app. Por isso o agente só ENRIQUECE medicamentos que
 * já existem no banco (adiciona marca nova), nunca cria item novo sozinho.
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
// allowCreate=false: só enriquece marcas/categoria de itens já existentes no
// banco curado, nunca cria genericName novo sozinho (evita poluir a lista de
// autocomplete do app com as ~29 mil combinações técnicas do registro bruto
// da ANVISA — ver discussão de 2026-07-03).
function upsert(db, genericName, brands, category, allowCreate = true) {
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
  } else if (allowCreate) {
    db.medications.push({ genericName, brands, category: category || '' });
    console.log(`  + Adicionado: ${genericName}`);
  }
}

// ─── Source 1: ANVISA Dados Abertos ──────────────────────────────────────────
// CSV público: https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
// Colunas relevantes: NOME_PRODUTO, PRINCIPIO_ATIVO, SITUACAO_REGISTRO

async function fetchAnvisaOpenData(db) {
  console.log('\n[1] Tentando ANVISA Dados Abertos...');
  const csvUrl = 'https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv';

  let csvBuf;
  try {
    csvBuf = await get(csvUrl, { rejectUnauthorized: false });
  } catch (e) {
    console.log(`    ✗ Falhou: ${e.message}`);
    return false;
  }

  try {
    const csvText = csvBuf.toString('latin1'); // ANVISA usa ISO-8859-1
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
      // allowCreate=false — só enriquece marcas dos medicamentos que já
      // estão no banco curado, nunca cria item novo sozinho.
      upsert(db, generic, [brand], '', false);
      if (++added % 1000 === 0) process.stdout.write(`    ${added} processados...\r`);
    }
    console.log(`\n    ✓ ANVISA: ${added} registros processados`);
    return true;
  } catch (e) {
    console.log(`    ✗ Parse falhou: ${e.message}`);
    return false;
  }
}

function toTitleCase(s) {
  return s.toLowerCase().replace(/(?:^|\s|-)\S/g, c => c.toUpperCase()).trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  MedAlert — Agente de Atualização de Banco   ║');
  console.log('╚══════════════════════════════════════════════╝');

  const db = loadDb();
  const before = db.medications.length;
  console.log(`\nBanco atual: ${before} medicamentos (${db.version})`);

  const anySuccess = await fetchAnvisaOpenData(db);

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
