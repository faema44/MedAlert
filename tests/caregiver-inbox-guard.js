// Testa a contagem de recados NÃO VISTOS do cuidador (src/services/caregiver.ts).
//
// O problema que isto resolve: a notificação do cuidador é local e passageira. Quem não olhou
// na hora — dormindo, dirigindo, em reunião — perde o aviso, ele some da bandeja, e o recado
// fica no inbox sem que ninguém tenha como saber. O selo no 👥 é o que sobrevive a isso.
//
// O modo de falha é CALADO nos dois sentidos, e os dois doem:
//   selo que não aparece  → o cuidador não descobre que a idosa não tomou o remédio
//   selo que não zera     → ele aprende a ignorar o selo, e aí ele deixa de valer para sempre
//
// Carrega o TS REAL transpilado, com o KV trocado por um mapa em memória.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/services/caregiver.ts'), 'utf8')
  // Import multi-linha não cai num regex de uma linha só: o que sobrava do bloco virava
  // lixo e o transpilado nem parseava. Este casa o bloco inteiro até o `from '...';`.
  .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');

const prelude = `
  const kv = new Map();
  const getKV = async (k) => (kv.has(k) ? kv.get(k) : null);
  const setKV = async (k, v) => { kv.set(k, v); };
  const Notifications = { scheduleNotificationAsync: async () => {}, cancelScheduledNotificationAsync: async () => {},
    getAllScheduledNotificationsAsync: async () => [], SchedulableTriggerInputTypes: {}, setNotificationHandler: () => {} };
  const Platform = { OS: 'android' };
  const Sentry = { captureMessage: () => {}, captureException: () => {} };
  const Device = {}; const Crypto = { getRandomBytes: (n) => new Uint8Array(n) };
  const TaskManager = { defineTask: () => {}, isTaskDefined: () => false };
  const encrypt = () => '', decrypt = () => '', newSharedKey = () => '', toB64 = () => '', fromB64 = () => new Uint8Array();
  const getMedications = async () => [], getRemindersForMedication = async () => [];
  const getCaregiver = async () => null, getProfile = async () => null;
  const appJson = { expo: { extra: { eas: { projectId: 'teste' } } } };
  const module_kv = kv;
`;
const js = ts.transpileModule(prelude + src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js + ';module.exports.__kv = module_kv;')(mod, mod.exports, require);
const { contarRecadosNaoVistos, marcarRecadosVistos, __kv } = mod.exports;

for (const [nome, fn] of [['contarRecadosNaoVistos', contarRecadosNaoVistos], ['marcarRecadosVistos', marcarRecadosVistos]]) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  caregiver.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = real === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(56)}${ok ? '' : ` → ${real} (esperado ${esperado})`}`);
}

const agora = Date.now();
const min = (n) => new Date(agora - n * 60000).toISOString();
const porInbox = (itens) => { __kv.set('caregiver_inbox', JSON.stringify(itens)); };
const semVisto = () => { __kv.delete('caregiver_inbox_visto_em'); };

(async () => {
  console.log('\n  CONTAGEM DE RECADOS NÃO VISTOS\n');

  porInbox([]); semVisto();
  check('inbox vazio → 0', await contarRecadosNaoVistos(), 0);

  // Quem instala já com recado precisa VER o selo. Começar zerado esconderia o primeiro aviso,
  // que é justamente o que mais importa.
  porInbox([{ pid: 'a', text: 'não tomou', at: min(30) }, { pid: 'a', text: 'nem esta', at: min(10) }]);
  semVisto();
  check('sem "visto" gravado → tudo conta como novo', await contarRecadosNaoVistos(), 2);

  await marcarRecadosVistos();
  check('depois de abrir a lista → zera', await contarRecadosNaoVistos(), 0);

  porInbox([
    { pid: 'a', text: 'antigo', at: min(30) },
    { pid: 'a', text: 'novo 1', at: new Date(agora + 1000).toISOString() },
    { pid: 'b', text: 'novo 2', at: new Date(agora + 2000).toISOString() },
  ]);
  check('só os que chegaram DEPOIS de ver', await contarRecadosNaoVistos(), 2);
  check('conta recado de QUALQUER idoso acompanhado', await contarRecadosNaoVistos(), 2);

  // Os dois "novos" acima têm carimbo NO FUTURO de propósito: é o que acontece quando o
  // relógio do celular do idoso está adiantado. Marcando "visto" só até agora, eles ficariam
  // eternamente não vistos e o selo nunca zeraria — e um selo que não zera treina o cuidador
  // a ignorá-lo. Por isso marcarRecadosVistos marca até o item mais novo, não até agora.
  await marcarRecadosVistos();
  check('abrir zera mesmo com carimbo no futuro (relógio do idoso adiantado)',
    await contarRecadosNaoVistos(), 0);

  console.log('\n  ERRAR PARA O LADO DE AVISAR\n');
  // Data ilegível não pode virar silêncio: na dúvida, o cuidador tem de ser avisado.
  porInbox([{ pid: 'a', text: 'data quebrada', at: 'ontem à tarde' }]);
  check('data ilegível conta como novo', await contarRecadosNaoVistos(), 1);

  __kv.set('caregiver_inbox_visto_em', 'lixo');
  porInbox([{ pid: 'a', text: 'x', at: min(5) }, { pid: 'a', text: 'y', at: min(1) }]);
  check('"visto" corrompido → conta tudo, não zero', await contarRecadosNaoVistos(), 2);

  __kv.set('caregiver_inbox', '{ isso não é json');
  check('inbox corrompido não estoura', await contarRecadosNaoVistos(), 0);

  console.log('');
  if (falhas) {
    console.log(`  ✗ ${falhas} cenário(s) falharam. O selo do cuidador está errado — ele pode não\n    descobrir que o idoso deixou de tomar o remédio.\n`);
    process.exit(1);
  }
  console.log('  ✓ Todos os cenários passaram. O selo aparece por padrão e só o ABRIR zera.\n');
})();
