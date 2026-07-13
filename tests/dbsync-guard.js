// Testa a lógica de aceitação REAL do dbSync.ts contra payloads maliciosos.
// Extrai as funções do arquivo e transpila com o TypeScript de verdade — o teste roda o
// código que está em produção, não uma reimplementação que poderia divergir.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ts = require(path.join(ROOT, 'node_modules/typescript'));

const src = fs.readFileSync(path.join(ROOT, 'src/services/dbSync.ts'), 'utf8');

// Pega do marcador de validação até o fim do bloco acceptMeds
const ini = src.indexOf('const RISK_LEVELS');
const fim = src.indexOf('// ─── Public API');
if (ini < 0 || fim < 0) throw new Error('não achei o bloco de validação em dbSync.ts');
const trecho = src.slice(ini, fim) + '\nmodule.exports = { acceptInteractions, acceptMeds };\n';

const js = ts.transpileModule(trecho, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { acceptInteractions, acceptMeds } = mod.exports;

// O PISO é a lista de IDs embarcada no APK (revisada pela Play Store). O interactions.json
// não é mais embarcado: 980 KB de peso morto para quem toma 8 remédios.
const PISO = require(path.join(ROOT, 'src/data/interactions-floor.json')).ids;
const N = PISO.length;

const ok = id => ({ id, drug1: 'A', drug2: 'B', risk_description: 'x', risk_level: 'high' });
const baseCompleta = () => PISO.map(ok);
const semUm = () => baseCompleta().slice(0, -1);

// Mesma QUANTIDADE do piso, mas IDs trocados. Este é o ataque que o guard ANTIGO deixava
// passar: ele comparava só `data.length < baselineCount`, então 2.768 entradas falsas tinham
// o mesmo tamanho de 2.768 verdadeiras. Todo alerta real sumia e o app não via diferença.
const trocado = () => Array.from({ length: N }, (_, i) => ok('fake_' + i));

const casos = [
  ['ATAQUE: array vazio (apaga tudo)',                     [],                                  false],
  [`ATAQUE: 1 entrada (zera as ${N})`,                     [ok(PISO[0])],                       false],
  ['ATAQUE: metade do lote (some alerta crítico)',         baseCompleta().slice(0, N >> 1),     false],
  ['ATAQUE: remove UM alerta que a loja revisou',          semUm(),                             false],
  [`ATAQUE: MESMA quantidade (${N}), IDs TROCADOS`,        trocado(),                           false],
  ['ATAQUE: risk_level inventado ("none")',                [...semUm(), { ...ok('x'), risk_level: 'none' }], false],
  ['ATAQUE: entrada sem drug2',                            [...semUm(), { id: 'x', drug1: 'A', risk_description: 'x', risk_level: 'high' }], false],
  ['ATAQUE: null no meio do lote',                         [...semUm(), null],                  false],
  ['ATAQUE: objeto em vez de array',                       { medications: [] },                 false],
  ['ATAQUE: string crua',                                  'pwned',                             false],
  [`LEGÍTIMO: a base do piso, inteira (${N})`,             baseCompleta(),                      true],
  ['LEGÍTIMO: base CRESCEU (+50 interações novas)',        [...baseCompleta(), ...Array.from({ length: 50 }, (_, i) => ok('novo_' + i))], true],
];

let falhas = 0;
for (const [nome, payload, esperado] of casos) {
  const aceito = acceptInteractions(payload, PISO) !== null;
  const passou = aceito === esperado;
  if (!passou) falhas++;
  console.log(`  ${passou ? '✓' : '✗ FALHOU'}  ${nome.padEnd(48)} → ${aceito ? 'ACEITO' : 'rejeitado'}`);
}

// medications-db continua embarcado (é pequeno e o app precisa dele para BUSCAR remédio,
// mesmo offline), então o piso dele segue sendo a contagem.
const bMeds = require(path.join(ROOT, 'src/data/medications-db.json'));
const M = bMeds.medications.length;
const med = n => ({ medications: Array.from({ length: n }, (_, i) => ({ genericName: 'g' + i, brands: [], category: 'c' })) });
console.log('');
for (const [nome, payload, esperado] of [
  [`ATAQUE meds: 1 entrada (zera as ${M})`,   med(1),                            false],
  ['ATAQUE meds: sem genericName',            { medications: [{ brands: [] }] },  false],
  [`LEGÍTIMO meds: mesma quantidade (${M})`,  med(M),                             true],
]) {
  const aceito = acceptMeds(payload, M) !== null;
  const passou = aceito === esperado;
  if (!passou) falhas++;
  console.log(`  ${passou ? '✓' : '✗ FALHOU'}  ${nome.padEnd(48)} → ${aceito ? 'ACEITO' : 'rejeitado'}`);
}

console.log('');
console.log(falhas === 0
  ? `  ✓ Todos os cenários passaram. Piso: ${N} IDs, ${M} medicamentos.`
  : `  ✗ ${falhas} FALHA(S) — a defesa está furada.`);
process.exit(falhas === 0 ? 0 : 1);
