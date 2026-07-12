// Testa a verificação de assinatura REAL (src/services/dataSignature.ts) contra ataques.
//
// O cenário que motiva tudo isto: as checagens de schema e de quantidade do dbSync barram o
// ESVAZIAMENTO da base, mas não barram a INJEÇÃO. Um atacante com push no `main` podia
// ACRESCENTAR um alerta crítico falso e fazer o paciente parar um remédio de que precisa.
// Este teste prova que a assinatura barra exatamente isso.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const ed = require('@noble/ed25519');

const ROOT = path.join(__dirname, '..');

// Carrega o verificador REAL, transpilando o TS — não uma reimplementação que poderia divergir.
const src = fs.readFileSync(path.join(ROOT, 'src/services/dataSignature.ts'), 'utf8')
  .replace("import * as ed from '@noble/ed25519';", "const ed = require('@noble/ed25519');");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const { verifyDataSignature } = mod.exports;

const jsonPath = path.join(ROOT, 'src/data/interactions.json');
const sigPath = path.join(ROOT, 'src/data/interactions.json.sig');
const raw = fs.readFileSync(jsonPath, 'utf8');
const sig = fs.readFileSync(sigPath, 'utf8').trim();

(async () => {
  let falhas = 0;
  const check = async (nome, texto, assinatura, esperado) => {
    const ok = await verifyDataSignature(texto, assinatura);
    const passou = ok === esperado;
    if (!passou) falhas++;
    console.log(`  ${passou ? '✓' : '✗ FALHOU'}  ${nome.padEnd(52)} → ${ok ? 'ACEITO' : 'rejeitado'}`);
  };

  await check('LEGÍTIMO: dados e assinatura reais', raw, sig, true);

  // ── O ataque que as outras defesas NÃO pegavam ──────────────────────────────
  const dados = JSON.parse(raw);
  const injetado = JSON.stringify([...dados, {
    id: 'int_9999',
    drug1: 'Losartana',
    drug2: 'Paracetamol',
    risk_level: 'critical',
    risk_description: 'Risco de morte súbita — suspenda imediatamente',
    mechanism: 'Alerta FALSO injetado por um atacante.',
  }], null, 2);
  await check('ATAQUE: injeta alerta crítico FALSO (lote cresce,', injetado, sig, false);
  console.log('           schema válido — passaria nas outras checagens)');

  // ── Outras adulterações ────────────────────────────────────────────────────
  await check('ATAQUE: troca a severidade de UMA entrada',
    raw.replace('"risk_level": "critical"', '"risk_level": "moderate"'), sig, false);
  await check('ATAQUE: apaga a base e assina com a sig antiga', '[]', sig, false);
  await check('ATAQUE: assinatura de outro arquivo (meds-db)', raw,
    fs.readFileSync(path.join(ROOT, 'src/data/medications-db.json.sig'), 'utf8').trim(), false);
  await check('ATAQUE: assinatura vazia', raw, '', false);
  await check('ATAQUE: assinatura lixo', raw, 'deadbeef'.repeat(16), false);
  await check('ATAQUE: assinatura não-hex', raw, 'z'.repeat(128), false);

  // Assinado com OUTRA chave (atacante gera o próprio par e assina os dados dele)
  const privInimiga = ed.utils.randomSecretKey();
  const sigInimiga = Buffer.from(
    await ed.signAsync(new TextEncoder().encode(injetado), privInimiga)).toString('hex');
  await check('ATAQUE: atacante assina com a PRÓPRIA chave', injetado, sigInimiga, false);

  // Um byte a mais no fim invalida (prova que assina os bytes crus, não o objeto)
  await check('ATAQUE: um espaço a mais no fim do arquivo', raw + ' ', sig, false);

  console.log('');
  console.log(falhas === 0
    ? '  ✓ Todos os cenários passaram. Só quem tem a chave privada consegue publicar dados.'
    : `  ✗ ${falhas} FALHA(S) — a assinatura está furada.`);
  process.exit(falhas === 0 ? 0 : 1);
})();
