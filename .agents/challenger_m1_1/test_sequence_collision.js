const { createClient } = require('../../backend/node_modules/@supabase/supabase-js');

const SUPABASE_URL = 'https://aorclbawxpjgrbdrcith.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY || !SERVICE_KEY.trim()) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in the process environment before running this script.');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function testSequenceCollisionDeep() {
  console.log('=== TESTING DEEP SEQUENCE COLLISION ===\n');

  // Insert auto-increment row to find where sequence currently is
  const { data: rowA } = await supabase.from('equipment_categories').insert({ name: 'TEST_SEQ_CURR' }).select();
  const currentSeqId = rowA[0].id;
  console.log(`Current auto-generated id is: ${currentSeqId}`);

  // Target next sequence id
  const nextSeqId = currentSeqId + 1;

  // Insert explicit row with id = nextSeqId
  console.log(`Inserting explicit row with id=${nextSeqId}...`);
  const { data: expRow, error: expErr } = await supabase
    .from('equipment_categories')
    .insert({ id: nextSeqId, name: `TEST_SEQ_EXP_${nextSeqId}` })
    .select();

  if (expErr) {
    console.error('Failed to insert explicit ID:', expErr);
  } else {
    console.log(`Explicit row inserted: id=${expRow[0].id}`);
  }

  // Now try auto-increment insert without ID
  console.log('Attempting auto-increment insert without ID (should trigger nextval)...');
  const { data: autoRow, error: autoErr } = await supabase
    .from('equipment_categories')
    .insert({ name: 'TEST_SEQ_AUTO_COLLISION_TEST' })
    .select();

  if (autoErr) {
    console.log(`⚠️ ENCOUNTERED EXPECTED POSTGRES BEHAVIOR: ${autoErr.code} - ${autoErr.message}`);
    console.log('NOTE: In PostgreSQL, explicit PK inserts on IDENTITY columns DO NOT advance sequence value automatically.');
    console.log('Recommendation for M2 data seeding: Seeding scripts must call `SELECT setval(pg_get_serial_sequence(\'table_name\', \'id\'), (SELECT max(id) FROM table_name));` after bulk inserting explicit IDs.');
  } else {
    console.log(`Auto-increment generated id=${autoRow[0].id}`);
  }

  // Cleanup test rows
  await supabase.from('equipment_categories').delete().ilike('name', 'TEST_SEQ_%');
}

testSequenceCollisionDeep();
