// Testa o reconhecimento de handle morto do SQLite (src/database/db.ts) contra as mensagens
// REAIS de produção.
//
// O cenário que motiva tudo isto: o handle nativo do banco morre quando o Android destrói a
// Activity, e o db.ts reconhece isso pela MENSAGEM do erro para reabrir o banco. Um regex que
// não casa com a mensagem real falha CALADO: o erro sobe, o banco nunca reabre, e as gravações
// de log — as doses que o usuário respondeu — param de acontecer até o app reiniciar.
//
// Foi exatamente o que aconteceu: a 1.4.1 cobriu só o sabor "shared object already released" e
// deixou passar o sabor NullPointerException, que rendeu 921 eventos no Sentry em 2 semanas
// (issue REACT-NATIVE-1) sem ninguém notar. Este gate fixa as duas pontas do padrão:
// o que TEM de casar, e o que NÃO PODE casar.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// Carrega o predicado REAL, transpilando o TS — não uma cópia do regex, que poderia divergir do
// que roda em produção (que é justamente o bug que este teste existe para pegar). Os imports
// nativos viram stubs: nada aqui os usa, e o db.ts não tem efeito colateral no topo.
// Os imports de TIPO (`../types`) somem sozinhos na transpilação e nunca precisaram de stub.
// Os de VALOR, não: `medCycle` emite require e quebraria o gate por caminho relativo. Ele é
// testado por inteiro no test:cycle; aqui basta existir.
const src = fs.readFileSync(path.join(ROOT, 'src/database/db.ts'), 'utf8')
  .replace("import * as SQLite from 'expo-sqlite';", 'const SQLite = {};')
  .replace("import * as Sentry from '@sentry/react-native';", 'const Sentry = { captureMessage: () => {} };')
  .replace(/^import \{ diaTemDose \} from '\.\.\/utils\/medCycle';$/m, 'const diaTemDose = () => true;');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { ehHandleMorto } = mod.exports;

if (typeof ehHandleMorto !== 'function') {
  console.log('  ✗ FALHOU  db.ts não exporta ehHandleMorto — o gate não consegue testar nada.');
  process.exit(1);
}

let falhas = 0;
const check = (esperado, nome, msg) => {
  const real = ehHandleMorto(new Error(msg));
  const passou = real === esperado;
  if (!passou) falhas++;
  console.log(`  ${passou ? '✓' : '✗ FALHOU'}  ${nome.padEnd(54)} → ${real ? 'REABRE' : 'erro sobe'}`);
};

// ── TEM de casar: handle morto, nas duas camadas em que ele aparece ─────────────
// Sabor 2 — mensagem literal do Sentry (REACT-NATIVE-1, 921 eventos). O objeto nativo já foi
// destruído (NativeDatabase.close() → mHybridData.resetNative()) mas o JS ainda o alcança, então
// a chamada chega no JNI morto. Este é o que a 1.4.1 deixou passar.
check(true, 'HANDLE MORTO: prepareAsync rejeitado com NPE (JNI morto)',
  "Call to function 'NativeDatabase.prepareAsync' has been rejected.\n→ Caused by: java.lang.NullPointerException: java.lang.NullPointerException");
check(true, 'HANDLE MORTO: mesma NPE em runAsync',
  "Call to function 'NativeDatabase.runAsync' has been rejected.\n→ Caused by: java.lang.NullPointerException: java.lang.NullPointerException");
// Sabor 1 — o registro de shared objects do JS já perdeu o objeto; o Expo barra antes do nativo.
check(true, 'HANDLE MORTO: shared object já liberado (barrado no JS)',
  'Cannot use shared object that was already released');

// ── NÃO PODE casar: erro de SQL legítimo ───────────────────────────────────────
// Todo erro de função nativa vem embrulhado em "has been rejected" (CodedException.kt:170), então
// casar com esse texto sozinho reabriria o banco e REPETIRIA a escrita em cima de um erro válido.
// O que separa é a NPE: erro de SQL de verdade vem como SQLiteErrorException, nunca como NPE.
check(false, 'SQL LEGÍTIMO: UNIQUE constraint failed',
  "Call to function 'NativeDatabase.prepareAsync' has been rejected.\n→ Caused by: UNIQUE constraint failed: medications.id");
check(false, 'SQL LEGÍTIMO: no such table',
  "Call to function 'NativeDatabase.runAsync' has been rejected.\n→ Caused by: no such table: medications");
check(false, 'SQL LEGÍTIMO: database is locked',
  "Call to function 'NativeDatabase.runAsync' has been rejected.\n→ Caused by: database is locked");
check(false, 'SQL LEGÍTIMO: datatype mismatch',
  "Call to function 'NativeDatabase.runAsync' has been rejected.\n→ Caused by: datatype mismatch");

// ── NÃO PODE casar: NPE que não é do banco ─────────────────────────────────────
check(false, 'OUTRO MÓDULO: NPE do ExpoNotifications',
  "Call to function 'ExpoNotifications.getDevicePushTokenAsync' has been rejected.\n→ Caused by: java.lang.NullPointerException");
check(false, 'JS COMUM: TypeError de null',
  "null is not an object (evaluating 'med.generic_name')");

console.log('');
console.log(falhas === 0
  ? '  ✓ Todos os cenários passaram. Handle morto reabre o banco; erro de SQL sobe sem repetir a escrita.'
  : `  ✗ ${falhas} FALHA(S) — o reconhecimento de handle morto está furado.`);
process.exit(falhas === 0 ? 0 : 1);
