// Testa o resumo de adesão que vai para o médico (src/utils/relatorioMedico.ts).
//
// Este relatório é lido por quem PRESCREVE. Um erro aqui não vira tela feia — vira decisão
// clínica errada, e o paciente nunca saberá que a causa foi um arredondamento nosso:
//
//   sem-resposta contada como NÃO TOMOU → parece má adesão; o médico troca um remédio que
//                                         estava funcionando
//   sem-resposta contada como TOMOU     → parece que a dose não faz efeito; o médico AUMENTA
//
// Por isso o gate trava as três colunas separadas, e trava também o que NÃO é dose.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/utils/relatorioMedico.ts'), 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { montarRelatorio, faixaAdesao, textoAdesao } = mod.exports;

for (const [nome, fn] of [['montarRelatorio', montarRelatorio], ['faixaAdesao', faixaAdesao], ['textoAdesao', textoAdesao]]) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  relatorioMedico.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(58)}${ok ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`);
}

const HOJE = new Date(2026, 6, 19, 12, 0, 0);
const diasAtras = (n, h = 8) => new Date(2026, 6, 19 - n, h, 0, 0).toISOString();
const linha = (nome, quando, estado, dose = '1 comp') => ({
  id: 0, medication_id: 1, medication_name: nome, dose,
  notification_id: null, scheduled_at: quando,
  taken_at: estado === 'tomou' ? quando : null,
  taken: estado === 'tomou' ? 1 : estado === 'naoTomou' ? 0 : null,
  status: estado === 'tomou' ? 'taken' : estado === 'naoTomou' ? 'skipped' : null,
  created_at: quando,
});

console.log('\n  OS TRÊS ESTADOS CHEGAM INTEIROS AO PAPEL\n');
{
  const log = [
    linha('Enalapril', diasAtras(3), 'tomou'),
    linha('Enalapril', diasAtras(2), 'naoTomou'),
    linha('Enalapril', diasAtras(1), 'semResposta'),
  ];
  const r = montarRelatorio(log, 180, HOJE).medicamentos[0];
  check('tomou não absorve os outros', r.tomou, 1);
  check('não tomou fica separado', r.naoTomou, 1);
  check('SEM RESPOSTA não vira "não tomou"', r.semResposta, 1);
  check('total é a soma dos três', r.total, 3);
}

console.log('\n  O QUE NÃO É DOSE FICA FORA DA CONTA\n');
{
  const log = [
    linha('Enalapril', diasAtras(2), 'tomou'),
    { ...linha('Enalapril', diasAtras(1), 'semResposta'), status: 'low_stock' },
    { ...linha('Enalapril', diasAtras(1), 'semResposta'), status: 'treatment_ended' },
  ];
  const r = montarRelatorio(log, 180, HOJE).medicamentos[0];
  check('aviso de estoque não conta como dose', r.total, 1);
  check('fim de tratamento não conta como dose', r.semResposta, 0);
}

console.log('\n  JANELA DE 180 DIAS\n');
{
  const log = [
    linha('Enalapril', diasAtras(1), 'tomou'),
    linha('Enalapril', diasAtras(179), 'tomou'),
    linha('Enalapril', diasAtras(200), 'tomou'),   // fora
  ];
  const r = montarRelatorio(log, 180, HOJE).medicamentos[0];
  check('entra o que está dentro da janela', r.tomou, 2);
  check('fica fora o mais antigo que 180 dias', r.total, 2);
  check('relatório declara a janela', montarRelatorio(log, 180, HOJE).dias, 180);
}

console.log('\n  PRIMEIRA E ÚLTIMA DOSE\n');
{
  const log = [
    linha('Enalapril', diasAtras(90), 'semResposta'),  // mais antiga, SEM resposta
    linha('Enalapril', diasAtras(40), 'tomou'),
    linha('Enalapril', diasAtras(10), 'tomou'),        // última CONFIRMADA
    linha('Enalapril', diasAtras(1), 'semResposta'),   // recente, mas sem resposta
  ];
  const r = montarRelatorio(log, 180, HOJE).medicamentos[0];
  check('primeira dose = a mais antiga agendada, respondida ou não',
    r.primeiraDose.slice(0, 10), diasAtras(90).slice(0, 10));
  // Usar a última AGENDADA diria "última dose ontem" para quem parou há 10 dias e só não
  // desligou o lembrete — o contrário do que aconteceu.
  check('última dose = a última CONFIRMADA, não a última agendada',
    r.ultimaDose.slice(0, 10), diasAtras(10).slice(0, 10));
}
{
  const r = montarRelatorio([linha('X', diasAtras(5), 'semResposta')], 180, HOJE).medicamentos[0];
  check('sem nenhuma confirmação, última dose é null', r.ultimaDose, null);
}

console.log('\n  ADESÃO É FAIXA — nunca um número que esconde o desconhecido\n');
// A 1ª versão dividia só pelas RESPONDIDAS, e isso mentia PARA CIMA: excluir o desconhecido
// do denominador é, na prática, assumir que o desconhecido foi tomado. Sinvastatina com 45
// tomadas e 16 sem resposta virava "100%", que o médico lê como "tomou tudo".
check('45 tomadas + 16 sem resposta NÃO é 100%',
  textoAdesao({ tomou: 45, naoTomou: 0, semResposta: 16, total: 61 }), '74–100%');
// Dividir pelo TOTAL mentiria PARA BAIXO — assumiria que nenhuma sem-resposta foi tomada.
// A faixa não escolhe nenhuma das duas mentiras.
check('o piso supõe que NENHUMA sem-resposta foi tomada',
  faixaAdesao({ tomou: 45, naoTomou: 0, semResposta: 16, total: 61 }).piso, 74);
check('o teto supõe que TODAS foram',
  faixaAdesao({ tomou: 45, naoTomou: 0, semResposta: 16, total: 61 }).teto, 100);

check('sem nenhuma dúvida, é um número só', textoAdesao({ tomou: 28, naoTomou: 0, semResposta: 0, total: 28 }), '100%');
check('tudo respondido, com faltas', textoAdesao({ tomou: 24, naoTomou: 4, semResposta: 0, total: 28 }), '86%');

// A LARGURA da faixa É a mensagem: 7–100% diz "não dá para afirmar nada". Um "100%" ali
// mandaria o médico procurar outra causa para o INR desregulado da varfarina.
const varfarina = { tomou: 4, naoTomou: 0, semResposta: 57, total: 61 };
check('varfarina com 57 sem resposta → faixa larguíssima', textoAdesao(varfarina), '7–100%');
check('…e o piso NÃO é 100%', faixaAdesao(varfarina).piso, 7);
check('faixa larga é reconhecível (>15 pontos)',
  faixaAdesao(varfarina).teto - faixaAdesao(varfarina).piso > 15, true);
check('nada registrado → null, sem inventar', faixaAdesao({ tomou: 0, naoTomou: 0, semResposta: 0, total: 0 }), null);

console.log('\n  HISTÓRICO INTEIRO É O PADRÃO\n');
{
  const log = [linha('Antigo', diasAtras(900), 'tomou'), linha('Novo', diasAtras(2), 'tomou')];
  const tudo = montarRelatorio(log, null, HOJE);
  check('sem período, entra o remédio de 900 dias atrás', tudo.medicamentos.length, 2);
  check('dias = null sinaliza histórico completo', tudo.dias, null);
  // "desde 01/01/1970" no papel seria absurdo — o início real é a primeira dose que existe.
  check('"desde" é a primeira dose real, não a época zero',
    tudo.desde.slice(0, 10), diasAtras(900).slice(0, 10));
  check('com período explícito, o antigo fica fora',
    montarRelatorio(log, 180, HOJE).medicamentos.length, 1);
}

console.log('\n  AGRUPAMENTO\n');
{
  const log = [
    linha('Enalapril', diasAtras(3), 'tomou'),
    { ...linha('Enalapril', diasAtras(2), 'tomou'), medication_id: 99 },  // recadastrado
    linha('Sinvastatina', diasAtras(1), 'tomou'),
    linha('Sinvastatina', diasAtras(2), 'tomou'),
    linha('Sinvastatina', diasAtras(3), 'tomou'),
  ];
  const r = montarRelatorio(log, 180, HOJE);
  check('agrupa por NOME (id muda ao recadastrar)',
    r.medicamentos.find(m => m.nome === 'Enalapril').total, 2);
  check('quem tem mais doses vem primeiro', r.medicamentos[0].nome, 'Sinvastatina');
  check('log vazio não estoura', montarRelatorio([], 180, HOJE).medicamentos.length, 0);
}

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. O relatório do médico está errado — e quem lê\n    esse papel PRESCREVE a partir dele.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. Os três estados chegam inteiros ao papel.\n');
