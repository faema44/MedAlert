// Confere se a FORMA declarada no nome do arquivo é a forma que o PDF realmente descreve.
//
// Por que isto não estava coberto: o `audit-bulas.js` verifica QUAL FÁRMACO a bula é (os
// princípios ativos citados na identificação) e se dois slugs servem o mesmo arquivo. Nenhuma
// das duas coisas enxerga forma. E forma não existe no nome do fármaco — ela só existe DENTRO
// do PDF. Foi assim que `dexametasona` serviu o creme para quem toma comprimido: o arquivo era
// da dexametasona, os ativos batiam, o gate aprovava.
//
// Com o seletor de forma (65 slugs, 155 arquivos), o estrago mudou de tamanho: agora o app
// PROMETE uma forma específica na tela. Se o arquivo por trás do botão "Gotas" for o injetável,
// o app está afirmando algo que ele mesmo não conferiu.
//
// Uso:  node tools/audit-bula-forma.js [--gate]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BULAS_DIR = path.join(ROOT, 'site', 'bulas');
const TXT_DIR = path.join(os.tmpdir(), 'medalert-bulas-txt');
const GATE = process.argv.includes('--gate');

// Como a forma se anuncia dentro da bula. `precisa` = o que TEM de aparecer no bloco de
// identificação/apresentação. `conflita` = formas que, se aparecerem SOZINHAS (sem a
// esperada), indicam que o arquivo é de outra apresentação.
//
// Os padrões são propositalmente frouxos: uma bula de comprimido revestido diz "comprimido
// revestido", uma de gotas diz "solução oral" e "gotas". Falso negativo aqui é pior que ruído.
const FORMAS = {
  comprimido:  /comprimid|drágea|dragea/i,
  capsula:     /c[áa]psula/i,
  gotas:       /gotas/i,
  xarope:      /xarope/i,
  'solucao-oral': /solu[çc][ãa]o oral/i,
  elixir:      /elixir/i,
  suspensao:   /suspens[ãa]o/i,
  po:          /\bp[óo]\b|liofilizad/i,
  granulado:   /granulad/i,
  creme:       /creme/i,
  pomada:      /pomada/i,
  gel:         /\bgel\b/i,
  locao:       /lo[çc][ãa]o/i,
  ocular:      /col[íi]rio|oft[áa]lmic/i,
  spray:       /spray|aeross|inalat|nasal/i,
  injetavel:   /injet[áa]vel|inje[çc][ãa]o|intravenos|intramuscul|amp[oô]la|via\s+ev\b/i,
  supositorio: /supositório|supositorio|retal/i,
  adesivo:     /adesivo|transd[ée]rmic/i,
};

function textoDe(base) {
  const txt = path.join(TXT_DIR, `${base}.txt`);
  if (!fs.existsSync(txt)) {
    const src = path.join(BULAS_DIR, `${base}.pdf`);
    fs.mkdirSync(TXT_DIR, { recursive: true });
    const r = spawnSync('pdftotext', ['-enc', 'UTF-8', '-f', '1', '-l', '6', src, txt]);
    if (r.error) { console.error('pdftotext não encontrado (poppler).'); process.exit(2); }
  }
  try { return fs.readFileSync(txt, 'utf8'); } catch { return null; }
}

const arquivos = fs.readdirSync(BULAS_DIR).filter(f => f.endsWith('.pdf'));
// Do mais LONGO para o mais curto: senão "solucao-oral" nunca seria reconhecido, porque um
// sufixo mais curto casaria antes e o arquivo seria julgado contra a forma errada.
const sufixos = Object.keys(FORMAS).sort((a, b) => b.length - a.length);
const comForma = arquivos.filter(f => sufixos.some(s => f.endsWith(`-${s}.pdf`)));

const semTexto = [];
const naoConfirma = [];   // a forma prometida NÃO aparece no PDF
const outraDomina = [];   // outra forma aparece e a prometida não

for (const arq of comForma) {
  const base = arq.slice(0, -4);
  const forma = sufixos.find(s => base.endsWith(`-${s}`));
  const txt = textoDe(base);
  if (txt == null || txt.trim().length < 200) { semTexto.push(`${arq} (texto vazio — PDF escaneado?)`); continue; }

  // Só o começo: identificação + "FORMA FARMACÊUTICA E APRESENTAÇÕES". Mais adiante a bula
  // cita outras apresentações do mesmo produto e qualquer regex casaria com tudo.
  const cabeca = txt.split('\n').slice(0, 60).join('\n');

  if (FORMAS[forma].test(cabeca)) continue;

  const achadas = sufixos.filter(s => s !== forma && FORMAS[s].test(cabeca));
  // Ainda dá uma última chance no PDF inteiro antes de acusar: algumas bulas põem a
  // apresentação depois de uma capa longa.
  if (FORMAS[forma].test(txt)) continue;

  (achadas.length ? outraDomina : naoConfirma).push(
    `${arq}  → prometida "${forma}"` + (achadas.length ? `, mas o PDF fala de: ${achadas.join(', ')}` : ' — nenhuma forma reconhecida'));
}

console.log(`\n  ${comForma.length} bulas com forma no nome (de ${arquivos.length} PDFs)\n`);

const bloco = (titulo, lista) => {
  if (!lista.length) { console.log(`  ✓ ${titulo}: nenhum`); return; }
  console.log(`\n  ✗ ${titulo}: ${lista.length}`);
  for (const l of lista) console.log(`      ${l}`);
};

bloco('forma prometida NÃO confirmada pelo PDF', naoConfirma);
bloco('PDF descreve OUTRA forma', outraDomina);
bloco('sem texto extraível', semTexto);

const problemas = naoConfirma.length + outraDomina.length;
console.log('');
if (problemas === 0) {
  console.log('  ✓ Toda bula com forma no nome se confirma no conteúdo do PDF.\n');
} else {
  console.log(`  ${problemas} bula(s) em que o botão da tela promete uma forma que o PDF não confirma.\n`);
}
if (GATE && problemas) process.exit(1);
