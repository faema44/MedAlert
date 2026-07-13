#!/usr/bin/env node
/**
 * Grava o campo `source` em cada interação, derivado do COMMIT que a introduziu.
 *
 * Por que isso importa: 31% da base (847 entradas) não tem origem documentada — e essas
 * carregam 281 dos 429 alertas CRÍTICOS. Ou seja, dois terços do que o app grita como
 * "crítico" vêm de lugar que ninguém sabe nomear. 725 delas entraram num commit chamado
 * "checkpoint: consolida alertas de medicamento em um único estilo (card azul)" — um
 * commit sobre a COR DO CARTÃO.
 *
 * Com `source`, o app pode ser honesto sobre o que sabe:
 *   · com procedência  → REPORTA e cita ("Segundo a bula do FDA: …")
 *   · sem procedência  → só SINALIZA o par, sem texto e sem gravidade, e manda ler a bula
 *
 * A atribuição é por git, não por chute: a primeira vez que um id aparece no histórico do
 * interactions.json é o commit que o criou.
 *
 * USO: node tools/marcar-procedencia.js [--seco]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALVO = path.join(ROOT, 'src/data/interactions.json');
const SECO = process.argv.includes('--seco');

// commit que introduziu → fonte real. Quem não está aqui não tem origem declarada:
// o commit que a criou não diz de onde ela veio, e não vamos inventar.
const FONTE_POR_COMMIT = {
  f9d165d: 'FDA',            // merge do round 2 de bulas FDA (1.355 -> 3.063)
  '6b9b3ea': 'FDA',          // expande interações via bulas FDA
  b2b6d93: 'Infarma 2007',   // artigo (fitoterápicos)
  '9346708': 'Fiocruz 2024', // artigo (fitoterápicos)
  '9b54cde': 'drugs.com',    // hipercalemia por suplemento de potássio
};
const DESCONHECIDA = 'desconhecida';

const commits = execSync('git log --reverse --format=%h -- src/data/interactions.json',
  { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');

const primeiroCommit = new Map();
for (const c of commits) {
  let arr;
  try {
    arr = JSON.parse(execSync(`git show ${c}:src/data/interactions.json`,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }));
  } catch { continue; }
  if (!Array.isArray(arr)) arr = arr.interactions || [];
  for (const x of arr) if (x?.id && !primeiroCommit.has(x.id)) primeiroCommit.set(x.id, c);
}

const base = JSON.parse(fs.readFileSync(ALVO, 'utf8'));
const conta = {};
const saida = base.map(x => {
  const fonte = FONTE_POR_COMMIT[primeiroCommit.get(x.id)] ?? DESCONHECIDA;
  conta[fonte] = (conta[fonte] || 0) + 1;
  // `source` logo após o id: é metadado da entrada, não conteúdo clínico
  const { id, ...resto } = x;
  return { id, source: fonte, ...resto };
});

console.log(`${base.length} interações\n`);
for (const [f, n] of Object.entries(conta).sort((a, b) => b[1] - a[1])) {
  const crit = saida.filter(x => x.source === f && x.risk_level === 'critical').length;
  console.log(`  ${String(n).padStart(5)}  ${f.padEnd(14)} (${crit} críticos)`);
}
const semFonte = conta[DESCONHECIDA] || 0;
console.log(`\n  ${((100 * semFonte) / base.length).toFixed(0)}% da base não pode ser afirmada — só sinalizada.`);

if (SECO) { console.log('\n[SECO] nada gravado'); process.exit(0); }
fs.writeFileSync(ALVO, JSON.stringify(saida, null, 2) + '\n');
console.log(`\n✓ gravado em ${path.relative(ROOT, ALVO)}`);
