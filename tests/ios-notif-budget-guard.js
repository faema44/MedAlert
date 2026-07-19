// Testa o rateio das 64 notificações do iOS (src/services/notifications.ts).
//
// O iOS guarda no máximo 64 notificações locais pendentes e descarta o excesso SOZINHO,
// sem erro e sem log. Com a repetição ligada são 7 requests por horário (1 dose + 6
// cobranças), então ~8 horários já estouram.
//
// O que torna isso perigoso não é estourar: é QUEM o iOS mata. Ele guarda as 64 mais
// PRÓXIMAS — o avesso do que importa. Uma cobrança das 08:05 derruba a DOSE das 20:00.
// Ninguém perde remédio por falta de insistência; perde por falta do aviso.
//
// Por isso a regra é: dose intocável, cobrança é o amortecedor. Este gate fixa as duas
// pontas — que a conta NUNCA sacrifica dose, e que ela não corta cobrança à toa quando
// tudo cabe. Falha calada é o modo de falhar aqui: ninguém percebe uma dose que não
// avisou, então a aritmética precisa de trava.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

// Carrega as funções REAIS, transpilando o TS — não uma cópia da conta, que poderia
// divergir do que roda em produção (o mesmo motivo do gate do sqlite-handle). Os imports
// viram stubs: as duas funções sob teste são puras e não tocam em nada disso.
const src = fs.readFileSync(path.join(ROOT, 'src/services/notifications.ts'), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^Notifications\.setNotificationHandler\(\{[\s\S]*?\}\);$/m, '');
const prelude = `
  const Notifications = { setNotificationHandler: () => {}, SchedulableTriggerInputTypes: {} };
  const Platform = { OS: 'ios' };
  const Sentry = { captureMessage: () => {}, captureException: () => {} };
  const isPhytotherapic = () => false;
  const CAREGIVER_CHANNEL = 'x';
  const postMedNotification = () => {}, cancelMedNotification = () => {}, isEmergencyActive = () => {};
  const setNextMedSchedule = () => {}, cancelNextMedBanner = () => {};
  const getRemindersForMedication = () => {}, getMedications = () => {}, getActivities = () => {};
  const getRemindersForActivity = () => {}, getAppointments = () => {}, getContacts = () => {};
  const getKV = () => {}, setKV = () => {}, addMedicationLowStockLog = () => {};
  const cicloDoMedicamento = (m) => (m && m.cycle_kind ? m : null);
  const diaTemDose = () => true;
`;
const js = ts.transpileModule(prelude + src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { basesDoPeriodo, calcularNagsPorLembrete, custoDaCartela, diasDeCartelaQueCabem,
        JANELA_CICLO_DIAS, BORDAS_CICLO } = mod.exports;

for (const [nome, fn] of [['basesDoPeriodo', basesDoPeriodo], ['calcularNagsPorLembrete', calcularNagsPorLembrete],
                          ['custoDaCartela', custoDaCartela], ['diasDeCartelaQueCabem', diasDeCartelaQueCabem]]) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  notifications.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

const TETO = 64;
const MAX_NAGS = 6;
let falhas = 0;

function check(nome, real, esperado) {
  const passou = real === esperado;
  if (!passou) falhas++;
  console.log(`  ${passou ? '✓' : '✗ FALHOU'}  ${nome.padEnd(56)} → ${real}${passou ? '' : ` (esperado ${esperado})`}`);
}

console.log('\n  BASES POR LEMBRETE — o iOS conta por request, não por lembrete\n');
check('diário ocupa 1 vaga', basesDoPeriodo('day'), 1);
check('period vazio = diário', basesDoPeriodo(undefined), 1);
check('semanal seg/qua/sex ocupa 3 vagas', basesDoPeriodo('week:2,4,6'), 3);
check('semanal só segunda ocupa 1', basesDoPeriodo('week:2'), 1);
check('mensal dias 1 e 15 ocupa 2', basesDoPeriodo('month:1,15'), 2);
check('a cada N meses ocupa 1', basesDoPeriodo('nmonths:2:10'), 1);

console.log('\n  RATEIO — cabendo tudo, nada muda\n');
check('1 remédio 1x/dia com repetição', calcularNagsPorLembrete(1, 1, 0), MAX_NAGS);
check('5 remédios 1x/dia (o setup do usuário)', calcularNagsPorLembrete(5, 5, 0), MAX_NAGS);
check('sem nenhuma repetição ligada', calcularNagsPorLembrete(40, 0, 0), MAX_NAGS);

console.log('\n  RATEIO — apertando, a cobrança cede antes da dose\n');
check('8 horários com repetição (estouraria em 7×8=56+8)', calcularNagsPorLembrete(8, 8, 0), 6);
check('10 horários com repetição', calcularNagsPorLembrete(10, 10, 0), 5);
check('12 horários com repetição', calcularNagsPorLembrete(12, 12, 0), 4);
check('20 horários com repetição', calcularNagsPorLembrete(20, 20, 0), 2);
check('consultas futuras comem do orçamento', calcularNagsPorLembrete(10, 10, 5), 4);

console.log('\n  RATEIO — no extremo, some a cobrança; a dose fica\n');
check('30 horários: ainda sobra 1 cobrança cada', calcularNagsPorLembrete(30, 30, 0), 1);
check('50 horários: cobrança zerada — a dose fica', calcularNagsPorLembrete(50, 50, 0), 0);
check('60 doses: orçamento negativo vira 0, não negativo', calcularNagsPorLembrete(60, 10, 0), 0);

console.log('\n  A TRAVA QUE IMPORTA — a conta nunca pode sacrificar dose\n');
// Percorre setups plausíveis e prova que o total agendado cabe em 64. É esta a linha
// que não pode ser cruzada: se o total passar de 64, o iOS escolhe quem morre — e ele
// escolhe errado, matando a dose distante para manter a cobrança próxima.
let piorCaso = 0;
let estourou = null;
for (let horarios = 1; horarios <= 40; horarios++) {
  for (const consultas of [0, 3, 8]) {
    const nags = calcularNagsPorLembrete(horarios, horarios, consultas);
    const total = horarios + horarios * nags + consultas * 2;
    if (total > piorCaso) piorCaso = total;
    if (total > TETO && !estourou) estourou = { horarios, consultas, total };
    if (nags < 0 || nags > MAX_NAGS) { estourou = { horarios, consultas, nags }; }
  }
}
check(`nenhum setup de 1 a 40 horários estoura 64 (pior caso: ${piorCaso})`, estourou, null);

// ---------------------------------------------------------------------------
// RITMO COM PAUSA (cartela/adesivo/anel) — src/utils/medCycle.ts
//
// A cartela não tem gatilho nativo: 21/7 não é diário, semanal nem mensal, então cada dia
// coberto é uma notificação DATADA. É a única coisa no app que consome slots em bloco, e
// por isso a única capaz de calar os remédios dos outros moradores — o iOS guarda as 64
// mais PRÓXIMAS, e 21 dias de cartela ocupariam a janela inteira.
// ---------------------------------------------------------------------------
console.log('\n  RITMO COM PAUSA — a cartela cede primeiro, e as bordas nunca caem\n');

check('janela é de 7 dias, não o ciclo inteiro', JANELA_CICLO_DIAS, 7);
check('reinício + retirada são 2 slots reservados', BORDAS_CICLO, 2);
check('7 dias ativos custam 16 (7×2 + 2 bordas)', custoDaCartela(7), 16);
check('em plena pausa custa só as 2 bordas', custoDaCartela(0), 2);
check('sem checagem noturna, 7 dias custam 9', custoDaCartela(7, false), 9);
check('dias negativos não viram crédito', custoDaCartela(-5), BORDAS_CICLO);

// O número que decidiu o desenho: com cobrança de 5 em 5 min seriam 7 requests/dia.
check('a cartela com cobrança custaria 149 no ciclo cheio (por isso NÃO tem)', 21 * 7 + 2, 149);

console.log('\n  A CARTELA NUNCA PODE SACRIFICAR DOSE ALHEIA\n');
const CARTELA_7D = custoDaCartela(7);
let piorComCartela = 0, estourouComCartela = null, menorJanela = JANELA_CICLO_DIAS;
for (let horarios = 1; horarios <= 40; horarios++) {
  for (const consultas of [0, 3, 8]) {
    for (const cartelas of [0, 1, 2]) {
      // A janela ENCOLHE conforme o aperto — é o passo 4 da hierarquia.
      const dias = diasDeCartelaQueCabem(JANELA_CICLO_DIAS, cartelas, horarios, consultas);
      const slots = cartelas > 0 ? cartelas * custoDaCartela(dias) : 0;
      if (cartelas > 0 && dias < menorJanela) menorJanela = dias;
      const nags = calcularNagsPorLembrete(horarios, horarios, consultas, slots);
      const total = horarios + horarios * nags + consultas * 2 + slots;
      if (total > piorComCartela) piorComCartela = total;
      if (total > TETO && !estourouComCartela) estourouComCartela = { horarios, consultas, cartelas, dias, total };
      if (nags < 0 || nags > MAX_NAGS) estourouComCartela = { horarios, consultas, cartelas, nags };
    }
  }
}
check(`1 a 40 horários × até 2 cartelas cabe em 64 (pior: ${piorComCartela})`, estourouComCartela, null);
check(`no aperto a janela encolhe (mínimo visto: ${menorJanela} dias)`, menorJanela < JANELA_CICLO_DIAS, true);

console.log('\n  A JANELA CEDE, AS BORDAS NÃO\n');
check('casa vazia: cartela leva a janela inteira', diasDeCartelaQueCabem(7, 1, 2, 0), 7);
check('casa de 20 horários: ainda cabe a janela', diasDeCartelaQueCabem(7, 1, 20, 0), 7);
check('casa de 40 + 8 consultas: janela encolhe a 1', diasDeCartelaQueCabem(7, 1, 40, 8), 1);
check('casa de 40 + 8 consultas + 2 cartelas: só as bordas', diasDeCartelaQueCabem(7, 2, 40, 8), 0);
check('sem cartela nenhuma, não reserva nada', diasDeCartelaQueCabem(7, 0, 10, 0), 0);
// Mesmo com a janela em zero, reinício e retirada continuam agendados.
check('janela zerada ainda custa as 2 bordas', custoDaCartela(diasDeCartelaQueCabem(7, 2, 40, 8)), BORDAS_CICLO);

// A cartela tem de EMPURRAR a cobrança para baixo. Se não empurrar, ela é invisível para o
// rateio — que é exatamente o bug que este bloco existe para impedir.
check('cartela reduz a cobrança dos outros (8 horários)',
  calcularNagsPorLembrete(8, 8, 0, CARTELA_7D) < calcularNagsPorLembrete(8, 8, 0, 0), true);
check('cartela some do rateio quando não existe',
  calcularNagsPorLembrete(8, 8, 0, 0), calcularNagsPorLembrete(8, 8, 0));

// Casa lotada: a cobrança zera, mas a DOSE de todos continua agendada.
const nagsLotada = calcularNagsPorLembrete(30, 30, 0, CARTELA_7D);
check('casa de 30 horários + cartela: cobrança cede a 0', nagsLotada, 0);
check('…e as doses + cartela ainda cabem', 30 + 30 * nagsLotada + CARTELA_7D <= TETO, true);

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. O rateio das 64 do iOS está errado — dose pode ser descartada em silêncio.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. A dose nunca cede; quem cede é a cobrança.\n');
