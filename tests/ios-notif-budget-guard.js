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
const { basesDoPeriodo, calcularNagsPorLembrete, custoDaCartela, diasDeCartelaQueCabem, horarioDaChecagem,
        JANELA_CICLO_DIAS, BORDAS_CICLO, CURVA_COBRANCA, COBRANCAS_MAX, COBRANCAS_HISTORICO, instanteDaCobranca } = mod.exports;

for (const [nome, fn] of [['basesDoPeriodo', basesDoPeriodo], ['calcularNagsPorLembrete', calcularNagsPorLembrete],
                          ['custoDaCartela', custoDaCartela], ['diasDeCartelaQueCabem', diasDeCartelaQueCabem],
                          ['instanteDaCobranca', instanteDaCobranca]]) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  notifications.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

const TETO = 64;
// LIDO do código, não fixado aqui: se a curva de cobrança mudar, o gate acompanha em vez de
// virar mentira verde. Foi o que aconteceu ao trocar 5-em-5 por crescente.
const MAX_NAGS = COBRANCAS_MAX;
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
// Com a curva de 4, o teto da cobrança é 4 — a casa só começa a perder insistência a partir
// de 13 horários, contra 9 na régua antiga de 6. É o limiar que a curva comprou.
check('8 horários: ainda cobrança cheia', calcularNagsPorLembrete(8, 8, 0), MAX_NAGS);
check('12 horários: ainda cobrança cheia (era 3 na régua antiga)', calcularNagsPorLembrete(12, 12, 0), MAX_NAGS);
check('13 horários: começa a ceder', calcularNagsPorLembrete(13, 13, 0), 3);
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
check('a cartela com cobrança custaria 107 no ciclo cheio no iOS (por isso NÃO tem lá)',
  21 * (1 + CURVA_COBRANCA.length) + 2, 107);

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

console.log('\n  CURVA DE COBRANÇA — crescente, não de 5 em 5\n');
check('4 cobranças, não 6', CURVA_COBRANCA.length, 4);
check('a primeira ainda é rápida (5 min)', CURVA_COBRANCA[0], 5);
check('cobre 3 horas (a régua linear cobria 30 min)', CURVA_COBRANCA[CURVA_COBRANCA.length - 1], 180);
check('é estritamente crescente', CURVA_COBRANCA.every((v, i) => i === 0 || v > CURVA_COBRANCA[i - 1]), true);
// O ponto da curva: com POUCAS cobranças sobreviventes ela rende muito mais que a linear —
// e é justamente no aperto que sobram poucas.
check('com 2 sobreviventes cobre 20 min (linear cobria 10)', CURVA_COBRANCA[1], 20);
check('com 3 sobreviventes cobre 60 min (linear cobria 15)', CURVA_COBRANCA[2], 60);
check('custo por horário caiu de 7 para 5', 1 + CURVA_COBRANCA.length, 5);

// O array certo não basta: o agendamento tem de USAR a curva. Sabotando o disparo de volta
// para `i * intervalo` e deixando o array intacto, o gate passava — conferia o dado, não o
// comportamento. Estes casos travam o instante real de cada cobrança.
const min = (dose, i) => (instanteDaCobranca(dose, i) - dose) / 60000;
const DOSE = new Date(2026, 6, 19, 8, 0, 0, 0).getTime();
check('1ª cobrança dispara 5 min após a dose', min(DOSE, 1), 5);
check('2ª dispara aos 20 min (linear daria 10)', min(DOSE, 2), 20);
check('3ª dispara aos 60 min (linear daria 15)', min(DOSE, 3), 60);
check('4ª dispara aos 180 min (linear daria 20)', min(DOSE, 4), 180);
check('os intervalos CRESCEM entre si (não é régua fixa)',
  min(DOSE, 2) - min(DOSE, 1) < min(DOSE, 4) - min(DOSE, 3), true);

// Quem ATUALIZA o app tem as cobranças 5 e 6 já agendadas pela régua linear antiga. Se a
// varredura de limpeza encolher junto com a curva, elas nunca são canceladas e ficam tocando
// para sempre num ritmo que o app não oferece mais — e ocupando slot no iPhone.
check('o teto de limpeza NÃO encolhe com a curva', COBRANCAS_HISTORICO >= 6, true);
check('…e cobre com folga a curva atual', COBRANCAS_HISTORICO > CURVA_COBRANCA.length, true);

console.log('\n  CHECAGEM NOTURNA — derivada da dose, nunca fixa\n');
// Fixar em 22h quebraria para quem toma antes de dormir: a "checagem" viria ANTES da dose.
const chk = (h, m = 0) => { const r = horarioDaChecagem(h, m); return `${String(r.h).padStart(2, '0')}:${String(r.m).padStart(2, '0')}${r.diaSeguinte ? '+1' : ''}`; };
check('dose 08:00 → checagem 11:00', chk(8), '11:00');
check('dose 12:00 → checagem 15:00', chk(12), '15:00');
check('dose 20:00 → 23:00', chk(20), '23:00');
// A primeira regra que escrevi tinha teto de 23:00 e quebrava aqui embaixo — a checagem caía
// na madrugada para dose noturna ou de madrugada. Estes são os casos que o gate pegou.
check('dose 21:00 → 07:00 do dia seguinte (não 00:00)', chk(21), '07:00+1');
check('dose 22:00 → 07:00 do dia seguinte (não 01:00)', chk(22), '07:00+1');
check('dose 23:30 → 07:00 do dia seguinte', chk(23, 30), '07:00+1');
check('dose 00:00 → 07:00 do MESMO dia (não 03:00)', chk(0), '07:00');
check('dose 02:00 → 07:00 do mesmo dia (não 05:00)', chk(2), '07:00');
check('dose 05:00 → 08:00, já é horário de vigília', chk(5), '08:00');

const varre = (f) => Array.from({ length: 24 * 4 }, (_, i) => f(Math.floor(i / 4), (i % 4) * 15)).every(Boolean);
check('nunca cai ANTES da dose (varredura de 15 em 15 min)',
  varre((h, m) => { const r = horarioDaChecagem(h, m); return (r.h * 60 + r.m) + (r.diaSeguinte ? 1440 : 0) > h * 60 + m; }), true);
check('NUNCA cai entre 00:00 e 06:59 — ninguém acorda para confirmar',
  varre((h, m) => { const r = horarioDaChecagem(h, m); return r.h >= 7; }), true);
check('nunca passa de 3h depois da dose, salvo empurrão da madrugada',
  varre((h, m) => { const r = horarioDaChecagem(h, m); const d = (r.h * 60 + r.m) + (r.diaSeguinte ? 1440 : 0) - (h * 60 + m); return d <= 180 || r.h === 7; }), true);

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
// 12 horários e não 8: com a curva de 4 o teto ainda não morde em 8, e os dois lados dariam
// 4 — o teste passaria sem provar nada.
check('cartela reduz a cobrança dos outros (12 horários)',
  calcularNagsPorLembrete(12, 12, 0, CARTELA_7D) < calcularNagsPorLembrete(12, 12, 0, 0), true);
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
