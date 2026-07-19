// Testa o ritmo com pausa (src/utils/medCycle.ts): cartela 21/7, adesivo 3sem/1, anel.
//
// O modo de falha aqui é CALADO e dura meses: se o cálculo inverter ativo/pausa, a pessoa toma
// na semana de descanso e descansa na de tomar — e nada acusa, porque o app segue avisando com
// convicção. Anticoncepcional esquecido é a principal causa de gravidez não planejada; este
// arquivo é a única coisa entre a aritmética e esse desfecho.
//
// Carrega o TS REAL transpilado, não uma cópia da conta — mesmo motivo do gate do sqlite-handle.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/utils/medCycle.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { cycleState, ancoraPorDiaAtual, dosesPorCiclo, diasDeEstoque, validarCiclo } = mod.exports;

for (const [nome, fn] of Object.entries({ cycleState, ancoraPorDiaAtual, dosesPorCiclo, diasDeEstoque, validarCiclo })) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  medCycle.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(58)}${ok ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`);
}

const D = (s) => new Date(`${s}T12:00:00`); // meio-dia: qualquer normalização errada aparece
const CARTELA = { kind: 'pill', daysOn: 21, daysOff: 7, anchor: '2026-09-01' };

console.log('\n  CARTELA 21/7 — o percurso de um ciclo\n');
check('dia 1 (a própria âncora) está ativo',       cycleState(CARTELA, D('2026-09-01')).active, true);
check('dia 1 é o primeiro do ciclo',               cycleState(CARTELA, D('2026-09-01')).isFirstOfCycle, true);
check('dia 21 ainda está tomando',                 cycleState(CARTELA, D('2026-09-21')).active, true);
check('dia 21 é o último ativo (véspera da pausa)', cycleState(CARTELA, D('2026-09-21')).isLastActive, true);
check('dia 22 é pausa',                            cycleState(CARTELA, D('2026-09-22')).active, false);
check('dia 28 ainda é pausa',                      cycleState(CARTELA, D('2026-09-28')).active, false);
check('dia 28 é véspera do recomeço',              cycleState(CARTELA, D('2026-09-28')).isPauseEve, true);
check('dia 29 recomeça a cartela',                 cycleState(CARTELA, D('2026-09-29')).active, true);
check('dia 29 é dia 1 do novo ciclo',              cycleState(CARTELA, D('2026-09-29')).dayInCycle, 1);

console.log('\n  A ARMADILHA — datas ANTES da âncora (módulo negativo)\n');
// Sem o `+ total` antes do 2º módulo, tudo aqui embaixo inverte e ninguém percebe.
check('1 dia antes da âncora = último dia de pausa', cycleState(CARTELA, D('2026-08-31')).active, false);
check('…e é a véspera do recomeço',                  cycleState(CARTELA, D('2026-08-31')).isPauseEve, true);
check('8 dias antes = último ativo do ciclo anterior', cycleState(CARTELA, D('2026-08-24')).active, true);
check('28 dias antes = dia 1 (ciclo cheio para trás)', cycleState(CARTELA, D('2026-08-04')).dayInCycle, 1);
check('1 ano antes ainda calcula sem NaN',            cycleState(CARTELA, D('2025-09-01')).dayInCycle > 0, true);

console.log('\n  ADESIVO 3 semanas / 1  e  ANEL 21/7\n');
const ADESIVO = { kind: 'patch', daysOn: 21, daysOff: 7, anchor: '2026-09-01' };
const ANEL = { kind: 'ring', daysOn: 21, daysOff: 7, anchor: '2026-09-01' };
check('adesivo: dia 22 é pausa (retirar)',      cycleState(ADESIVO, D('2026-09-22')).active, false);
check('adesivo: recomeça no MESMO dia da semana', D('2026-09-01').getDay() === D('2026-09-29').getDay(), true);
check('anel: dia 21 é o último dentro',          cycleState(ANEL, D('2026-09-21')).isLastActive, true);

console.log('\n  CICLOS QUE NÃO FECHAM EM 7 (corticoide, quimio)\n');
const QUIMIO = { kind: 'custom', daysOn: 7, daysOff: 21, anchor: '2026-09-01' };
check('quimio 7/21: dia 7 ativo',        cycleState(QUIMIO, D('2026-09-07')).active, true);
check('quimio 7/21: dia 8 em pausa',     cycleState(QUIMIO, D('2026-09-08')).active, false);
check('quimio 7/21: dia 29 recomeça',    cycleState(QUIMIO, D('2026-09-29')).dayInCycle, 1);
// 10/4 daria 14 = 2 semanas exatas, e o dia da semana ficaria estável — não serve para provar
// a deriva. 10/3 = 13 dias, que NÃO é múltiplo de 7: é aqui que o ciclo anda pelo calendário.
const IMPAR = { kind: 'custom', daysOn: 10, daysOff: 3, anchor: '2026-09-01' };
check('10/3: dia 14 recomeça (ciclo de 13)', cycleState(IMPAR, D('2026-09-14')).dayInCycle, 1);
check('10/3: dia da semana DERIVA a cada ciclo', D('2026-09-01').getDay() !== D('2026-09-14').getDay(), true);
// E o contraste: 21/7 = 28 = 4 semanas exatas, então o recomeço cai sempre no mesmo dia.
check('21/7 NÃO deriva (28 = 4 semanas)', D('2026-09-01').getDay() === D('2026-09-29').getDay(), true);

console.log('\n  VIRADA DE ANO E HORÁRIO DE VERÃO\n');
const VIRADA = { kind: 'pill', daysOn: 21, daysOff: 7, anchor: '2026-12-20' };
check('atravessa 31/12 sem pular dia', cycleState(VIRADA, D('2027-01-09')).dayInCycle, 21);
// No Brasil não há horário de verão desde 2019, mas o cálculo tem de sobreviver a ele.
const DST = { kind: 'pill', daysOn: 21, daysOff: 7, anchor: '2026-02-15' };
check('atravessa possível virada de DST', cycleState(DST, D('2026-03-08')).dayInCycle, 22);
check('ano bissexto: 29/02 conta como 1 dia', cycleState({ ...DST, anchor: '2024-02-28' }, D('2024-03-01')).dayInCycle, 3);

console.log('\n  ÂNCORA A PARTIR DE "QUE DIA DA CARTELA VOCÊ ESTÁ?"\n');
const hoje = D('2026-09-15');
check('estou no dia 1 → âncora é hoje',   ancoraPorDiaAtual(1, hoje), '2026-09-15');
check('estou no dia 15 → âncora 14 antes', ancoraPorDiaAtual(15, hoje), '2026-09-01');
check('a âncora calculada devolve o dia informado',
  cycleState({ ...CARTELA, anchor: ancoraPorDiaAtual(12, hoje) }, hoje).dayInCycle, 12);

console.log('\n  ESTOQUE — a pausa não consome dose\n');
check('cartela: 21 doses por ciclo',            dosesPorCiclo(CARTELA, 1), 21);
check('cartela: 21 comprimidos cobrem 28 DIAS', diasDeEstoque(CARTELA, 21, 1), 28);
check('cartela: 42 comprimidos cobrem 56 dias', diasDeEstoque(CARTELA, 42, 1), 56);
check('cartela: 40 comprimidos cobrem 47 dias', diasDeEstoque(CARTELA, 40, 1), 47);
check('estoque parcial não inventa pausa',      diasDeEstoque(CARTELA, 10, 1), 10);
check('anel: 1 dose por ciclo',                 dosesPorCiclo(ANEL, 1), 1);
check('anel: 3 anéis cobrem 84 dias',           diasDeEstoque(ANEL, 3, 1), 84);

// SEM passar diasDaSemanaAtivos — é como a Home chama de verdade. Passar o argumento
// escondia o bug: o adesivo caía no default 7 e virava 21 doses por ciclo, fazendo
// "9 adesivos ≈ 9 dias" em vez de 9 semanas.
check('adesivo: 3 doses por ciclo (sem argumento extra)', dosesPorCiclo(ADESIVO, 1), 3);
check('adesivo: 9 adesivos cobrem 84 dias, não 9',        diasDeEstoque(ADESIVO, 9, 1), 84);
check('adesivo: 1 adesivo cobre 7 dias',                  diasDeEstoque(ADESIVO, 1, 1), 7);

console.log('\n  CONFIGURAÇÃO IMPOSSÍVEL É RECUSADA NO CADASTRO\n');
check('pausa zero é recusada',   validarCiclo({ ...CARTELA, daysOff: 0 }) !== null, true);
check('dias tomando zero é recusado', validarCiclo({ ...CARTELA, daysOn: 0 }) !== null, true);
check('fracionário é recusado',  validarCiclo({ ...CARTELA, daysOn: 1.5 }) !== null, true);
check('data inválida é recusada', validarCiclo({ ...CARTELA, anchor: 'ontem' }) !== null, true);
check('cartela 21/7 é aceita',   validarCiclo(CARTELA), null);

console.log('\n  diaTemDose — o decisor único, e a falha para o lado SEGURO\n');
const { diaTemDose, cicloDoMedicamento } = mod.exports;
const COLS_OK = { cycle_kind: 'pill', cycle_days_on: 21, cycle_days_off: 7, cycle_anchor: '2026-09-01' };

check('dia ativo tem dose',              diaTemDose(COLS_OK, D('2026-09-10')), true);
check('dia de PAUSA não tem dose',       diaTemDose(COLS_OK, D('2026-09-25')), false);

// O anel fica 21 dias NO LUGAR: é 1 colocação por ciclo, não 21 doses.
const ANEL_COLS = { ...COLS_OK, cycle_kind: 'ring' };
check('anel: dia 1 tem colocação',       diaTemDose(ANEL_COLS, D('2026-09-01')), true);
check('anel: dia 10 NÃO cobra de novo',  diaTemDose(ANEL_COLS, D('2026-09-10')), false);
check('anel: dia 29 é a próxima colocação', diaTemDose(ANEL_COLS, D('2026-09-29')), true);
check('adesivo: dia 10 ativo (a semana vem do lembrete)', diaTemDose({ ...COLS_OK, cycle_kind: 'patch' }, D('2026-09-10')), true);

// O erro tolerável é avisar demais. Calar um remédio por dado corrompido não se desfaz:
// ninguém percebe o alarme que não tocou. Por isso tudo abaixo devolve TRUE.
check('sem ciclo nenhum → tem dose',     diaTemDose({}, D('2026-09-25')), true);
check('kind sem os dias → tem dose',     diaTemDose({ cycle_kind: 'pill' }, D('2026-09-25')), true);
check('sem âncora → tem dose',           diaTemDose({ ...COLS_OK, cycle_anchor: null }, D('2026-09-25')), true);
check('dias zerados → tem dose',         diaTemDose({ ...COLS_OK, cycle_days_off: 0 }, D('2026-09-25')), true);
check('âncora lixo → tem dose',          diaTemDose({ ...COLS_OK, cycle_anchor: 'ontem' }, D('2026-09-25')), true);
check('daysOn fracionário → tem dose',   diaTemDose({ ...COLS_OK, cycle_days_on: 2.5 }, D('2026-09-25')), true);

check('cicloDoMedicamento: completo vira ciclo', cicloDoMedicamento(COLS_OK) !== null, true);
check('cicloDoMedicamento: pela metade é null',  cicloDoMedicamento({ cycle_kind: 'pill' }), null);
check('cicloDoMedicamento: inválido é null',     cicloDoMedicamento({ ...COLS_OK, cycle_days_off: 0 }), null);

// ---------------------------------------------------------------------------
// PERSISTÊNCIA — o ciclo tem que sobreviver aos QUATRO caminhos do db.ts.
//
// O export do backup usa `SELECT *` e leva coluna nova de graça; o IMPORT tem lista
// explícita. Essa assimetria perde dado em SILÊNCIO: a pessoa restaura o backup no celular
// novo, os remédios voltam, e a cartela volta como medicamento comum — tomando na semana
// de pausa. Este bloco existe para que a próxima coluna não caia na mesma armadilha.
// ---------------------------------------------------------------------------
console.log('\n  PERSISTÊNCIA — a cartela sobrevive a migração, INSERT, UPDATE e RESTORE\n');
const dbSrc = fs.readFileSync(path.join(ROOT, 'src/database/db.ts'), 'utf8');
// photo_uri entra aqui pelo MESMO motivo das do ciclo: é coluna de medicamento que o
// RESTORE precisa carregar. E ela tem um agravante — a foto é ARQUIVO, então além da
// coluna o backup leva o conteúdo em base64 (photo_b64).
const COLUNAS = ['cycle_kind', 'cycle_days_on', 'cycle_days_off', 'cycle_anchor', 'photo_uri'];

// Olhar o TRECHO em volta não serve: `cycle_kind` aparece no array de parâmetros JS logo
// abaixo do SQL, então um INSERT sem a coluna passaria batido. (Comprovado sabotando o
// arquivo: o guard frouxo aprovou.) Aqui isolamos a LISTA DE COLUNAS do próprio SQL.
function listaDeColunas(ancora) {
  const i = dbSrc.indexOf(ancora);
  if (i < 0) return null;
  const m = dbSrc.slice(i).match(/INSERT INTO medications\s*\(([^)]*)\)\s*VALUES/);
  return m ? m[1].split(',').map(s => s.trim()) : null;
}
function colunasDoSet(ancora) {
  const i = dbSrc.indexOf(ancora);
  if (i < 0) return null;
  const m = dbSrc.slice(i).match(/UPDATE medications SET ([\s\S]*?)WHERE/);
  return m ? m[1].split(',').map(s => s.trim().split('=')[0].trim()) : null;
}

const migracao = COLUNAS.filter(c => !dbSrc.includes(`ALTER TABLE medications ADD COLUMN ${c}`));
check('migração cria as 5 colunas', migracao, []);

const ALVOS = [
  ['addMedication',     listaDeColunas('INSERT INTO medications (generic_name')],
  ['RESTORE do backup', listaDeColunas('INSERT INTO medications (id, generic_name')],
  ['updateMedication',  colunasDoSet('UPDATE medications SET generic_name')],
];
for (const [nome, cols] of ALVOS) {
  check(`${nome}: SQL tem as 5 colunas`, cols == null ? ['SQL NÃO ENCONTRADO'] : COLUNAS.filter(c => !cols.includes(c)), []);
}

// Contagem de ? bate com a de colunas? Errar aqui desloca TODOS os valores em silêncio.
for (const [nome, ancora] of [['addMedication', 'INSERT INTO medications (generic_name'],
                              ['RESTORE do backup', 'INSERT INTO medications (id, generic_name']]) {
  const cols = (listaDeColunas(ancora) || []).length;
  const i = dbSrc.indexOf(ancora);
  const mv = dbSrc.slice(i).match(/VALUES\s*\(([^)]*)\)/);
  const marks = mv ? (mv[1].match(/\?/g) || []).length : 0;
  check(`${nome}: ${cols} colunas ↔ ${marks} placeholders`, cols === marks && cols > 0, true);
}

// A foto é o único dado do medicamento que NÃO cabe numa coluna: o backup tem de carregar o
// arquivo. Sem isto, restaurar traz o remédio com um caminho apontando para o nada.
console.log('\n  A FOTO SOBREVIVE AO BACKUP (é arquivo, não coluna)\n');
check('export embute a foto em base64', dbSrc.includes('fotoParaBase64'), true);
check('restore recria o arquivo', dbSrc.includes('base64ParaFoto'), true);
// O caminho do backup é do OUTRO celular: gravar ele cru daria um <Image> quebrado.
check('restore NÃO grava o caminho do outro celular',
  /base64ParaFoto\(m\.id/.test(dbSrc) && !/m\.photo_uri \?\? null\]/.test(dbSrc), true);

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. O ritmo com pausa está errado — a pessoa pode\n    tomar na semana de descanso e descansar na de tomar, sem nenhum aviso.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. A volta do ciclo é estável, inclusive para trás.\n');
