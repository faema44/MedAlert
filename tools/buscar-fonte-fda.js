#!/usr/bin/env node
/**
 * Procura FONTE para as interações que a bula brasileira NÃO sustentou, agora no openFDA.
 *
 * Depois da varredura das bulas da ANVISA sobraram 415 órfãs (146 críticas). O openFDA é a
 * única fonte que resta com acesso PROGRAMÁTICO permitido: o drugs.com bloqueia o Claude no
 * robots.txt, o Micromedex proíbe redistribuir, e base licenciada não cabe num app gratuito.
 *
 * A lógica é a mesma da busca na ANVISA, e igualmente sem LLM: se a bula americana da
 * digoxina cita "amiodarone" na seção DRUG INTERACTIONS, isso É a fonte de Digoxina ×
 * Amiodarona. É confirmação de texto, determinística — não geração.
 *
 * (O pipeline antigo em scripts/fda_round2_work usava LLM para EXTRAIR interações do texto.
 *  Aqui não se extrai nada: as interações já existem, o que falta é o lastro.)
 *
 * NOME EM INGLÊS: vem do RxNav (NIH), que traduz o RxCUI do nosso banco. Não é chute
 * morfológico — "varfarina" não vira "varfarine".
 *
 * BUSCA NAS 4 SEÇÕES, e não só em DRUG INTERACTIONS. A lição veio da ANVISA: a bula da
 * sildenafila não cita nitrato entre as "interações", cita entre as CONTRAINDICAÇÕES —
 * interação fatal não é chamada de interação, é proibição. Vale igual na bula americana.
 *
 * Tudo é CACHEADO em disco: a API tem limite diário e o trabalho precisa ser retomável.
 *
 * USO:  node tools/buscar-fonte-fda.js            (relatório)
 *       node tools/buscar-fonte-fda.js --gravar   (grava source: "FDA" nas confirmadas)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const GRAVAR = process.argv.includes('--gravar');
const CACHE_EN = path.join(ROOT, 'scripts/cache_rxnav_en.json');
const CACHE_FDA = path.join(ROOT, 'scripts/cache_fda_labels.json');

const DB = require(path.join(ROOT, 'src/data/medications-db.json')).medications;
const INTER = require(path.join(ROOT, 'src/data/interactions.json'));

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[()\/+]/g, ' ').replace(/\s+/g, ' ').trim();

// ── casamento de identidade (mesma regra do drugSearch.ts; ver buscar-fonte-anvisa.js) ──
const SEM_IDENTIDADE = new Set([
  'acido', 'acida', 'cloridrato', 'dicloridrato', 'bromidrato', 'mesilato', 'besilato',
  'maleato', 'tartarato', 'succinato', 'fumarato', 'valerato', 'propionato', 'dipropionato',
  'furoato', 'pamoato', 'oxalato', 'gluconato', 'acetato', 'citrato', 'lactato', 'nitrato',
  'sulfato', 'cloreto', 'carbonato', 'bicarbonato', 'fosfato', 'hidroxido', 'oxido',
  'humana', 'humano', 'ocular', 'oftalmico', 'topico', 'sais', 'suplementos',
  'com', 'sem', 'dos', 'das', 'por', 'para', 'seus', 'suas', 'outros', 'outras',
]);
const IONS = new Set(['sodio', 'sodica', 'sodico', 'potassio', 'potassica', 'potassico',
  'calcio', 'calcica', 'calcico', 'magnesio', 'aluminio', 'zinco', 'ferro', 'ferroso',
  'ferrica', 'ferrico']);
const GENITIVOS = new Set(['de', 'do', 'da']);

function identidade(nome) {
  const set = new Set();
  for (const alt of nome.split(/[/+()]/)) {
    const seq = norm(alt).split(/[\s,]+/).filter(Boolean);
    const palavras = seq.filter(t => t.length >= 3 && !SEM_IDENTIDADE.has(t));
    const contra = new Set();
    for (let k = 1; k < seq.length; k++) {
      if (IONS.has(seq[k]) && GENITIVOS.has(seq[k - 1])) contra.add(seq[k]);
    }
    const resto = palavras.filter(t => !contra.has(t));
    for (const t of (resto.length ? resto : palavras)) set.add(t);
  }
  return [...set];
}
const casa = (a, b) => (a.length >= 6 ? b.includes(a) : b.split(/[\s-]+/).some(w => w.startsWith(a)));
const ligados = (as, bs) => as.some(a => bs.some(b => casa(a, b) || casa(b, a)));

// ── quem participa das órfãs ────────────────────────────────────────────────
// Reprocessa também as já marcadas como FDA, para preencher o source_ref nas antigas.
const orfas = INTER.filter(i => !i.source || i.source === 'desconhecida' || i.source === 'FDA');
const comRxcui = DB.filter(e => e.rxcui);
const idPorGenerico = new Map(comRxcui.map(e => [e.genericName, identidade(e.genericName)]));

const ladosDe = new Map();   // id -> { 1: [generico...], 2: [...] }
const usados = new Set();
for (const i of orfas) {
  const l = {};
  for (const lado of [1, 2]) {
    const tk = identidade(lado === 1 ? i.drug1 : i.drug2);
    l[lado] = comRxcui.filter(e => ligados(tk, idPorGenerico.get(e.genericName))).map(e => e.genericName);
    l[lado].forEach(g => usados.add(g));
  }
  ladosDe.set(i.id, l);
}

const carrega = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
const salva = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));

const enDe = carrega(CACHE_EN);      // genericName PT -> nome EN
const labels = carrega(CACHE_FDA);   // nome EN -> texto das 4 seções ('' = sem bula na FDA)

const pega = url => new Promise(res => {
  https.get(url, { headers: { 'User-Agent': 'MedAlert/1.0 (audit)' } }, r => {
    let d = '';
    r.on('data', c => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  }).on('error', () => res(null));
});
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`${orfas.length} órfãs (${orfas.filter(i => i.risk_level === 'critical').length} críticas)`);
  console.log(`${usados.size} genéricos COM RxCUI participam delas\n`);

  // 1. RxCUI -> nome em inglês (RxNav / NIH)
  const faltaEn = [...usados].filter(g => !(g in enDe));
  if (faltaEn.length) {
    console.log(`RxNav: traduzindo ${faltaEn.length} nomes…`);
    for (let k = 0; k < faltaEn.length; k++) {
      const g = faltaEn[k];
      const rx = DB.find(e => e.genericName === g).rxcui;
      const j = await pega(`https://rxnav.nlm.nih.gov/REST/rxcui/${rx}/property.json?propName=RxNorm%20Name`);
      enDe[g] = j?.propConceptGroup?.propConcept?.[0]?.propValue?.toLowerCase() ?? '';
      if ((k + 1) % 50 === 0) { salva(CACHE_EN, enDe); process.stdout.write(`  ${k + 1}/${faltaEn.length}\r`); }
      await espera(60);
    }
    salva(CACHE_EN, enDe);
    console.log(`  traduzidos: ${Object.values(enDe).filter(Boolean).length}\n`);
  }

  // 2. openFDA: texto da bula americana (4 seções)
  const nomesEn = [...new Set(Object.values(enDe).filter(Boolean))];
  const faltaLabel = nomesEn.filter(n => !(n in labels));
  if (faltaLabel.length) {
    console.log(`openFDA: baixando ${faltaLabel.length} bulas…`);
    for (let k = 0; k < faltaLabel.length; k++) {
      const n = faltaLabel[k];
      const j = await pega('https://api.fda.gov/drug/label.json?limit=3&search='
        + encodeURIComponent(`openfda.generic_name:"${n}"`));
      const partes = [];
      for (const r of (j?.results ?? [])) {
        // As 4 seções. Interação grave costuma estar em CONTRAINDICATIONS ou BOXED WARNING,
        // não em DRUG INTERACTIONS — mesma lição da bula da sildenafila na ANVISA.
        for (const campo of ['drug_interactions', 'contraindications', 'warnings', 'boxed_warning']) {
          if (r[campo]) partes.push(String(r[campo]));
        }
      }
      labels[n] = partes.join('\n');
      if ((k + 1) % 25 === 0) { salva(CACHE_FDA, labels); process.stdout.write(`  ${k + 1}/${faltaLabel.length}\r`); }
      await espera(300);   // limite do openFDA: 240/min sem chave
    }
    salva(CACHE_FDA, labels);
    console.log(`  com texto: ${Object.values(labels).filter(Boolean).length}\n`);
  }

  // 3. confirmação: a bula americana do lado A cita o fármaco do lado B?
  //
  // POR NOME não basta, e a razão é estrutural: a bula quase nunca lista os parceiros um a um.
  // A do fentanil diz "benzodiazepines and other CNS depressants" — não diz "lorazepam".
  // A do metotrexato diz "nonsteroidal anti-inflammatory drugs" — não diz "ibuprofeno".
  // A do tramadol diz "monoamine oxidase (MAO) inhibitors" — não diz "fenelzina".
  // Exigir o nome descartava 110 interações CLÁSSICAS como se fossem duvidosas.
  //
  // A citação por CLASSE é legítima (lorazepam É benzodiazepínico), mas é mais larga que a
  // nominal — então fica MARCADA como tal, e não vendemos uma pela outra.
  const CLASSES = [
    { en: ['benzodiazepin'],                                   pt: ['alprazolam', 'diazepam', 'lorazepam', 'midazolam', 'oxazepam', 'triazolam', 'clonazepam', 'bromazepam', 'clobazam', 'flurazepam', 'nitrazepam', 'cloxazolam', 'estazolam'] },
    { en: ['nsaid', 'nonsteroidal anti', 'non-steroidal anti'],  pt: ['ibuprofeno', 'diclofenaco', 'naproxeno', 'cetoprofeno', 'piroxicam', 'meloxicam', 'indometacina', 'cetorolaco', 'nimesulida', 'lornoxicam', 'aines', 'tenoxicam', 'etoricoxibe', 'celecoxibe'] },
    { en: ['monoamine oxidase', 'mao inhibitor'],              pt: ['fenelzina', 'tranilcipromina', 'selegilina', 'rasagilina', 'moclobemida', 'linezolida', 'imaos', 'imao'] },
    { en: ['selective serotonin reuptake', 'ssri'],            pt: ['fluoxetina', 'sertralina', 'paroxetina', 'citalopram', 'escitalopram', 'fluvoxamina', 'isrs'] },
    { en: ['tricyclic'],                                       pt: ['amitriptilina', 'nortriptilina', 'imipramina', 'clomipramina', 'doxepina', 'trimipramina', 'maprotilina', 'triciclicos'] },
    { en: ['triptan'],                                         pt: ['sumatriptano', 'rizatriptano', 'naratriptano', 'almotriptano', 'zolmitriptano', 'triptanos'] },
    { en: ['opioid'],                                          pt: ['morfina', 'fentanila', 'metadona', 'oxicodona', 'codeina', 'tramadol', 'hidrocodona', 'buprenorfina', 'nalbufina', 'petidina', 'opioides'] },
    { en: ['qt interval', 'qt prolongation', 'prolong the qt'], pt: ['pimozida', 'tioridazina', 'amiodarona', 'sotalol', 'clorpromazina', 'haloperidol', 'citalopram', 'domperidona', 'metadona'] },
    { en: ['statin', 'hmg-coa'],                               pt: ['sinvastatina', 'atorvastatina', 'rosuvastatina', 'pravastatina', 'lovastatina', 'estatinas'] },
    { en: ['anticoagulant'],                                   pt: ['varfarina', 'dabigatrana', 'rivaroxabana', 'apixabana', 'edoxabana', 'heparina', 'enoxaparina', 'dalteparina'] },
    // ÁLCOOL não é medicamento: não está no banco, não tem RxCUI nem bula, então nunca virou
    // alvo de busca — e eram 12 interações CRÍTICAS órfãs só por isso. Mas toda bula fala dele.
    { en: ['alcohol', 'ethanol'],                              pt: ['etanol', 'alcool'] },
    { en: ['xanthine oxidase'],                                pt: ['alopurinol', 'febuxostate', 'xantina oxidase'] },
    { en: ['cisapride'],                                       pt: ['cisaprida'] },
  ];
  // A base escreve a mesma classe de várias formas ("IMAOs", "MAOIs", "Inibidores da MAO").
  // Sem normalizar isso, a classe existe no mapa e mesmo assim não casa.
  const APELIDOS = {
    'maois': 'imaos', 'maoi': 'imaos', 'inibidores da mao': 'imaos',
    'inibidores da monoaminoxidase': 'imaos', 'inibidores da monoamina oxidase': 'imaos',
  };
  const classesDe = nomePt => {
    let n = norm(nomePt);
    for (const [de, para] of Object.entries(APELIDOS)) if (n.includes(de)) n += ' ' + para;
    return CLASSES.filter(c => c.pt.some(p => n.includes(p)));
  };

  const confirmadas = new Map();
  for (const i of orfas) {
    const l = ladosDe.get(i.id);
    for (const [a, b] of [[1, 2], [2, 1]]) {
      const nomeB = b === 1 ? i.drug1 : i.drug2;
      const alvos = l[b].map(g => enDe[g]).filter(n => n && n.length >= 6);
      const classes = [...new Set([...l[b], nomeB].flatMap(g => classesDe(g)).flatMap(c => c.en))];
      if (!alvos.length && !classes.length) continue;
      for (const g of l[a]) {
        const texto = labels[enDe[g]];
        if (!texto) continue;
        const t = texto.toLowerCase();
        const porNome = alvos.find(n => new RegExp(`(^|[^a-z])${n.split(' ')[0]}`, 'i').test(t));
        const porClasse = porNome ? null : classes.find(c => t.includes(c));
        if (!porNome && !porClasse) continue;
        confirmadas.set(i.id, {
          medicamento: g, en: enDe[g],
          citou: porNome ?? porClasse, nominal: !!porNome,
        });
        break;
      }
      if (confirmadas.has(i.id)) break;
    }
  }

  const crit = orfas.filter(i => i.risk_level === 'critical');
  const critOk = crit.filter(i => confirmadas.has(i.id)).length;
  console.log(`CONFIRMADAS pelo FDA: ${confirmadas.size} de ${orfas.length}`);
  console.log(`   entre as CRÍTICAS:  ${critOk} de ${crit.length}\n`);
  console.log('AMOSTRA:');
  for (const i of crit.filter(x => confirmadas.has(x.id)).slice(0, 12)) {
    const c = confirmadas.get(i.id);
    console.log(`   [${i.id}] ${i.drug1}  ×  ${i.drug2}`);
    console.log(`        bula FDA de ${c.en} cita "${c.citou}" ${c.nominal ? '(nome)' : '(classe)'}`);
  }

  if (!GRAVAR) { console.log('\n[relatório] use --gravar para escrever source: "FDA"'); return; }
  const saida = INTER.map(i => {
    if (!confirmadas.has(i.id)) return i;
    const { id, source, source_ref, ...resto } = i;
    // O fármaco cuja bula AMERICANA cita o outro. "Fonte: FDA" sozinho não diz nada:
    // o documento é a bula do WARFARIN, e é isso que o usuário precisa poder conferir.
    const c = confirmadas.get(i.id);
    return { id, source: 'FDA', source_ref: c.medicamento, ...resto };
  });
  fs.writeFileSync(path.join(ROOT, 'src/data/interactions.json'), JSON.stringify(saida, null, 2) + '\n');
  console.log(`\n✓ ${confirmadas.size} entradas marcadas com source: "FDA"`);
})();
