const path = require('path');
const { createClient } = require(path.resolve(__dirname, '../../backend/node_modules/@supabase/supabase-js'));

const supabaseUrl = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey || !serviceRoleKey.trim()) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in the process environment before running this script.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function testMultipleSequenceInserts() {
  console.log('Testing multiple technician insertions without specifying id...');
  const testTechs = [
    { name: 'Multi Tech 1', phone: '111', role: 'Tester', status: 'Inativo' },
    { name: 'Multi Tech 2', phone: '222', role: 'Tester', status: 'Inativo' },
    { name: 'Multi Tech 3', phone: '333', role: 'Tester', status: 'Inativo' }
  ];

  const insertedIds = [];
  let success = true;

  for (const tech of testTechs) {
    const { data, error } = await supabase
      .from('technicians')
      .insert([tech])
      .select()
      .single();

    if (error) {
      console.error('Error inserting tech:', error);
      success = false;
      break;
    }

    const id = Number(data.id);
    insertedIds.push(id);
    console.log(`Inserted ${tech.name} -> ID ${id}`);

    if (id <= 120) {
      console.error(`FAILURE: ID ${id} is not > 120`);
      success = false;
    }
  }

  console.log('Inserted IDs:', insertedIds);

  // Check sequence incrementing property
  for (let i = 1; i < insertedIds.length; i++) {
    if (insertedIds[i] <= insertedIds[i-1]) {
      console.error(`FAILURE: IDs are not strictly increasing: ${insertedIds[i-1]} vs ${insertedIds[i]}`);
      success = false;
    }
  }

  // Cleanup
  console.log('Cleaning up test technicians:', insertedIds);
  for (const id of insertedIds) {
    await supabase.from('technicians').delete().eq('id', id);
  }

  process.exit(success ? 0 : 1);
}

testMultipleSequenceInserts();
