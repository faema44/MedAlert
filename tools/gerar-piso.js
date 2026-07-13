#!/usr/bin/env node
/**
 * Gera src/data/interactions-floor.json — a lista de IDs que vai EMBARCADA no APK.
 *
 * POR QUE ISTO EXISTE
 * O interactions.json (980 KB) era embarcado no app, e não só por comodidade: ele é o PISO
 * do guard do dbSync. A base é baixada de um repositório PÚBLICO em runtime, e sem piso um
 * payload com 1 entrada zeraria os alertas de TODO aparelho instalado, sem update e sem
 * passar pela revisão da Play Store. O paciente pararia de receber alertas reais e não teria
 * como saber.
 *
 * Mas 980 KB no celular para um usuário que toma 8 remédios é peso morto: as interações DELE
 * cabem em 2 KB. O resto nunca é usado.
 *
 * A lista de IDs preserva o piso por 1/34 do tamanho (29 KB) — e o guard fica MAIS FORTE, não
 * mais fraco: em vez de comparar só a QUANTIDADE ("o remoto tem pelo menos tantas entradas"),
 * passa a exigir que TODOS os IDs revisados pela loja estejam presentes. Antes, trocar 2.768
 * entradas por outras 2.768 passava; agora não passa.
 *
 * O piso NÃO precisa de assinatura: ele viaja dentro do APK, e o que o protege é a revisão da
 * Play Store — um atacante que só tenha o GitHub não consegue alterá-lo nos aparelhos.
 *
 * USO: node tools/gerar-piso.js [--conferir]
 *      --conferir  falha (exit 1) se o piso estiver dessincronizado do interactions.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FONTE = path.join(ROOT, 'src/data/interactions.json');
const PISO = path.join(ROOT, 'src/data/interactions-floor.json');
const CONFERIR = process.argv.includes('--conferir');

const inter = JSON.parse(fs.readFileSync(FONTE, 'utf8'));
const ids = inter.map(i => i.id).sort();

if (CONFERIR) {
  let atual;
  try { atual = JSON.parse(fs.readFileSync(PISO, 'utf8')); } catch { atual = null; }
  const igual = atual && Array.isArray(atual.ids)
    && atual.ids.length === ids.length
    && atual.ids.every((id, k) => id === ids[k]);
  if (igual) {
    console.log(`✓ piso em dia — ${ids.length} IDs`);
    process.exit(0);
  }
  console.error('❌ interactions-floor.json está DESSINCRONIZADO do interactions.json.');
  console.error(`   piso: ${atual?.ids?.length ?? 0} IDs · base: ${ids.length} IDs`);
  console.error('   Rode: node tools/gerar-piso.js');
  console.error('\n   Isto não é burocracia: o piso é o que impede um payload adulterado de');
  console.error('   APAGAR alertas de todos os celulares. Piso velho = alertas novos sem proteção.');
  process.exit(1);
}

fs.writeFileSync(PISO, JSON.stringify({ ids }) + '\n');
const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log(`✓ src/data/interactions-floor.json — ${ids.length} IDs`);
console.log(`  ${kb(fs.statSync(PISO).size)}  (o interactions.json inteiro tem ${kb(fs.statSync(FONTE).size)})`);
