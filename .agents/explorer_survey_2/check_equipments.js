const fs = require('fs');
const path = require('path');

const db = JSON.parse(fs.readFileSync(path.resolve('backend/data/db.json'), 'utf-8'));

console.log('=== APPOINTMENT VS APPOINTMENT_EQUIPMENTS 1:1 CHECK ===');
const apptIds = new Set(db.appointments.map(a => a.id));
const aeApptIds = new Set(db.appointment_equipments.map(ae => ae.appointment_id));

console.log(`Appointments total: ${db.appointments.length}`);
console.log(`Appointment Equipments total: ${db.appointment_equipments.length}`);
console.log(`Unique appointment_ids in appointment_equipments: ${aeApptIds.size}`);

let exactMatchCount = 0;
db.appointments.forEach(a => {
  const ae = db.appointment_equipments.find(e => e.appointment_id === a.id);
  if (ae) exactMatchCount++;
});
console.log(`Appointments having corresponding appointment_equipment: ${exactMatchCount}`);

// Check if appointments table in Supabase should merge equipment fields or keep equipment table / column.
console.log('\n=== FIELD COMPARISON BETWEEN APPOINTMENTS AND APPOINTMENT_EQUIPMENTS ===');
const appt1 = db.appointments[0];
const ae1 = db.appointment_equipments[0];
console.log('Sample Appointment #1:', appt1);
console.log('Sample Appointment Equipment #1:', ae1);
