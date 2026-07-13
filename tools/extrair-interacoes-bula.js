#!/usr/bin/env node
/**
 * Extrai a seção de INTERAÇÕES de cada bula publicada em site/bulas e gera
 * src/data/bula-interacoes.json  ({ slug: "texto da bula" }).
 *
 * POR QUE ISTO EXISTE
 * Hoje o app AFIRMA gravidade e mecanismo para 2766 pares — e 31% deles não têm procedência
 * (ver tools/marcar-procedencia.js). Afirmar sem lastro é a nossa maior exposição.
 *
 * A bula resolve isso melhor que qualquer alternativa que testamos:
 *   · é OFICIAL (ANVISA) — o app deixa de AFIRMAR e passa a CITAR o rótulo aprovado;
 *   · é em PORTUGUÊS (o drugs.com não é, e ainda bloqueia o Claude no robots.txt);
 *   · é NOSSA — já hospedamos 993 PDFs, então nada vaza para terceiros. Mandar o usuário
 *     buscar no Google entregaria a medicação dele na URL da busca: num app de saúde isso
 *     é uma regressão de privacidade, além de não funcionar offline;
 *   · CABE: 0,55 MB comprimido, contra 1,1 MB que o interactions.json já sincroniza.
 *
 * E a bula brasileira é mais completa que o drugs.com em pelo menos um caso que nos mordeu:
 * o índice do potassium chloride NÃO lista heparina, ciclosporina nem tacrolimo — a bula do
 * cloreto de potássio lista os três, nominalmente.
 *
 * DUAS FORMAS de a bula falar de interação, e é preciso pegar as duas:
 *   1. cabeçalho explícito ("INTERAÇÕES MEDICAMENTOSAS", "Interação medicamento-medicamento");
 *   2. a fórmula padrão da RDC 47/09 na seção 4, que NUNCA usa a palavra "interação":
 *      "É muito importante informar ao seu médico caso esteja usando outros medicamentos…"
 *      A bula da espironolactona é assim — e é justamente ela que diz, com todas as letras,
 *      que a hiperpotassemia com IECA "pode ser fatal". Procurar só o cabeçalho a perderia.
 *
 * USO: node tools/extrair-interacoes-bula.js [--seco]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BULAS = path.join(ROOT, 'site/bulas');
const SAIDA = path.join(ROOT, 'src/data/bula-interacoes.json');
const SECO = process.argv.includes('--seco');

const CABECALHO = /(intera[çc][õo]es?\s+medicamentosas?|intera[çc][ãa]o\s+medicamento\s*-\s*medicamento|intera[çc][õo]es?\s+com\s+(outros\s+)?medicamentos|intera[çc][õo]es?\s+f[áa]rmaco)/i;
const FORMULA_RDC = /informar\s+ao\s+seu\s+m[ée]dico\s+(se|caso)[^.]{0,60}(outros\s+)?medicamentos/i;

// Fim da seção: próxima seção numerada, ou um cabeçalho conhecido da bula
const FIM = /^\s*\d{1,2}\s*[.)]\s*[A-ZÀ-Ú]{4,}|^\s*(ONDE,?\s+COMO|COMO\s+DEVO\s+USAR|QUAIS\s+OS\s+MALES|O\s+QUE\s+DEVO\s+FAZER|CUIDADOS\s+DE\s+ARMAZENAMENTO|REA[ÇC][ÕO]ES\s+ADVERSAS|POSOLOGIA|SUPERDOSE|DIZERES\s+LEGAIS|ADVERT[ÊE]NCIAS)/i;

const MIN_UTIL = 120;   // abaixo disso é cabeçalho solto, não conteúdo
const MAX_LINHAS = 60;

function extrair(pdf) {
  // -enc UTF-8 não é opcional: sem ele os acentos viram lixo e o regex não casa nada
  const r = spawnSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 || !r.stdout) return null;
  const linhas = r.stdout.split('\n');

  let i = linhas.findIndex(l => CABECALHO.test(l));
  if (i < 0) i = linhas.findIndex(l => FORMULA_RDC.test(l));
  if (i < 0) return null;

  const buf = [];
  for (let k = i; k < linhas.length && buf.length < MAX_LINHAS; k++) {
    if (k > i && FIM.test(linhas[k])) break;
    buf.push(linhas[k]);
  }
  const texto = buf.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return texto.length >= MIN_UTIL ? texto : null;
}

const pdfs = fs.readdirSync(BULAS).filter(f => f.endsWith('.pdf')).sort();
const out = {};
let porCabecalho = 0, porFormula = 0;

for (const f of pdfs) {
  const texto = extrair(path.join(BULAS, f));
  if (!texto) continue;
  out[f.slice(0, -4)] = texto;
  if (CABECALHO.test(texto.split('\n')[0])) porCabecalho++; else porFormula++;
}

const json = JSON.stringify(out);
const gz = require('zlib').gzipSync(json);
const n = Object.keys(out).length;

console.log(`${pdfs.length} bulas publicadas`);
console.log(`  com seção de interações: ${n}  (${Math.round((100 * n) / pdfs.length)}%)`);
console.log(`     por cabeçalho explícito: ${porCabecalho}`);
console.log(`     pela fórmula da RDC 47/09: ${porFormula}   ← estas o cabeçalho sozinho perderia`);
console.log(`  payload: ${(json.length / 1024 / 1024).toFixed(2)} MB  |  gzip: ${(gz.length / 1024 / 1024).toFixed(2)} MB`);

if (SECO) { console.log('\n[SECO] nada gravado'); process.exit(0); }
fs.writeFileSync(SAIDA, json + '\n');
console.log(`\n✓ ${path.relative(ROOT, SAIDA)}`);
