#!/usr/bin/env node
/**
 * Classifica cada bula publicada em GENÉRICO / SIMILAR / MARCA.
 *
 * POR QUE ISTO IMPORTA
 * O app indexa a bula pelo PRINCÍPIO ATIVO, mas mais da metade do acervo é bula de MARCA.
 * Quem digita "acarbose" recebe AGLUCOSE® da EMS; quem digita "abacavir" recebe Ziagenavir®
 * da GSK. O app INTRODUZ uma marca que o usuário não tem — e agora ele precisa conferir se
 * é a dele, se o sal bate, se a dose bate. Isso é pior que não mostrar nada: cria dúvida
 * onde não havia.
 *
 * Observação do Fabio, e é decisiva: "eu tomo maleato de enalapril; se abrir a bula e
 * aparecer Renitec ou Vasopril, tenho que verificar se o sal é o mesmo. Na farmácia podem
 * ter me vendido o Renitec, mas eu vou cadastrar maleato de enalapril e pode aparecer
 * Vasopril."
 *
 * A bula do GENÉRICO é a referência neutra — é o que quem digita o princípio ativo espera.
 *
 * QUANDO A MARCA É CERTA: biológico e fármaco novo sob patente não TÊM genérico (Orencia,
 * Verzenios, Zytiga). Aí a marca É o produto, e a bula de marca não é erro — é a única.
 *
 * A leitura vai fundo no PDF, não só no cabeçalho: "Medicamento genérico, Lei nº 9.787"
 * costuma vir ABAIXO das 3 primeiras linhas, e classificar pelo cabeçalho curto chamava de
 * "indefinido" 379 bulas que provavelmente já estão certas.
 *
 * USO: node tools/classificar-bulas.js [--csv]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BULAS = path.join(ROOT, 'site/bulas');
const CSV = process.argv.includes('--csv');

const GENERICO = /medicamento\s+gen[eé]rico|lei\s*n?[º°.]?\s*9[.\s]?787/i;
const SIMILAR = /medicamento\s+similar/i;
const REFERENCIA = /medicamento\s+de\s+refer[eê]ncia|medicamento\s+novo/i;

function ler(pdf) {
  const r = spawnSync('pdftotext', ['-enc', 'UTF-8', '-f', '1', '-l', '2', pdf, '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  return r.status === 0 ? (r.stdout || '') : '';
}

const pdfs = fs.readdirSync(BULAS).filter(f => f.endsWith('.pdf')).sort();
const grupos = { generico: [], similar: [], referencia: [], marca: [], semTexto: [] };

for (const f of pdfs) {
  const slug = f.slice(0, -4);
  const txt = ler(path.join(BULAS, f));
  if (txt.trim().length < 200) { grupos.semTexto.push([slug, '']); continue; }

  const ident = txt.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  const cabeca = txt.slice(0, 2500);   // as 2 primeiras páginas cobrem a IDENTIFICAÇÃO DO MEDICAMENTO

  if (GENERICO.test(cabeca)) grupos.generico.push([slug, ident]);
  else if (SIMILAR.test(cabeca)) grupos.similar.push([slug, ident]);
  else if (REFERENCIA.test(cabeca)) grupos.referencia.push([slug, ident]);
  else grupos.marca.push([slug, ident]);
}

const n = pdfs.length;
const pc = k => `${grupos[k].length} (${Math.round(100 * grupos[k].length / n)}%)`;

console.log(`${n} bulas publicadas\n`);
console.log(`  GENÉRICO    ${pc('generico')}   ← o que o app DEVERIA mostrar por padrão`);
console.log(`  SIMILAR     ${pc('similar')}`);
console.log(`  REFERÊNCIA  ${pc('referencia')}   ← medicamento novo: pode não ter genérico`);
console.log(`  MARCA       ${pc('marca')}   ← candidatos a trocar pelo genérico`);
console.log(`  sem texto   ${pc('semTexto')}`);

if (CSV) {
  const linhas = ['tipo,slug,cabecalho'];
  for (const [tipo, lista] of Object.entries(grupos))
    for (const [slug, ident] of lista) linhas.push(`${tipo},${slug},"${ident.replace(/"/g, "'")}"`);
  const saida = path.join(ROOT, 'docs/auditoria/bulas-por-tipo.csv');
  fs.writeFileSync(saida, linhas.join('\n') + '\n');
  console.log(`\n✓ ${path.relative(ROOT, saida)}`);
} else {
  console.log('\nAmostra das de MARCA:');
  for (const [slug, ident] of grupos.marca.slice(0, 12)) console.log(`   ${slug.padEnd(26)} ${ident}`);
  console.log('\n  (--csv grava a lista completa em docs/auditoria/bulas-por-tipo.csv)');
}
