const fs = require('fs');
const path = require('path');

const db = JSON.parse(fs.readFileSync(path.resolve('backend/data/db.json'), 'utf-8'));

console.log('=== 1. TECHNICIAN_IDS ANALYSIS IN APPOINTMENTS ===');
const techIdCountDist = {};
let invalidTechIdInArray = 0;
const validTechIds = new Set(db.technicians.map(t => t.id));

let emptyTechIdsCount = 0;
let singleTechIdsCount = 0;
let multiTechIdsCount = 0;
let mismatchSingleAndArrayCount = 0;

db.appointments.forEach(a => {
  const len = Array.isArray(a.technician_ids) ? a.technician_ids.length : 0;
  techIdCountDist[len] = (techIdCountDist[len] || 0) + 1;

  if (len === 0) emptyTechIdsCount++;
  else if (len === 1) singleTechIdsCount++;
  else multiTechIdsCount++;

  if (Array.isArray(a.technician_ids)) {
    a.technician_ids.forEach(tid => {
      if (!validTechIds.has(tid)) invalidTechIdInArray++;
    });
  }

  if (a.technician_id !== null && len === 1 && a.technician_id !== a.technician_ids[0]) {
    mismatchSingleAndArrayCount++;
  }
});

console.log('technician_ids length distribution:', techIdCountDist);
console.log(`Appointments with empty technician_ids: ${emptyTechIdsCount}`);
console.log(`Appointments with single technician_id in array: ${singleTechIdsCount}`);
console.log(`Appointments with multiple technician_ids in array: ${multiTechIdsCount}`);
console.log(`Invalid tech IDs in technician_ids array: ${invalidTechIdInArray}`);
console.log(`Mismatches between technician_id and technician_ids[0]: ${mismatchSingleAndArrayCount}`);

console.log('\n=== 2. APPOINTMENT_EQUIPMENTS CATEGORY_ID CHECK ===');
const catIdsInDB = new Set(db.equipment_categories.map(c => c.id));
const apptEqCatIdDist = {};
let invalidApptEqCatId = 0;

db.appointment_equipments.forEach(ae => {
  apptEqCatIdDist[ae.category_id] = (apptEqCatIdDist[ae.category_id] || 0) + 1;
  if (!catIdsInDB.has(ae.category_id)) {
    invalidApptEqCatId++;
  }
});
console.log('appointment_equipments category_id distribution:', apptEqCatIdDist);
console.log(`Invalid category_id in appointment_equipments (not in equipment_categories): ${invalidApptEqCatId}`);

console.log('\n=== 3. TECHNICIAN_NAMES ANALYSIS ===');
const nameDist = {};
let unassignedNameCount = 0;
db.appointments.forEach(a => {
  const name = a.technician_names;
  if (name === 'Equipe de Campo' || !name) unassignedNameCount++;
  nameDist[name] = (nameDist[name] || 0) + 1;
});
console.log(`'Equipe de Campo' or empty technician_names count: ${unassignedNameCount}`);
console.log('Top 10 technician_names values:', Object.entries(nameDist).sort((a,b) => b[1]-a[1]).slice(0, 10));

console.log('\n=== 4. ANALYZERS DETAIL ===');
console.log('Analyzers records:');
db.analyzers.forEach(a => {
  console.log(`- ID ${a.id}: ${a.asset_tag} | ${a.name} | ${a.type} | Status: ${a.status} | Loc: ${a.current_location}`);
});

console.log('\n=== 5. TEST TEMPLATES DETAIL ===');
db.test_templates.forEach(tt => {
  console.log(`- ID ${tt.id}: CatID=${tt.category_id} | ${tt.analyzer_type} | Mandatory=${tt.is_mandatory}`);
  try {
    const params = JSON.parse(tt.required_parameters);
    console.log(`  Parsed parameters (${params.length}):`, params.slice(0, 2));
  } catch(e) {
    console.log('  Failed to parse required_parameters as JSON!');
  }
});
