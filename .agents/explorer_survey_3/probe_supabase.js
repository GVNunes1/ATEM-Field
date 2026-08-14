const path = require('path');
const backendDir = path.resolve(__dirname, '../../backend');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });
const { createClient } = require(path.join(backendDir, 'node_modules/@supabase/supabase-js'));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Connecting to Supabase URL:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseKey);

async function probe() {
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

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(1);
      if (error) {
        console.log(`Table '${table}': ERROR ${error.code} - ${error.message}`);
      } else {
        console.log(`Table '${table}': EXISTS (count=${count}, rows=${data ? data.length : 0})`);
      }
    } catch (e) {
      console.log(`Table '${table}': EXCEPTION -> ${e.message}`);
    }
  }
}

probe();
