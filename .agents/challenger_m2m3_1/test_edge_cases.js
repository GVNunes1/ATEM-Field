const path = require('path');
const dotenv = require(path.resolve(__dirname, '../../backend/node_modules/dotenv'));
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const { createClient } = require(path.resolve(__dirname, '../../backend/node_modules/@supabase/supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY || !SERVICE_KEY.trim()) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in the process environment before running this script.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

async function testEdgeCases() {
  console.log('--- Edge Cases & Stress Testing ---');

  // Edge case 1: Test inserting a new technician using auto-increment sequence
  const { data: newTech, error: techErr } = await supabaseAdmin
    .from('technicians')
    .insert({
      name: 'Test Technician Sequence',
      email: 'test.seq@atem.com',
      role: 'Técnico Teste',
      status: 'Ativo'
    })
    .select()
    .single();

  if (techErr) {
    console.error('❌ Insert technician sequence test failed:', techErr.message);
  } else {
    console.log(`✅ Technician inserted with auto ID: ${newTech.id}`);
    // Clean up
    await supabaseAdmin.from('technicians').delete().eq('id', newTech.id);
    console.log('✅ Temporary technician cleaned up.');
  }

  // Edge case 2: Check all tables counts again
  const tables = ['technicians', 'appointments', 'appointment_equipments', 'appointment_technicians', 'equipment_categories', 'test_templates', 'analyzers'];
  for (const table of tables) {
    const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`❌ Table ${table} error:`, error.message);
    } else {
      console.log(`  Table ${table}: ${count} rows`);
    }
  }

  console.log('✅ Edge case testing completed.');
}

testEdgeCases().catch(err => {
  console.error('💥 Error during edge cases test:', err);
  process.exit(1);
});
