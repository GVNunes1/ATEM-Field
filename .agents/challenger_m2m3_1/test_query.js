const path = require('path');
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const { createClient } = require(path.resolve(__dirname, '../../backend/node_modules/@supabase/supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvcmNsYmF3eHBqZ3JiZHJjaXRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjUwNzE1OSwiZXhwIjoyMTAyMDgzMTU5fQ.Z6TA6Ad-nZ2UIBnHfjY_Z7V9T3rILP0iS9MYYH2omwY';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

async function testQuery() {
  console.log('--- Empirical Test: Querying Appointments with Relations ---');
  
  // 1. Basic query of appointments
  const { data: appointments, error: apptErr, count } = await supabaseAdmin
    .from('appointments')
    .select('*', { count: 'exact' })
    .limit(5);

  if (apptErr) {
    console.error('❌ Error querying appointments:', apptErr.message);
    process.exit(1);
  }

  console.log(`Total appointments in DB count check: ${count}`);
  console.log('Sample appointments retrieved from Supabase PostgreSQL:');
  appointments.forEach((appt, idx) => {
    console.log(`[${idx + 1}] ID: ${appt.id} | External ID: ${appt.external_id} | Title: "${appt.title}" | Client: "${appt.client_name}" | Date: ${appt.appointment_date} | Time: ${appt.appointment_time} | Status: ${appt.status} | Tech Names: "${appt.technician_names}"`);
  });

  // 2. Query appointment with joined appointment_equipments and appointment_technicians
  const { data: joinedData, error: joinErr } = await supabaseAdmin
    .from('appointments')
    .select(`
      id,
      title,
      client_name,
      appointment_date,
      appointment_equipments (
        id, model, tag, category_id
      ),
      appointment_technicians (
        technician_id,
        technicians (
          id, name, phone, role
        )
      )
    `)
    .limit(3);

  if (joinErr) {
    console.error('❌ Error querying joined appointments:', joinErr.message);
    process.exit(1);
  }

  console.log('\nSample Joined Appointments Data:');
  console.log(JSON.stringify(joinedData, null, 2));

  // 3. Verify data sanity assertions
  const hasTitles = appointments.every(a => typeof a.title === 'string' && a.title.trim().length > 0);
  const hasClients = appointments.some(a => a.client_name !== null && a.client_name.length > 0);
  const hasDates = appointments.every(a => a.appointment_date !== null);

  if (hasTitles && hasClients && hasDates && count === 1982) {
    console.log('\n✅ Appointment real data query verification PASSED PERFECTLY!');
    process.exit(0);
  } else {
    console.error('\n❌ Appointment real data check failed.');
    process.exit(1);
  }
}

testQuery().catch(err => {
  console.error('💥 Test error:', err);
  process.exit(1);
});
