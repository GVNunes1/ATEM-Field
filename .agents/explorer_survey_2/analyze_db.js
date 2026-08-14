const fs = require('fs');
const path = require('path');

const dbPath = path.resolve('backend/data/db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

console.log('=== TOP LEVEL KEYS & COUNTS ===');
const counts = {};
for (const key in db) {
  if (Array.isArray(db[key])) {
    counts[key] = db[key].length;
    console.log(`Key: ${key} -> Count: ${db[key].length}`);
  } else {
    console.log(`Key: ${key} -> Type: ${typeof db[key]}`);
  }
}

console.log('\n=== DETAILED COLLECTION ANALYSIS ===');

function analyzeCollection(name, arr) {
  console.log(`\n--- COLLECTION: ${name} (Count: ${arr.length}) ---`);
  if (arr.length === 0) {
    console.log('Collection is empty.');
    return;
  }

  const fieldsMap = {};
  const idSet = new Set();
  const idTypes = new Set();
  let duplicateIdCount = 0;

  arr.forEach((item, index) => {
    if (item.id !== undefined && item.id !== null) {
      if (idSet.has(item.id)) {
        duplicateIdCount++;
      } else {
        idSet.add(item.id);
      }
      idTypes.add(typeof item.id);
    }

    Object.keys(item).forEach(key => {
      if (!fieldsMap[key]) {
        fieldsMap[key] = {
          countPresent: 0,
          countNull: 0,
          countUndefined: 0,
          types: new Set(),
          sampleValues: new Set()
        };
      }
      fieldsMap[key].countPresent++;
      const val = item[key];
      if (val === null) {
        fieldsMap[key].countNull++;
        fieldsMap[key].types.add('null');
      } else if (val === undefined) {
        fieldsMap[key].countUndefined++;
        fieldsMap[key].types.add('undefined');
      } else {
        const t = Array.isArray(val) ? 'array' : typeof val;
        fieldsMap[key].types.add(t);
        if (fieldsMap[key].sampleValues.size < 5) {
          fieldsMap[key].sampleValues.add(typeof val === 'object' ? JSON.stringify(val).slice(0, 50) : String(val).slice(0, 50));
        }
      }
    });
  });

  console.log(`Primary Key 'id' status: present in ${idSet.size + duplicateIdCount}/${arr.length} items. ID types: [${Array.from(idTypes).join(', ')}]. Duplicate IDs: ${duplicateIdCount}`);

  console.log('Fields breakdown:');
  Object.keys(fieldsMap).sort().forEach(f => {
    const info = fieldsMap[f];
    const missingCount = arr.length - info.countPresent;
    const typesStr = Array.from(info.types).join('|');
    const samples = Array.from(info.sampleValues).join(', ');
    console.log(`  - ${f}: types=[${typesStr}], present=${info.countPresent}/${arr.length}, nulls=${info.countNull}, missing=${missingCount}, samples=[${samples}]`);
  });
}

for (const key in db) {
  if (Array.isArray(db[key])) {
    analyzeCollection(key, db[key]);
  }
}

// Deep relationships & foreign key validation
console.log('\n=== RELATIONSHIPS & FOREIGN KEYS VALIDATION ===');

// 1. Technicians ID index
const techMapById = new Map();
const techMapByName = new Map();
if (db.technicians) {
  db.technicians.forEach(t => {
    techMapById.set(t.id, t);
    techMapById.set(String(t.id), t);
    if (t.name) techMapByName.set(t.name.trim().toLowerCase(), t);
  });
}

// 2. Appointments -> Technicians check
if (db.appointments) {
  let apptWithTechId = 0;
  let apptWithTechName = 0;
  let apptWithTechArray = 0;
  let invalidTechRef = 0;
  const missingTechNames = new Set();
  const missingTechIds = new Set();

  db.appointments.forEach(a => {
    if (a.technician_id !== undefined && a.technician_id !== null) apptWithTechId++;
    if (a.technician_name !== undefined || a.technician_names !== undefined) apptWithTechName++;
    if (Array.isArray(a.technicians) || Array.isArray(a.technician_ids)) apptWithTechArray++;

    // check technician_id
    if (a.technician_id !== undefined && a.technician_id !== null) {
      if (!techMapById.has(a.technician_id)) {
        invalidTechRef++;
        missingTechIds.add(a.technician_id);
      }
    }
    // check technician_name / technician_names
    const nameVal = a.technician_names || a.technician_name;
    if (nameVal) {
      if (typeof nameVal === 'string') {
        // could be comma separated or single name
        const names = nameVal.split(/[,;/]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        names.forEach(n => {
          if (!techMapByName.has(n)) {
            missingTechNames.add(n);
          }
        });
      }
    }
  });

  console.log(`Appointments Tech Refs: apptWithTechId=${apptWithTechId}, apptWithTechName=${apptWithTechName}, apptWithTechArray=${apptWithTechArray}`);
  console.log(`Invalid tech IDs in appointments: ${invalidTechRef}, Unique missing tech IDs: ${Array.from(missingTechIds).join(', ')}`);
  console.log(`Missing tech names count: ${missingTechNames.size}, Samples: [${Array.from(missingTechNames).slice(0, 10).join(', ')}]`);
}

// 3. Test Templates -> Categories
if (db.test_templates && db.equipment_categories) {
  const catIds = new Set(db.equipment_categories.map(c => c.id));
  const catIdsStr = new Set(db.equipment_categories.map(c => String(c.id)));
  let orphanTemplates = 0;
  db.test_templates.forEach(tt => {
    if (tt.category_id !== undefined && !catIds.has(tt.category_id) && !catIdsStr.has(tt.category_id)) {
      orphanTemplates++;
    }
  });
  console.log(`Test templates with invalid category_id: ${orphanTemplates}`);
}

// 4. Analyzers PAT format check & Category ref check
if (db.analyzers) {
  let validPatCount = 0;
  let invalidPatCount = 0;
  const invalidPats = [];
  db.analyzers.forEach(an => {
    const tag = an.asset_tag || an.patrimonio || an.patrimonio_id;
    if (tag && /^PAT-\d{6}$/.test(tag)) {
      validPatCount++;
    } else {
      invalidPatCount++;
      invalidPats.push({ id: an.id, tag });
    }
  });
  console.log(`Analyzers Asset Tag format PAT-XXXXXX: Valid=${validPatCount}, Invalid=${invalidPatCount}`);
  if (invalidPats.length > 0) {
    console.log('Sample invalid asset_tags:', JSON.stringify(invalidPats.slice(0, 10)));
  }
}

// 5. Reservations FK validation
if (db.reservations) {
  const analyzerIds = new Set(db.analyzers ? db.analyzers.map(a => a.id) : []);
  const techIds = new Set(db.technicians ? db.technicians.map(t => t.id) : []);
  let resInvalidAnalyzer = 0;
  let resInvalidTech = 0;
  db.reservations.forEach(r => {
    if (r.analyzer_id && !analyzerIds.has(r.analyzer_id) && !analyzerIds.has(Number(r.analyzer_id))) resInvalidAnalyzer++;
    if (r.technician_id && !techIds.has(r.technician_id) && !techIds.has(Number(r.technician_id))) resInvalidTech++;
  });
  console.log(`Reservations FK issues: Invalid analyzer_id=${resInvalidAnalyzer}, Invalid technician_id=${resInvalidTech}`);
}
