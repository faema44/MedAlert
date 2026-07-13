#!/usr/bin/env node
/**
 * Publica a base médica: assina, confere, commita os dados e SÓ ENTÃO aponta o manifesto
 * para o commit que acabou de nascer.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O app não baixa mais os dados de `@main`. O jsDelivr cacheia URL de branch por 12h — e
 * como o .json e o .sig são duas entradas de cache independentes, toda publicação abria uma
 * janela em que uma estava fresca e a outra velha:
 *
 *     .sig novo  +  .json velho  →  assinatura não confere  →  o app rejeita o lote
 *
 * Falha fechada (o app segue com a base embarcada, que é auditada), mas o canal de
 * atualização morria em silêncio justamente nas horas seguintes a publicar.
 *
 * Agora o app lê `src/data/manifest.json` (da branch, cache de 5 min no raw.githubusercontent)
 * e baixa .json + .sig FIXADOS no commit que o manifesto indica (jsDelivr @<sha>, imutável).
 * Fixados no mesmo commit, dados e assinatura são coerentes por construção.
 *
 * Isso cria uma ordem que NÃO pode ser invertida: o manifesto precisa do SHA do commit dos
 * dados, então ele só pode ser escrito DEPOIS. São dois commits, e é o motivo deste script:
 * feito à mão, mais cedo ou mais tarde alguém aponta o manifesto para o commit errado.
 *
 * USO:  npm run publish:data     (não dá push — o push é seu, consciente)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'src/data/manifest.json');

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

// 1 ─ Assina e confere. O test:signature existe para pegar o esquecimento clássico:
//     publicar o .json sem reassinar, e o app rejeitar tudo calado.
console.log('\n── assinando ────────────────────────────────────────────────');
run('node', 'tools/sign-data.js');
console.log('\n── conferindo a assinatura ──────────────────────────────────');
run('node', 'tests/signature-guard.js');

// 2 ─ Commita os dados e as assinaturas JUNTOS. Nunca um sem o outro.
console.log('\n── commitando os dados ──────────────────────────────────────');
git('add', 'src/data/interactions.json', 'src/data/interactions.json.sig',
    'src/data/medications-db.json', 'src/data/medications-db.json.sig');

if (git('diff', '--staged', '--name-only')) {
  git('commit', '-m', 'data: publica base médica assinada');
  console.log('  ✓ commit dos dados criado');
} else {
  console.log('  · dados sem alteração — republicando o manifesto sobre o HEAD atual');
}

// 3 ─ AGORA o SHA existe. O manifesto aponta para ele.
const commit = git('rev-parse', 'HEAD');
const ints = require(path.join(ROOT, 'src/data/interactions.json')).length;
const meds = require(path.join(ROOT, 'src/data/medications-db.json')).medications.length;

fs.writeFileSync(MANIFEST, JSON.stringify({
  commit,
  generated: new Date().toISOString(),
  // Informativos: o app NÃO confia nestes números (o manifesto não é assinado). Quem manda
  // é a assinatura do .json e o piso de quantidade do dbSync. Estão aqui para revisão humana.
  interactions: ints,
  medications: meds,
}, null, 2) + '\n');

git('add', 'src/data/manifest.json');
if (git('diff', '--staged', '--name-only')) {
  git('commit', '-m', `data: manifesto aponta para ${commit.slice(0, 7)}`);
  console.log(`  ✓ manifesto → ${commit.slice(0, 7)}  (${ints} interações, ${meds} medicamentos)`);
} else {
  console.log('  · manifesto já apontava para este commit');
}

console.log('\n── pronto ───────────────────────────────────────────────────');
console.log('  Confira o diff e publique:   git push origin main');
console.log('  Depois:                      npm run test:ota');
console.log('');
