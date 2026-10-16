const path = require('path');
const { createClient } = require(path.resolve(__dirname, '../../backend/node_modules/@supabase/supabase-js'));
const fs = require('fs');

const SUPABASE_URL = 'https://aorclbawxpjgrbdrcith.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY || !SERVICE_KEY.trim()) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in the process environment before running this script.');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function runAudit() {
  console.log('=== FORENSIC AUDIT: LIVE SUPABASE POSTGRESQL VS DB.JSON ===\n');

  // Load db.json
  const dbPath = path.resolve(__dirname, '../../backend/data/db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  const tablesToVerify = [
    'technicians',
    'appointments',
    'appointment_equipments',
    'appointment_technicians',
    'equipment_categories',
    'test_templates',
    'analyzers',
    'reservations',
    'notification_logs'
  ];

  console.log('1. EXACT ROW COUNTS:');
  const counts = {};
  for (const table of tablesToVerify) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`  ❌ Error counting ${table}:`, error.message);
    } else {
      counts[table] = count;
      console.log(`  - Table '${table}': ${count} rows in Supabase`);
    }
  }

  console.log('\n2. COMPARISON WITH DB.JSON COUNTS:');
  console.log(`  - db.json technicians: ${db.technicians ? db.technicians.length : 0} | Supabase: ${counts.technicians}`);
  console.log(`  - db.json appointments: ${db.appointments ? db.appointments.length : 0} | Supabase: ${counts.appointments}`);
  console.log(`  - db.json appointment_equipments: ${db.appointment_equipments ? db.appointment_equipments.length : 0} | Supabase: ${counts.appointment_equipments}`);
  console.log(`  - db.json equipment_categories: ${db.equipment_categories ? db.equipment_categories.length : 0} | Supabase: ${counts.equipment_categories}`);
  console.log(`  - db.json test_templates: ${db.test_templates ? db.test_templates.length : 0} | Supabase: ${counts.test_templates}`);
  console.log(`  - db.json analyzers: ${db.analyzers ? db.analyzers.length : 0} | Supabase: ${counts.analyzers}`);

  console.log('\n3. SAMPLE RECONCILIATION (TECHNICIANS):');
  // Compare technician #1, #60, #120
  const sampleTechIds = [1, 60, 120];
  const { data: dbTechs } = await supabase.from('technicians').select('*').in('id', sampleTechIds).order('id');
  for (const tech of dbTechs) {
    const jsonTech = db.technicians.find(t => t.id === tech.id);
    const nameMatch = jsonTech && jsonTech.name === tech.name;
    console.log(`  - Tech ID ${tech.id}: Supabase="${tech.name}" | db.json="${jsonTech ? jsonTech.name : 'MISSING'}" -> Match: ${nameMatch}`);
  }

  console.log('\n4. SAMPLE RECONCILIATION (APPOINTMENTS):');
  // Compare appointment #1, #991, #1982
  const sampleApptIds = [1, 991, 1982];
  const { data: dbAppts } = await supabase.from('appointments').select('*').in('id', sampleApptIds).order('id');
  for (const appt of dbAppts) {
    const jsonAppt = db.appointments.find(a => a.id === appt.id);
    const titleMatch = jsonAppt && jsonAppt.title === appt.title;
    const clientMatch = jsonAppt && jsonAppt.client_name === appt.client_name;
    const dateMatch = jsonAppt && jsonAppt.appointment_date === appt.appointment_date;
    console.log(`  - Appt ID ${appt.id}:`);
    console.log(`      Title: Supabase="${appt.title}" | db.json="${jsonAppt?.title}" -> Match: ${titleMatch}`);
    console.log(`      Client: Supabase="${appt.client_name}" | db.json="${jsonAppt?.client_name}" -> Match: ${clientMatch}`);
    console.log(`      Date: Supabase="${appt.appointment_date}" | db.json="${jsonAppt?.appointment_date}" -> Match: ${dateMatch}`);
  }

  console.log('\n5. ANOMALY & FACADE DETECTION:');
  // Check if technician names or titles are hardcoded dummy text
  const { data: dummyTest } = await supabase.from('technicians').select('name').ilike('name', '%test%');
  console.log(`  - Technicians containing "test" in name: ${dummyTest ? dummyTest.length : 0}`);
  
  // Check if appointments contain genuine calendar data
  const { data: randomApptSample } = await supabase.from('appointments').select('title, client_name, appointment_date').range(500, 505);
  console.log('  - Random Appt sample (rows 500-505):');
  console.dir(randomApptSample);

  console.log('\n=== AUDIT SCRIPT COMPLETE ===');
}

runAudit().catch(err => {
  console.error('Audit Script Error:', err);
  process.exit(1);
});
