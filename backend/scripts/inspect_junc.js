const fs = require('fs');
const path = require('path');

const db = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/db.json'), 'utf8'));

let totalTechnicianIds = 0;
const uniqueJunctionKeys = new Set();
let countWithout21TechAppts = 0;
let countWithOnlyTechnicianIdColumn = 0;

db.appointments.forEach(a => {
  if (Array.isArray(a.technician_ids)) {
    totalTechnicianIds += a.technician_ids.length;
    if (a.technician_ids.length <= 6) {
      countWithout21TechAppts += a.technician_ids.length;
    }
    a.technician_ids.forEach(t => {
      uniqueJunctionKeys.add(`${a.id}_${t}`);
    });
  }
  if (a.technician_id) {
    countWithOnlyTechnicianIdColumn++;
  }
});

console.log({
  totalTechnicianIds,
  uniqueJunctionKeysSize: uniqueJunctionKeys.size,
  countWithout21TechAppts,
  countWithOnlyTechnicianIdColumn
});
