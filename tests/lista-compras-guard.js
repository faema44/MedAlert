// Testa a lista de compras (src/utils/listaCompras.ts).
//
// O que distingue esta tela: ela produz um PAPEL que SAI do app, com nomes e doses, e vai para a
// mão de terceiros — balconista, filho, médico. Dois modos de falha que nenhuma outra tela tem:
//
//   1. Sair sem o aviso de que NÃO é receita. Uma folha com data, logo e lista de medicamentos é
//      lida como prescrição no balcão da farmácia.
//   2. Chutar uma quantidade que a pessoa não pediu. Número inventado num papel que vai à
//      farmácia é pior que campo em branco.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/utils/listaCompras.ts'), 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const {
  ordenarParaCompra, precisaRepor, sugestaoQuantidade, montarTextoLista,
  DIAS_PARA_REPOR, DIAS_SUGERIDOS, AVISO_NAO_E_RECEITA,
} = mod.exports;

if (typeof montarTextoLista !== 'function') {
  console.log('  ✗ FALHOU  listaCompras.ts não exporta montarTextoLista — o gate não testa nada.');
  process.exit(1);
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(58)}${ok ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`);
}

let seq = 0;
const item = (nome, extra = {}) => ({
  id: ++seq, nome, dose: '10 mg', estoque: 30, diasRestantes: null,
  dosesPorDia: 1, suspenso: false, ...extra,
});

console.log('\n  QUEM PRECISA SER COMPRADO VEM PRIMEIRO\n');
{
  const d = ordenarParaCompra([
    item('Zolpidem', { diasRestantes: 90 }),
    item('Acabando', { diasRestantes: 2 }),
    item('Amoxicilina', { diasRestantes: 60 }),
    item('QuaseAcabando', { diasRestantes: 6 }),
  ]);
  check('acabando primeiro, e o que acaba antes na frente',
    d.slice(0, 2).map(i => i.nome), ['Acabando', 'QuaseAcabando']);
  check('o resto em ordem alfabética',
    d.slice(2).map(i => i.nome), ['Amoxicilina', 'Zolpidem']);
}
{
  // Pausado continua na lista — sumir com ele sem dizer nada decidiria pela pessoa —, mas não
  // disputa espaço com o que está acabando de verdade.
  const d = ordenarParaCompra([
    item('Pausado', { diasRestantes: 1, suspenso: true }),
    item('Ativo', { diasRestantes: 5 }),
  ]);
  check('pausado fica por último mesmo acabando antes', d.map(i => i.nome), ['Ativo', 'Pausado']);
  check('…e não vem pré-marcado', precisaRepor(d[1]), false);
}

console.log('\n  O QUE VEM MARCADO\n');
{
  check('acaba dentro da janela → marcado',
    precisaRepor(item('X', { diasRestantes: DIAS_PARA_REPOR })), true);
  check('acaba um dia depois → não marcado',
    precisaRepor(item('X', { diasRestantes: DIAS_PARA_REPOR + 1 })), false);
  // Sem controle de estoque não há como saber se está acabando. Marcar seria afirmar algo que
  // o app não sabe, e a pessoa levaria à farmácia um remédio que tem de sobra.
  check('sem controle de estoque → não marcado',
    precisaRepor(item('X', { estoque: null, diasRestantes: null })), false);
}

console.log('\n  A SUGESTÃO NÃO PODE SER CHUTE\n');
{
  check('cobre o período sugerido', sugestaoQuantidade(item('X', { dosesPorDia: 2 })), 2 * DIAS_SUGERIDOS);
  check('arredonda para cima (meia dose não se compra)',
    sugestaoQuantidade(item('X', { dosesPorDia: 0.5 })), Math.ceil(0.5 * DIAS_SUGERIDOS));
  // Sem lembrete não há doses por dia: o campo tem de ficar VAZIO, não com um número inventado.
  check('sem lembrete → sem sugestão', sugestaoQuantidade(item('X', { dosesPorDia: 0 })), null);
}

console.log('\n  O TEXTO QUE SAI DO APP\n');
{
  const txt = montarTextoLista([
    { nome: 'Losartana', dose: '50 mg', quantidade: 60, estoque: 8 },
    { nome: 'Metformina', dose: '850 mg', quantidade: 30, estoque: null },
    { nome: 'Vitamina D', dose: '', quantidade: null, estoque: null },
  ], new Date(2026, 6, 19));

  check('leva a data', txt.includes('19/07/2026'), true);
  check('uma linha por remédio, com dose', txt.includes('• Losartana 50 mg — comprar 60, tenho 8'), true);
  check('sem saldo não inventa saldo', txt.includes('• Metformina 850 mg — comprar 30\n'), true);
  check('sem quantidade não inventa quantidade', txt.includes('• Vitamina D\n'), true);
  // O WhatsApp não alinha coluna nenhuma: o que aqui pareceria tabela chega lá como papa.
  check('não tenta desenhar tabela', /\|/.test(txt), false);

  // O aviso não é enfeite: é o que impede a folha de ser lida como receita no balcão.
  check('diz que NÃO é receita', txt.includes(AVISO_NAO_E_RECEITA), true);
  check('…e a frase realmente contém a palavra', /não é receita/i.test(AVISO_NAO_E_RECEITA), true);
}

console.log('\n  O PDF CARREGA O MESMO AVISO\n');
{
  // O PDF é o formato que mais PARECE documento oficial — é justamente nele que o aviso não
  // pode faltar.
  //
  // Este bloco já nasceu errado uma vez, e vale registrar: ele procurava "AVISO_NAO_E_RECEITA"
  // no TEXTO-FONTE do arquivo. Apagar o aviso do HTML não derrubava o teste, porque o nome
  // continuava lá na linha de import — e a checagem de ordem comparava um indexOf que virava
  // -1, sempre menor que qualquer posição. Dois testes decorativos que passavam sabotados.
  // Agora o HTML é RENDERIZADO e a asserção é sobre o que sai.
  const pdfSrc = fs.readFileSync(path.join(ROOT, 'src/services/listaComprasPdf.ts'), 'utf8')
    .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
  const pdfJs = ts.transpileModule(pdfSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const pm = { exports: {} };
  // Só montarHtmlLista é exercitado; Print/Sharing não são tocados por ele.
  new Function('module', 'exports', 'require', 'AVISO_NAO_E_RECEITA', pdfJs)(
    pm, pm.exports, require, AVISO_NAO_E_RECEITA);

  const html = pm.exports.montarHtmlLista(
    [{ nome: 'Clonazepam', dose: '2 mg', quantidade: 30, estoque: 4 }],
    'Maria', new Date(2026, 6, 19));

  check('o aviso sai escrito no HTML', html.includes(AVISO_NAO_E_RECEITA), true);
  // Antes da tabela: depois dela a lista já foi lida como prescrição.
  check('e ele vem ANTES da tabela',
    html.indexOf(AVISO_NAO_E_RECEITA) < html.indexOf('<table>'), true);
  check('o remédio e a quantidade chegam na tabela',
    html.includes('Clonazepam') && html.includes('>30<'), true);
  check('o saldo digitado aparece', html.includes('>4<'), true);
}

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. A lista sai do app e vai para a mão de outra\n    pessoa — o que estiver errado aqui não tem nenhuma tela para corrigir depois.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. A lista sai marcada como lembrete, não como receita.\n');
