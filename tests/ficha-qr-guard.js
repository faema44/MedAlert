// Testa a ficha de emergência em QR (src/utils/fichaQr.ts).
//
// Quem lê é um SOCORRISTA nos primeiros minutos. O modo de falha não é tela feia:
//
//   alergia cortada por falta de espaço → ele aplica o que a pessoa não tolera
//   lista cortada SEM AVISO             → ele decide como se a lista fosse completa
//
// Por isso o gate trava a ORDEM de prioridade e o aviso de corte, não só o tamanho.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/utils/fichaQr.ts'), 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { montarTextoQr, cabeNoQr } = mod.exports;

for (const [nome, fn] of [['montarTextoQr', montarTextoQr], ['cabeNoQr', cabeNoQr]]) {
  if (typeof fn !== 'function') {
    console.log(`  ✗ FALHOU  fichaQr.ts não exporta ${nome} — o gate não testa nada.`);
    process.exit(1);
  }
}

let falhas = 0;
function check(nome, real, esperado) {
  const ok = real === esperado;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✓' : '✗ FALHOU'}  ${nome.padEnd(58)}${ok ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`);
}

const PERFIL = { name: 'Maria Souza', birth_date: '1948-03-12', blood_type: 'O+', allergies: 'Penicilina, Dipirona' };
const med = (nome, dose, crit = false) => ({ commercial_name: nome, generic_name: nome, dose, is_critical: crit, suspended: 0 });
const CONTATO = [{ name: 'João', phone: '11999998888', is_primary: true }];

console.log('\n  O ESSENCIAL ESTÁ LÁ\n');
{
  const t = montarTextoQr(PERFIL, [med('Enalapril', '10 mg')], CONTATO);
  check('nome, idade e sangue na 1ª linha', t.split('\n')[0], 'Maria Souza · 78a · Sangue O+');
  check('ALERGIA vem antes de tudo', t.split('\n')[1].startsWith('ALERGIA:'), true);
  check('alergia com o conteúdo real', t.includes('Penicilina, Dipirona'), true);
  check('contato de emergência entra', t.includes('CONTATO: João 11999998888'), true);
  check('medicamento entra com a dose', t.includes('Enalapril 10 mg'), true);
}

// Sem alergia declarada, o silêncio seria ambíguo: "não tem" ou "ninguém preencheu"?
// O socorrista precisa saber que a ausência foi informada, não presumida.
{
  const t = montarTextoQr({ ...PERFIL, allergies: '' }, [], []);
  check('sem alergia informada, DIZ que não foi informada', t.includes('ALERGIA: nenhuma informada'), true);
}

console.log('\n  PRIORIDADE CLÍNICA NO CORTE\n');
{
  // 60 remédios não cabem. O que fica é o que muda conduta.
  const muitos = [];
  for (let i = 1; i <= 60; i++) muitos.push(med(`Medicamento${i}`, '10 mg'));
  muitos.push(med('Varfarina', '5 mg', true));   // crítico, entra por último na lista
  const t = montarTextoQr(PERFIL, muitos, CONTATO);
  check('cabe no QR mesmo com 61 remédios', cabeNoQr(t), true);
  check('ALERGIA sobrevive ao corte', t.includes('Penicilina, Dipirona'), true);
  check('CONTATO sobrevive ao corte', t.includes('CONTATO:'), true);
  // O crítico é ordenado na frente: é ele que explica o quadro e não pode ser suspenso às cegas.
  check('o CRÍTICO entra, mesmo cadastrado por último', t.includes('! Varfarina 5 mg'), true);
  // Cortar calado é pior que cortar: ele decidiria como se a lista fosse completa.
  check('avisa que a lista está incompleta', /\+\d+ outros? — ver no celular/.test(t), true);
}

{
  // Alergia gigante não pode empurrar tudo para fora do limite legível.
  const t = montarTextoQr({ ...PERFIL, allergies: 'x'.repeat(600) }, [med('A', '1'), med('B', '2')], CONTATO);
  check('alergia enorme ainda cabe no QR', cabeNoQr(t), true);
}

console.log('\n  O QUE NÃO ENTRA\n');
{
  const t = montarTextoQr(PERFIL, [med('Ativo', '1 mg'), { ...med('Suspenso', '2 mg'), suspended: 1 }], CONTATO);
  check('medicamento em stand-by fica fora', t.includes('Suspenso'), false);
  check('…e o ativo continua', t.includes('Ativo 1 mg'), true);
  // Cada caractere gasto com enfeite é um remédio a menos que cabe.
  check('sem nome de app nem cabeçalho decorativo', /alerta m[ée]dico/i.test(t), false);
  check('é TEXTO, não link (funciona sem internet)', /https?:\/\//.test(t), false);
}

{
  const t = montarTextoQr(null, [], []);
  check('perfil vazio não estoura', typeof t === 'string', true);
  check('…e ainda declara a alergia como não informada', t.includes('ALERGIA:'), true);
}

console.log('');
if (falhas) {
  console.log(`  ✗ ${falhas} cenário(s) falharam. A ficha do QR está errada — quem lê esse código\n    decide conduta com ela nos primeiros minutos.\n`);
  process.exit(1);
}
console.log('  ✓ Todos os cenários passaram. Alergia nunca cai, e corte nunca é silencioso.\n');
