/**
 * Remove interações duplicadas/redundantes em interactions.json.
 *
 * Causa: um lote gerado em massa (mecanismo genérico "X. Conduta: Y.") criou
 * entradas repetidas para pares que já tinham entrada curada, usando a variante
 * de nome do genérico com/sem sufixo parentético (ex: "Colchicina" vs
 * "Colchicina (gota)", "Metotrexato" vs "Metotrexato (oncológico)") — como o
 * casamento de nome é por substring, ambas disparavam ao mesmo tempo pro
 * mesmo usuário, duplicando o alerta na tela de interações.
 *
 * Em um caso (Clopidogrel x Omeprazol/Esomeprazol) a entrada duplicada além de
 * redundante estava com mecanismo errado ("Hemorragia grave" — o problema real
 * é REDUÇÃO do efeito antiagregante via CYP2C19, não sangramento).
 *
 * Ao remover cada duplicata, os RxCUIs que só existiam nela são copiados pra
 * entrada mantida (o casamento por RxCUI só adiciona matches, nunca restringe
 * — ver comentário em drugSearch.ts), então não perdemos robustez de match.
 *
 * Execute: node scripts/dedupe-interactions.js
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../src/data/interactions.json');
const interactions = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// id da duplicata removida -> id da entrada mantida
const REMOVE = {
  int_201: 'int_196', // AAS x Varfarina — mantém a versão com mecanismo/fonte (Somalgin Cardio)
  int_808: 'int_805', // AAS x Álcool — mantém "hemorragia gastrointestinal" (mais específico)
  int_319: 'int_010', // Clopidogrel x Omeprazol — mecanismo errado ("hemorragia"); real é ↓ efeito antiagregante
  int_320: 'int_010', // Clopidogrel x Esomeprazol — idem
  int_263: 'int_264', // Bevacizumabe x Sunitinibe — mantém a variante "(oncológico)" (contexto correto p/ Sunitinibe)
  int_340: 'int_343', // Colchicina x Ciclosporina — mantém "(gota)"/critical
  int_341: 'int_344', // Colchicina x Eritromicina — idem
  int_342: 'int_345', // Colchicina x Claritromicina — idem
  int_555: 'int_553', // Metotrexato x TMP-SMX — mantém a versão sem "(oncológico)" (interação clássica é na dose baixa/reumatológica)
  int_910: 'int_909', // Metotrexato x Álcool — idem
  int_563: 'int_561', // Mononitrato de Isossorbida x Tadalafila — mantém a versão sem sufixo de dose
  int_564: 'int_562', // Mononitrato de Isossorbida x Vardenafila — idem
  int_751: 'int_003', // Tranilcipromina x Pseudoefedrina — já coberta pela entrada de classe (IMAOs x Simpaticomiméticos)
  int_912: 'int_911', // Metronidazol x Álcool — mantém a versão sem "(antiparasitário)" (efeito dissulfiram independe da indicação)
};

const byId = new Map(interactions.map(i => [i.id, i]));

function mergeRxcuis(target, removed) {
  for (const field of ['drug1_rxcuis', 'drug2_rxcuis']) {
    if (!removed[field]) continue;
    const merged = new Set([...(target[field] || []), ...removed[field]]);
    target[field] = [...merged];
  }
}

let removedCount = 0;
for (const [removeId, keepId] of Object.entries(REMOVE)) {
  const removed = byId.get(removeId);
  const kept = byId.get(keepId);
  if (!removed || !kept) {
    console.warn(`AVISO: ${removeId} ou ${keepId} não encontrado — pulando`);
    continue;
  }
  mergeRxcuis(kept, removed);
  removedCount++;
}

const result = interactions.filter(i => !(i.id in REMOVE));

fs.writeFileSync(DB_PATH, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(`Removidas ${removedCount} interações duplicadas/redundantes.`);
console.log(`Total antes: ${interactions.length}, depois: ${result.length}`);
