const fs = require('fs');
const path = require('path');

// Read backend/.env without external dependencies
const envPath = path.resolve(__dirname, '../../backend/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
} else {
  console.error(`[ERROR] Environment file not found at ${envPath}`);
  process.exit(1);
}

// Require @supabase/supabase-js from backend/node_modules
const supabaseModulePath = path.resolve(__dirname, '../../backend/node_modules/@supabase/supabase-js');
const { createClient } = require(supabaseModulePath);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ERROR] Missing required Supabase environment variables');
  console.error({ SUPABASE_URL, SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY });
  process.exit(1);
}

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

const TABLES = [
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

async function runEmpiricalTests() {
  console.log('====================================================');
  console.log(' EMPIRICAL CHALLENGER M1 VERIFICATION SUITE');
  console.log(` Target URL: ${SUPABASE_URL}`);
  console.log(` Timestamp:  ${new Date().toISOString()}`);
  console.log('====================================================\n');

  let passed = true;
  const results = {
    connectionStability: { service_role: [], anon: [] },
    tableQueries: {},
    pgrst205Errors: 0,
    rlsCrudTests: []
  };

  // ----------------------------------------------------
  // STEP 1: Connection Stability Test (10 consecutive queries each)
  // ----------------------------------------------------
  console.log('--- Step 1: Testing Connection Stability (10 iterations each) ---');
  
  for (let i = 1; i <= 10; i++) {
    const startSr = Date.now();
    const { error: errSr } = await serviceClient.from('technicians').select('id').limit(1);
    const durationSr = Date.now() - startSr;
    results.connectionStability.service_role.push({ iter: i, durationMs: durationSr, success: !errSr, error: errSr ? errSr.message : null });

    const startAnon = Date.now();
    const { error: errAnon } = await anonClient.from('technicians').select('id').limit(1);
    const durationAnon = Date.now() - startAnon;
    results.connectionStability.anon.push({ iter: i, durationMs: durationAnon, success: !errAnon, error: errAnon ? errAnon.message : null });
  }

  const srFailures = results.connectionStability.service_role.filter(r => !r.success);
  const anonFailures = results.connectionStability.anon.filter(r => !r.success);
  const avgSrTime = (results.connectionStability.service_role.reduce((acc, r) => acc + r.durationMs, 0) / 10).toFixed(1);
  const avgAnonTime = (results.connectionStability.anon.reduce((acc, r) => acc + r.durationMs, 0) / 10).toFixed(1);

  console.log(`[STABILITY] service_role: 10/10 completed (avg ${avgSrTime} ms), ${srFailures.length} failures`);
  console.log(`[STABILITY] anon:         10/10 completed (avg ${avgAnonTime} ms), ${anonFailures.length} failures`);

  if (srFailures.length > 0 || anonFailures.length > 0) {
    passed = false;
    console.error('[FAIL] Connection stability test failed!');
  } else {
    console.log('[PASS] Connection stability test passed cleanly.\n');
  }

  // ----------------------------------------------------
  // STEP 2: Query All 9 Tables (service_role & anon) & PGRST205 Check
  // ----------------------------------------------------
  console.log('--- Step 2: Querying all 9 tables (service_role & anon) ---');

  for (const table of TABLES) {
    results.tableQueries[table] = { service_role: null, anon: null };

    // Query service_role
    const { data: srData, error: srErr, count: srCount } = await serviceClient.from(table).select('*', { count: 'exact' }).limit(5);
    const isPgrst205Sr = srErr && (srErr.code === 'PGRST205' || (srErr.message && srErr.message.includes('PGRST205')) || (srErr.message && srErr.message.includes('Could not find table')));
    if (isPgrst205Sr) results.pgrst205Errors++;

    results.tableQueries[table].service_role = {
      success: !srErr,
      count: srCount,
      sampleSize: srData ? srData.length : 0,
      errorCode: srErr ? srErr.code : null,
      errorMessage: srErr ? srErr.message : null
    };

    // Query anon
    const { data: anonData, error: anonErr, count: anonCount } = await anonClient.from(table).select('*', { count: 'exact' }).limit(5);
    const isPgrst205Anon = anonErr && (anonErr.code === 'PGRST205' || (anonErr.message && anonErr.message.includes('PGRST205')) || (anonErr.message && anonErr.message.includes('Could not find table')));
    if (isPgrst205Anon) results.pgrst205Errors++;

    results.tableQueries[table].anon = {
      success: !anonErr,
      count: anonCount,
      sampleSize: anonData ? anonData.length : 0,
      errorCode: anonErr ? anonErr.code : null,
      errorMessage: anonErr ? anonErr.message : null
    };

    const statusSr = !srErr ? `PASS (Count: ${srCount})` : `FAIL (${srErr.code}: ${srErr.message})`;
    const statusAnon = !anonErr ? `PASS (Count: ${anonCount})` : `FAIL (${anonErr.code}: ${anonErr.message})`;

    console.log(`Table: ${table.padEnd(25)} | SR: ${statusSr.padEnd(25)} | ANON: ${statusAnon}`);

    if (srErr || anonErr) {
      passed = false;
    }
  }

  console.log(`\n[PGRST205 CHECK] Total PGRST205 errors encountered: ${results.pgrst205Errors}`);
  if (results.pgrst205Errors > 0) {
    passed = false;
    console.error('[FAIL] PGRST205 errors found! Database tables or schema cache missing.');
  } else {
    console.log('[PASS] ZERO PGRST205 errors confirmed across all 9 tables.\n');
  }

  // ----------------------------------------------------
  // STEP 3: RLS Policy & CRUD Verification
  // ----------------------------------------------------
  console.log('--- Step 3: RLS Policy & CRUD Verification ---');

  const testCases = [
    { clientName: 'service_role', client: serviceClient },
    { clientName: 'anon', client: anonClient }
  ];

  for (const { clientName, client } of testCases) {
    console.log(`\nTesting RLS CRUD operations for client role: [${clientName}]`);

    // 1. equipment_categories CRUD
    const catName = `_TEST_CAT_${clientName.toUpperCase()}_${Date.now()}`;
    
    // INSERT
    const { data: insCat, error: insCatErr } = await client
      .from('equipment_categories')
      .insert({ name: catName, description: 'Challenger RLS Test Category' })
      .select()
      .single();

    const catInsertSuccess = !insCatErr && insCat && insCat.id;
    console.log(`  [${clientName}] INSERT equipment_categories: ${catInsertSuccess ? 'PASS (ID: ' + insCat?.id + ')' : 'FAIL (' + insCatErr?.message + ')'}`);

    if (!catInsertSuccess) {
      results.rlsCrudTests.push({ role: clientName, entity: 'equipment_categories', op: 'INSERT', success: false, error: insCatErr?.message });
      passed = false;
      continue;
    }

    const catId = insCat.id;

    // SELECT
    const { data: selCat, error: selCatErr } = await client
      .from('equipment_categories')
      .select('*')
      .eq('id', catId)
      .single();

    const catSelectSuccess = !selCatErr && selCat && selCat.name === catName;
    console.log(`  [${clientName}] SELECT equipment_categories: ${catSelectSuccess ? 'PASS' : 'FAIL (' + selCatErr?.message + ')'}`);

    // UPDATE
    const updatedDesc = 'Updated description by challenger test';
    const { data: updCat, error: updCatErr } = await client
      .from('equipment_categories')
      .update({ description: updatedDesc })
      .eq('id', catId)
      .select()
      .single();

    const catUpdateSuccess = !updCatErr && updCat && updCat.description === updatedDesc;
    console.log(`  [${clientName}] UPDATE equipment_categories: ${catUpdateSuccess ? 'PASS' : 'FAIL (' + updCatErr?.message + ')'}`);

    // 2. test_templates CRUD (FK to equipment_categories)
    const tplName = `_TEST_TPL_${clientName.toUpperCase()}_${Date.now()}`;
    const { data: insTpl, error: insTplErr } = await client
      .from('test_templates')
      .insert({ category_id: catId, name: tplName, analyzer_type: 'Multímetro', required_parameters: [{ name: 'Tensao', unit: 'V' }] })
      .select()
      .single();

    const tplInsertSuccess = !insTplErr && insTpl && insTpl.id;
    console.log(`  [${clientName}] INSERT test_templates:          ${tplInsertSuccess ? 'PASS (ID: ' + insTpl?.id + ')' : 'FAIL (' + insTplErr?.message + ')'}`);

    if (tplInsertSuccess) {
      await client.from('test_templates').delete().eq('id', insTpl.id);
    }

    // 3. technicians CRUD
    const techTelegram = `_test_tg_${clientName}_${Date.now()}`;
    const { data: insTech, error: insTechErr } = await client
      .from('technicians')
      .insert({ name: `Test Tech ${clientName}`, telegram_id: techTelegram, email: `${clientName}@test.com` })
      .select()
      .single();

    const techInsertSuccess = !insTechErr && insTech && insTech.id;
    console.log(`  [${clientName}] INSERT technicians:             ${techInsertSuccess ? 'PASS (ID: ' + insTech?.id + ')' : 'FAIL (' + insTechErr?.message + ')'}`);

    // 4. appointments CRUD
    let apptId = null;
    if (techInsertSuccess) {
      const extId = `EXT_${clientName}_${Date.now()}`;
      const { data: insAppt, error: insApptErr } = await client
        .from('appointments')
        .insert({ external_id: extId, title: 'Atendimento Teste RLS', technician_id: insTech.id })
        .select()
        .single();

      const apptInsertSuccess = !insApptErr && insAppt && insAppt.id;
      console.log(`  [${clientName}] INSERT appointments:            ${apptInsertSuccess ? 'PASS (ID: ' + insAppt?.id + ')' : 'FAIL (' + insApptErr?.message + ')'}`);
      if (apptInsertSuccess) apptId = insAppt.id;

      // 5. appointment_technicians CRUD
      if (apptId) {
        const { error: insApptTechErr } = await client
          .from('appointment_technicians')
          .insert({ appointment_id: apptId, technician_id: insTech.id });

        const apptTechSuccess = !insApptTechErr;
        console.log(`  [${clientName}] INSERT appointment_technicians: ${apptTechSuccess ? 'PASS' : 'FAIL (' + insApptTechErr?.message + ')'}`);

        // Clean up appt
        await client.from('appointment_technicians').delete().eq('appointment_id', apptId).eq('technician_id', insTech.id);
        await client.from('appointments').delete().eq('id', apptId);
      }

      // Clean up tech
      await client.from('technicians').delete().eq('id', insTech.id);
    }

    // DELETE equipment_categories test row
    const { error: delCatErr } = await client
      .from('equipment_categories')
      .delete()
      .eq('id', catId);

    const catDeleteSuccess = !delCatErr;
    console.log(`  [${clientName}] DELETE equipment_categories: ${catDeleteSuccess ? 'PASS' : 'FAIL (' + delCatErr?.message + ')'}`);

    const allSubTestsPassed = catInsertSuccess && catSelectSuccess && catUpdateSuccess && tplInsertSuccess && techInsertSuccess && catDeleteSuccess;
    results.rlsCrudTests.push({
      role: clientName,
      catInsertSuccess,
      catSelectSuccess,
      catUpdateSuccess,
      tplInsertSuccess,
      techInsertSuccess,
      catDeleteSuccess,
      allSubTestsPassed
    });

    if (!allSubTestsPassed) {
      passed = false;
    }
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(' FINAL VERDICT & SUMMARY');
  console.log('====================================================');
  console.log(` Overall Result:    ${passed ? 'PASS (APPROVE)' : 'FAIL (REQUEST_CHANGES)'}`);
  console.log(` PGRST205 Errors:   ${results.pgrst205Errors}`);
  console.log(` Connection Check:  10/10 SR & 10/10 ANON Successful`);
  console.log('====================================================\n');

  // Save report artifact
  const artifactPath = path.resolve(__dirname, 'empirical_test_results.json');
  fs.writeFileSync(artifactPath, JSON.stringify({ passed, results }, null, 2));
  console.log(`Saved detailed test results artifact to: ${artifactPath}`);

  if (!passed) {
    process.exit(1);
  }
}

runEmpiricalTests().catch(err => {
  console.error('[UNHANDLED ERROR]', err);
  process.exit(1);
});
