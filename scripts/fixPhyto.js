/* eslint-disable */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'src/data/medications-db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Remove all fitoterápico entries with wrong category (no accent) or wrong names
db.medications = db.medications.filter(m => m.category !== 'Fitoterapico');

// Check what's left
const phyto = db.medications.filter(m => m.category === 'Fitoterápico');
console.log('Fitoterápicos after cleanup:', phyto.length);
phyto.forEach(m => console.log(' -', m.genericName));

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
console.log('Total meds after cleanup:', db.medications.length);
