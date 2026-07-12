#!/usr/bin/env node
/**
 * Assina a base médica (interactions.json + medications-db.json) com Ed25519.
 *
 * POR QUÊ: o app baixa esses JSONs do repositório PÚBLICO em runtime e os usa para gerar
 * alertas médicos. Sem assinatura, quem conseguisse dar push no `main` — conta comprometida,
 * PR malicioso, workflow do Actions sequestrado — podia INJETAR um alerta crítico falso e
 * fazer o paciente parar um remédio de que precisa. As checagens de schema e de quantidade
 * (ver dbSync.ts) barram o esvaziamento, mas NÃO barram a injeção. A assinatura barra.
 *
 * A chave PRIVADA nunca entra no repositório. Ela vive fora do projeto, no mesmo lugar das
 * credenciais de assinatura do app:
 *
 *   ~/.gradle/gradle.properties  →  MEDALERT_DATA_SIGNING_KEY=<hex de 64 chars>
 *
 * (o gradle.properties já está fora do repo e é copiado para o pendrive junto com a keystore)
 *
 * A chave PÚBLICA vai embarcada no app (src/services/dataSignature.ts) — ela é pública por
 * definição, não é segredo. Como o app passa pela revisão da Play Store, um atacante que
 * comprometa só o GitHub não consegue trocar a chave pública dos aparelhos já instalados.
 *
 * USO:
 *   node tools/sign-data.js --genkey   # gera um par novo (uma vez só)
 *   node tools/sign-data.js            # assina os dados com a chave existente
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ed = require('@noble/ed25519');

const ROOT = path.join(__dirname, '..');
const GRADLE_PROPS = path.join(os.homedir(), '.gradle', 'gradle.properties');
const PROP = 'MEDALERT_DATA_SIGNING_KEY';

const ALVOS = [
  { json: 'src/data/interactions.json', sig: 'src/data/interactions.json.sig' },
  { json: 'src/data/medications-db.json', sig: 'src/data/medications-db.json.sig' },
];

const hex = buf => Buffer.from(buf).toString('hex');

function lerChavePrivada() {
  if (!fs.existsSync(GRADLE_PROPS)) return null;
  const m = fs.readFileSync(GRADLE_PROPS, 'utf8').match(new RegExp(`^${PROP}=(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

async function genkey() {
  if (lerChavePrivada()) {
    console.error(`✗ Já existe uma ${PROP} em ${GRADLE_PROPS}.`);
    console.error('  Gerar outra INVALIDA todas as assinaturas e quebra os apps já instalados.');
    console.error('  Se realmente quiser trocar, apague a propriedade manualmente antes.');
    process.exit(1);
  }
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);

  fs.appendFileSync(GRADLE_PROPS,
    `\n# MedAlert — chave PRIVADA de assinatura da base médica. NUNCA no repositório.\n` +
    `# Perder isto = não conseguir mais publicar atualização de dados (mas o app segue\n` +
    `# funcionando com o bundled). Backup junto com a keystore.\n` +
    `${PROP}=${hex(priv)}\n`);

  console.log('✓ Par gerado.');
  console.log(`  privada  → ${GRADLE_PROPS} (${PROP})  [NUNCA commitar]`);
  console.log('');
  console.log('  PÚBLICA (cole em src/services/dataSignature.ts):');
  console.log(`  ${hex(pub)}`);
}

async function assinar() {
  const privHex = lerChavePrivada();
  if (!privHex) {
    console.error(`✗ ${PROP} não encontrada em ${GRADLE_PROPS}.`);
    console.error('  Rode:  node tools/sign-data.js --genkey');
    process.exit(1);
  }
  const priv = Buffer.from(privHex, 'hex');

  for (const { json, sig } of ALVOS) {
    const p = path.join(ROOT, json);
    if (!fs.existsSync(p)) { console.error(`✗ não achei ${json}`); process.exit(1); }

    // Assina os BYTES CRUS do arquivo — é exatamente o que o app baixa do jsDelivr.
    // Nada de re-serializar: qualquer diferença de formatação invalidaria a assinatura.
    const bytes = fs.readFileSync(p);

    // O app baixa do CDN os bytes que o GIT ARMAZENA, não os do disco. Com core.autocrlf=true
    // (padrão no Windows) o git guarda LF e escreve CRLF na cópia de trabalho: assinaríamos
    // bytes que o CDN nunca vai servir. A assinatura ficaria "válida" aqui e o app rejeitaria
    // os dados calado. O .gitattributes fixa `-text` nesses arquivos para impedir isso; este
    // guarda existe para o caso de alguém clonar sem ele ou reintroduzir a conversão.
    if (bytes.includes(0x0d)) {
      console.error(`✗ ${json} tem CRLF. O git armazena LF — a assinatura NÃO bateria no CDN.`);
      console.error('  Converta para LF e reassine:');
      console.error(`     git add --renormalize ${json} && git checkout -- ${json}`);
      process.exit(1);
    }

    const assinatura = await ed.signAsync(bytes, priv);
    fs.writeFileSync(path.join(ROOT, sig), hex(assinatura) + '\n');
    console.log(`✓ ${json}  (${bytes.length} bytes)  →  ${sig}`);
  }
  console.log('');
  console.log('  Commite os .sig junto com os .json — se um for sem o outro, o app rejeita');
  console.log('  os dados remotos e continua com a base embarcada (falha segura).');
}

(async () => {
  if (process.argv.includes('--genkey')) await genkey();
  else await assinar();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
