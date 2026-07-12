#!/usr/bin/env node
/**
 * Percorre o MESMO caminho que o app percorre, contra o CDN de verdade, e diz se a
 * atualização remota funcionaria neste momento:
 *
 *   manifesto (branch) → commit → .json + .sig fixados no commit → assinatura → piso/schema
 *
 * Rode depois de todo `git push` de dados. Foi a falta deste teste que deixou o canal cair em
 * silêncio: o app FALHA FECHADA (rejeita e segue com a base embarcada), então nada quebra na
 * cara do usuário — e a atualização simplesmente não chega, sem ninguém perceber.
 *
 * Usa o verificador REAL (src/services/dataSignature.ts), transpilado na hora, e não uma
 * reimplementação que poderia divergir do que roda no aparelho.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const USER = 'faema44', REPO = 'MedAlert', BRANCH = 'main';

// Verificador de assinatura real, direto do TS de produção.
const src = fs.readFileSync(path.join(ROOT, 'src/services/dataSignature.ts'), 'utf8')
  .replace("import * as ed from '@noble/ed25519';", "const ed = require('@noble/ed25519');");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { verifyDataSignature } = mod.exports;

const ALVOS = [
  { path: 'src/data/interactions.json',    conta: d => d.length },
  { path: 'src/data/medications-db.json',  conta: d => d.medications.length },
];

(async () => {
  let falhas = 0;

  // 1 ─ manifesto: a mesma ordem de origens do app (raw primeiro, jsDelivr como reserva)
  const origens = [
    ['raw.githubusercontent', `https://raw.githubusercontent.com/${USER}/${REPO}/${BRANCH}/src/data/manifest.json`],
    ['jsdelivr (reserva)',    `https://cdn.jsdelivr.net/gh/${USER}/${REPO}@${BRANCH}/src/data/manifest.json`],
  ];
  let commit = null;
  for (const [nome, url] of origens) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.log(`  · ${nome.padEnd(22)} HTTP ${res.status}`); continue; }
      const c = JSON.parse(await res.text())?.commit;
      const valido = typeof c === 'string' && /^[0-9a-f]{40}$/.test(c);
      console.log(`  ${valido ? '✓' : '✗'} ${nome.padEnd(22)} ${valido ? c.slice(0, 7) : 'SHA inválido'}`);
      if (valido && !commit) commit = c;
    } catch (e) { console.log(`  · ${nome.padEnd(22)} ${e.message}`); }
  }
  if (!commit) {
    console.log('\n  ✗ Nenhuma origem devolveu um manifesto válido — o app não atualizaria.');
    console.log('    Deu push no manifesto?  npm run publish:data && git push origin main');
    process.exit(1);
  }

  // O manifesto vem da branch (cacheada). Se ele estiver velho, o app pega dados velhos —
  // coerentes, mas velhos. Vale avisar.
  const local = require(path.join(ROOT, 'src/data/manifest.json')).commit;
  if (local !== commit) {
    console.log(`\n  ⚠ o CDN ainda serve o manifesto ${commit.slice(0, 7)}, mas o local é ${local.slice(0, 7)}`);
    console.log('    (cache de 5 min do raw.githubusercontent — reteste em instantes)');
  }

  // 2 ─ dados fixados no commit: .json e .sig SEMPRE do mesmo commit, por construção
  console.log('');
  for (const alvo of ALVOS) {
    const url = `https://cdn.jsdelivr.net/gh/${USER}/${REPO}@${commit}/${alvo.path}`;
    const nome = path.basename(alvo.path);
    try {
      const [r, rs] = await Promise.all([fetch(url), fetch(`${url}.sig`)]);
      if (!r.ok || !rs.ok) {
        falhas++;
        console.log(`  ✗ ${nome.padEnd(22)} HTTP ${r.status}/${rs.status} — faltou o .json ou o .sig no commit`);
        continue;
      }
      const raw = await r.text();
      const assinado = await verifyDataSignature(raw, await rs.text());
      const n = alvo.conta(JSON.parse(raw));
      const piso = alvo.conta(require(path.join(ROOT, alvo.path)));  // o que vai embarcado

      if (!assinado) { falhas++; console.log(`  ✗ ${nome.padEnd(22)} ASSINATURA INVÁLIDA — o app rejeitaria`); }
      else if (n < piso) { falhas++; console.log(`  ✗ ${nome.padEnd(22)} ${n} < ${piso} embarcadas — o app rejeitaria (piso)`); }
      else console.log(`  ✓ ${nome.padEnd(22)} assinatura OK · ${n} entradas (embarcado: ${piso})`);
    } catch (e) { falhas++; console.log(`  ✗ ${nome.padEnd(22)} ${e.message}`); }
  }

  console.log('');
  console.log(falhas === 0
    ? `  ✓ O canal OTA está de pé. O app baixaria os dados do commit ${commit.slice(0, 7)}.`
    : `  ✗ ${falhas} falha(s) — o app rejeitaria os dados remotos e seguiria com a base embarcada.`);
  process.exit(falhas === 0 ? 0 : 1);
})();
