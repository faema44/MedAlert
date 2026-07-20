// Testa o recado que alimenta o widget da tela inicial (src/utils/widgetDados.ts).
//
// O widget é desenhado pelo LAUNCHER, num processo que não roda o nosso JS. Ele não pergunta
// nada — só lê o que ficou escrito. Isso cria um modo de falha próprio: o que estiver errado
// aqui fica na tela inicial da pessoa por horas, sem nenhuma tela do app para contradizer.
//
// E o mais perigoso: dose de um dia de PAUSA anunciada no widget faz a pessoa tomar
// anticoncepcional na semana de descanso.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/utils/widgetDados.ts'), 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { montarDadosWidget, MAX_PROXIMAS, MAX_ESTOQUE, DIAS_ESTOQUE_BAIXO } = mod.exports;

if (typeof montarDadosWidget !== 'function') {
  console.log('  ✗ FALHOU  widgetDados.ts não exporta montarDadosWidget — o gate não testa nada.');
  process.exit(1);
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(58)}${ok ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`);
}

const AGORA = new Date(2026, 6, 19, 12, 0, 0).getTime();
const h = (n) => AGORA + n * 3600000;
const item = (nome, quandoMs, extra = {}) => ({ nome, dose: '10 mg', quandoMs, ...extra });

console.log('\n  ORDEM E LIMITE\n');
{
  const d = montarDadosWidget([
    item('Terceiro', h(5)), item('Primeiro', h(1)), item('Quarto', h(9)), item('Segundo', h(3)),
  ], AGORA);
  check('ordena por horário, não pela ordem de cadastro',
    d.proximas.map(p => p.nome), ['Primeiro', 'Segundo', 'Terceiro']);
  check('corta no máximo do widget grande', d.proximas.length, MAX_PROXIMAS);
}

console.log('\n  O QUE FICA DE FORA\n');
{
  // Dose que já passou não é "próxima". No widget ela seria pior que inútil: a pessoa
  // olharia a tela inicial e acharia que ainda vai tomar.
  const d = montarDadosWidget([item('Passou', h(-2)), item('Vem', h(2))], AGORA);
  check('dose já vencida não entra', d.proximas.map(p => p.nome), ['Vem']);
  // Sem horário = medicamento sem lembrete (só ficha de emergência). Não tem "próxima".
  const d2 = montarDadosWidget([item('Sem lembrete', null), item('Com', h(1))], AGORA);
  check('sem horário não entra', d2.proximas.map(p => p.nome), ['Com']);
  check('nada agendado → lista vazia, não estoura', montarDadosWidget([], AGORA).proximas, []);
}

console.log('\n  O TEXTO DO TEMPO NÃO VEM PRONTO\n');
// O widget pode ficar horas na tela depois de gravado. "em 2 horas" escrito aqui viraria
// mentira sozinho; o Kotlin formata na hora de desenhar, a partir do instante.
{
  const d = montarDadosWidget([item('X', h(2))], AGORA);
  check('guarda o INSTANTE em ms', d.proximas[0].quandoMs, h(2));
  check('não guarda texto de tempo pronto',
    Object.keys(d.proximas[0]).some(k => /texto|label|quando$/i.test(k)), false);
}

console.log('\n  ESTOQUE ACABANDO\n');
{
  const d = montarDadosWidget([
    item('Farto', h(1), { diasDeEstoque: 30 }),
    item('Acabando', h(2), { diasDeEstoque: 2 }),
    item('Acabou', h(3), { diasDeEstoque: 0 }),
    item('NoLimite', h(4), { diasDeEstoque: DIAS_ESTOQUE_BAIXO }),
  ], AGORA);
  // Quem acaba amanhã importa mais que quem acaba em três dias.
  check('menos dias primeiro', d.estoqueBaixo.map(e => e.nome), ['Acabou', 'Acabando', 'NoLimite']);
  check('quem tem de sobra fica fora', d.estoqueBaixo.some(e => e.nome === 'Farto'), false);
  check('sem controle de estoque não vira alerta',
    montarDadosWidget([item('X', h(1))], AGORA).estoqueBaixo, []);
}
{
  // Um remédio 3x/dia apareceria 3 vezes na mesma lista de "acabando".
  const d = montarDadosWidget([
    item('Enalapril', h(1), { diasDeEstoque: 1 }),
    item('Enalapril', h(9), { diasDeEstoque: 1 }),
    item('Enalapril', h(14), { diasDeEstoque: 1 }),
  ], AGORA);
  check('não repete o mesmo remédio no estoque', d.estoqueBaixo.length, 1);
  // Mas nas PRÓXIMAS ele repete de propósito: são doses diferentes do mesmo dia.
  check('…e nas próximas doses ele repete, porque são doses distintas', d.proximas.length, 3);
}
{
  const muitos = [];
  for (let i = 1; i <= 10; i++) muitos.push(item(`Med${i}`, h(i), { diasDeEstoque: i % 4 }));
  check('estoque também tem teto', montarDadosWidget(muitos, AGORA).estoqueBaixo.length <= MAX_ESTOQUE, true);
}

console.log('\n  CRÍTICO É SINALIZADO\n');
{
  const d = montarDadosWidget([item('Varfarina', h(1), { critico: true }), item('Comum', h(2))], AGORA);
  check('crítico marcado', d.proximas[0].critico, true);
  check('comum não marcado', d.proximas[1].critico, false);
}

console.log('\n  QUEM MUDA O PLANO REESCREVE O WIDGET\n');
// O widget não roda JS: ele mostra o que ficou escrito da última vez. Se um caminho muda o
// plano e não reescreve, a tela inicial anuncia o plano ANTIGO — e nada DENTRO do app
// contradiz, porque toda tela do app lê o banco direto.
//
// Foi exatamente o que aconteceu: alimentar o widget só existia em
// rescheduleAllActiveNotifications (start do app e restore). Editar um remédio deixava a
// tela inicial com o horário velho até o app ser reaberto.
{
  const notif = fs.readFileSync(path.join(ROOT, 'src/services/notifications.ts'), 'utf8');
  // Corpo de cada função exportada, do cabeçalho até a chave de fechamento na coluna 0.
  const corpoDe = (nome) => {
    const i = notif.indexOf(`export async function ${nome}(`);
    if (i < 0) return null;
    const fim = notif.indexOf('\n}', i);
    return fim < 0 ? null : notif.slice(i, fim);
  };
  for (const fn of [
    'rescheduleAllActiveNotifications',   // start do app e restore
    'rescheduleRemindersForMedication',   // salvar/editar um remédio
    'cancelAllRemindersForMedication',    // remover ou suspender
  ]) {
    const corpo = corpoDe(fn);
    check(`${fn} alimenta o widget`,
      corpo != null && /alimentarWidget|atualizarWidget/.test(corpo), true);
  }

  // Mexer no estoque também muda o widget (o bloco "ACABANDO"), e esse caminho não passa por
  // nenhum reagendamento: tomar a dose desconta direto. Quem chama updateMedicationStock tem
  // de reescrever o widget — senão a tela inicial fica com a contagem antiga.
  const telas = path.join(ROOT, 'src/screens');
  for (const arq of fs.readdirSync(telas).filter(f => f.endsWith('.tsx'))) {
    const txt = fs.readFileSync(path.join(telas, arq), 'utf8');
    if (!/updateMedicationStock\(/.test(txt)) continue;
    check(`${arq} mexe no estoque e reescreve o widget`,
      /atualizarWidget\(/.test(txt), true);
  }
}

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. O widget mostraria dado errado na tela inicial —\n    e lá não há nenhuma tela do app para contradizê-lo.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. O widget recebe instante, não texto envelhecido.\n');
