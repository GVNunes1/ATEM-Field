const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('./supabase-env');

const tables = [
  'technicians',
  'appointments',
  'appointment_technicians',
  'equipment_categories',
  'test_templates',
  'analyzers',
  'reservations',
  'appointment_equipments',
  'notification_logs'
];

async function verifyWithClient(client, name) {
  let allClean = true;
  for (const table of tables) {
    const { error } = await client.from(table).select('*').limit(1);
    if (error) {
      console.error(`✘ ${name}: ${table} returned ${error.code}: ${error.message}`);
      allClean = false;
    } else {
      console.log(`✔ ${name}: ${table} is accessible`);
    }
  }
  return allClean;
}

async function main() {
  const { url, serviceRoleKey, anonKey } = getSupabaseConfig({ requireAnonKey: true });
  const adminOk = await verifyWithClient(createClient(url, serviceRoleKey), 'service_role');
  const anonOk = await verifyWithClient(createClient(url, anonKey), 'anon');
  process.exitCode = adminOk && anonOk ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
