const { createClient } = require('../../backend/node_modules/@supabase/supabase-js');

const SUPABASE_URL = 'https://aorclbawxpjgrbdrcith.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY || !SERVICE_KEY.trim()) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in the process environment before running this script.');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function runTests() {
  console.log('=== EMPIRICAL CHALLENGE TEST SUITE FOR M1 SCHEMA ===\n');

  let passed = 0;
  let failed = 0;
  const testResults = [];

  function record(testName, success, details) {
    if (success) {
      passed++;
      console.log(`[PASS] ${testName}`);
    } else {
      failed++;
      console.error(`[FAIL] ${testName}: ${details}`);
    }
    testResults.push({ testName, success, details });
  }

  // Helper to cleanup temporary test data
  async function cleanup() {
    console.log('\n--- Cleaning up test artifacts ---');
    await supabase.from('reservations').delete().ilike('notes', '%TEST_HARNESS%');
    await supabase.from('notification_logs').delete().ilike('message', '%TEST_HARNESS%');
    await supabase.from('appointment_equipments').delete().ilike('model', '%TEST_HARNESS%');
    await supabase.from('appointment_technicians').delete().gte('appointment_id', 990000);
    await supabase.from('test_templates').delete().ilike('name', '%TEST_HARNESS%');
    await supabase.from('analyzers').delete().ilike('asset_tag', '%TEST_PAT_%');
    await supabase.from('appointments').delete().ilike('external_id', '%TEST_EXT_%');
    await supabase.from('technicians').delete().ilike('telegram_id', '%TEST_TG_%');
    await supabase.from('equipment_categories').delete().ilike('name', '%TEST_CAT_%');
  }

  await cleanup();

  try {
    // -------------------------------------------------------------
    // Test 1: Explicit PK Insertion into equipment_categories
    // -------------------------------------------------------------
    console.log('\n--- Test 1: Explicit PK insertion ---');
    const explicitCatId = 999901;
    const { data: cat1, error: err1 } = await supabase
      .from('equipment_categories')
      .insert({ id: explicitCatId, name: 'TEST_CAT_EXPLICIT_PK_1', description: 'Explicit PK test' })
      .select();

    if (err1) {
      record('Explicit PK insertion into equipment_categories', false, err1.message);
    } else if (cat1 && cat1[0].id === explicitCatId) {
      record('Explicit PK insertion into equipment_categories', true, `Inserted id=${cat1[0].id}`);
    } else {
      record('Explicit PK insertion into equipment_categories', false, 'Unexpected return data');
    }

    // -------------------------------------------------------------
    // Test 2: Foreign Key Constraint Enforcement - Invalid category_id in analyzers
    // -------------------------------------------------------------
    console.log('\n--- Test 2: FK Constraint - Invalid category_id in analyzers ---');
    const { data: anzInvalid, error: errFK1 } = await supabase
      .from('analyzers')
      .insert({
        asset_tag: 'TEST_PAT_INVALID_FK',
        name: 'Invalid FK Analyzer',
        category_id: 88888888 // non-existent category
      })
      .select();

    if (errFK1 && (errFK1.code === '23503' || errFK1.message.includes('foreign key constraint'))) {
      record('FK Constraint: Invalid category_id in analyzers blocked', true, `Correctly rejected: ${errFK1.message}`);
    } else {
      record('FK Constraint: Invalid category_id in analyzers blocked', false, `Expected FK error but got: ${JSON.stringify(errFK1 || anzInvalid)}`);
      // cleanup if inserted
      if (anzInvalid) await supabase.from('analyzers').delete().eq('asset_tag', 'TEST_PAT_INVALID_FK');
    }

    // -------------------------------------------------------------
    // Test 3: Foreign Key Constraint Enforcement - Invalid category_id in test_templates
    // -------------------------------------------------------------
    console.log('\n--- Test 3: FK Constraint - Invalid category_id in test_templates ---');
    const { data: tplInvalid, error: errFK2 } = await supabase
      .from('test_templates')
      .insert({
        name: 'TEST_HARNESS_INVALID_FK',
        category_id: 88888888
      })
      .select();

    if (errFK2 && (errFK2.code === '23503' || errFK2.message.includes('foreign key constraint'))) {
      record('FK Constraint: Invalid category_id in test_templates blocked', true, `Correctly rejected: ${errFK2.message}`);
    } else {
      record('FK Constraint: Invalid category_id in test_templates blocked', false, `Expected FK error but got: ${JSON.stringify(errFK2 || tplInvalid)}`);
      if (tplInvalid) await supabase.from('test_templates').delete().eq('name', 'TEST_HARNESS_INVALID_FK');
    }

    // -------------------------------------------------------------
    // Test 4: Foreign Key Constraint Enforcement - Invalid technician_id in reservations
    // -------------------------------------------------------------
    console.log('\n--- Test 4: FK Constraint - Invalid technician_id in reservations ---');
    const { data: resInvalid, error: errFK3 } = await supabase
      .from('reservations')
      .insert({
        technician_id: 88888888,
        notes: 'TEST_HARNESS_INVALID_TECH'
      })
      .select();

    if (errFK3 && (errFK3.code === '23503' || errFK3.message.includes('foreign key constraint'))) {
      record('FK Constraint: Invalid technician_id in reservations blocked', true, `Correctly rejected: ${errFK3.message}`);
    } else {
      record('FK Constraint: Invalid technician_id in reservations blocked', false, `Expected FK error but got: ${JSON.stringify(errFK3 || resInvalid)}`);
      if (resInvalid) await supabase.from('reservations').delete().eq('notes', 'TEST_HARNESS_INVALID_TECH');
    }

    // -------------------------------------------------------------
    // Test 5: Unique Constraint - technicians.telegram_id
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Unique Constraint - technicians.telegram_id ---');
    const { data: tech1, error: techErr1 } = await supabase
      .from('technicians')
      .insert({ name: 'Tech Unique 1', telegram_id: 'TEST_TG_UNIQUE_123' })
      .select();

    if (techErr1) {
      record('Unique Constraint: Create first tech', false, techErr1.message);
    } else {
      const { data: tech2, error: techErr2 } = await supabase
        .from('technicians')
        .insert({ name: 'Tech Unique 2', telegram_id: 'TEST_TG_UNIQUE_123' })
        .select();

      if (techErr2 && (techErr2.code === '23505' || techErr2.message.includes('unique constraint'))) {
        record('Unique Constraint: Duplicate telegram_id blocked', true, `Correctly rejected: ${techErr2.message}`);
      } else {
        record('Unique Constraint: Duplicate telegram_id blocked', false, `Expected unique constraint error but got: ${JSON.stringify(techErr2 || tech2)}`);
      }
    }

    // -------------------------------------------------------------
    // Test 6: Unique Constraint - equipment_categories.name
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Unique Constraint - equipment_categories.name ---');
    const { data: catDup1, error: catDupErr1 } = await supabase
      .from('equipment_categories')
      .insert({ name: 'TEST_CAT_UNIQUE_NAME' })
      .select();

    if (catDupErr1) {
      record('Unique Constraint: Create category', false, catDupErr1.message);
    } else {
      const { data: catDup2, error: catDupErr2 } = await supabase
        .from('equipment_categories')
        .insert({ name: 'TEST_CAT_UNIQUE_NAME' })
        .select();

      if (catDupErr2 && (catDupErr2.code === '23505' || catDupErr2.message.includes('unique constraint'))) {
        record('Unique Constraint: Duplicate category name blocked', true, `Correctly rejected: ${catDupErr2.message}`);
      } else {
        record('Unique Constraint: Duplicate category name blocked', false, `Expected unique error but got: ${JSON.stringify(catDupErr2 || catDup2)}`);
      }
    }

    // -------------------------------------------------------------
    // Test 7: ON DELETE CASCADE & SET NULL Behavior
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Cascade and SET NULL behavior ---');
    // Create Category, Analyzer, Test Template
    const { data: parentCat } = await supabase
      .from('equipment_categories')
      .insert({ name: 'TEST_CAT_CASCADE_PARENT' })
      .select();
    
    const catId = parentCat[0].id;

    // Analyzer references Category (ON DELETE SET NULL)
    const { data: childAnz } = await supabase
      .from('analyzers')
      .insert({ asset_tag: 'TEST_PAT_CASCADE_1', name: 'Cascade Anz', category_id: catId })
      .select();

    // Template references Category (ON DELETE CASCADE)
    const { data: childTpl } = await supabase
      .from('test_templates')
      .insert({ name: 'TEST_HARNESS_CASCADE_TPL', category_id: catId })
      .select();

    // Now delete parent category
    await supabase.from('equipment_categories').delete().eq('id', catId);

    // Verify analyzer has category_id SET NULL
    const { data: checkAnz } = await supabase.from('analyzers').select('*').eq('id', childAnz[0].id);
    if (checkAnz && checkAnz.length > 0 && checkAnz[0].category_id === null) {
      record('ON DELETE SET NULL: analyzers.category_id set to null on category deletion', true, 'category_id is null');
    } else {
      record('ON DELETE SET NULL: analyzers.category_id set to null on category deletion', false, `Analyzer record state: ${JSON.stringify(checkAnz)}`);
    }

    // Verify template was CASCADE deleted
    const { data: checkTpl } = await supabase.from('test_templates').select('*').eq('id', childTpl[0].id);
    if (checkTpl && checkTpl.length === 0) {
      record('ON DELETE CASCADE: test_templates row deleted on category deletion', true, 'test_template deleted');
    } else {
      record('ON DELETE CASCADE: test_templates row deleted on category deletion', false, `Template still exists: ${JSON.stringify(checkTpl)}`);
    }

    // -------------------------------------------------------------
    // Test 8: Sequence behavior when inserting without explicit PK after explicit PK insert
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Auto-increment sequence behavior after explicit PK ---');
    const { data: autoCat, error: autoErr } = await supabase
      .from('equipment_categories')
      .insert({ name: 'TEST_CAT_AUTO_INCREMENT' })
      .select();

    if (autoErr) {
      record('Auto-increment after explicit PK insert', false, `Failed: ${autoErr.message}`);
    } else {
      record('Auto-increment after explicit PK insert', true, `Generated id=${autoCat[0].id}`);
    }

    // -------------------------------------------------------------
    // Test 9: Test Junction table appointment_technicians
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Junction table appointment_technicians composite PK & FKs ---');
    const { data: testTech } = await supabase.from('technicians').insert({ name: 'Junction Tech', telegram_id: 'TEST_TG_JUNC' }).select();
    const { data: testAppt } = await supabase.from('appointments').insert({ title: 'Junction Appt', external_id: 'TEST_EXT_JUNC' }).select();

    if (testTech && testAppt) {
      const techId = testTech[0].id;
      const apptId = testAppt[0].id;

      // Insert into appointment_technicians
      const { error: juncErr } = await supabase.from('appointment_technicians').insert({ appointment_id: apptId, technician_id: techId });
      if (juncErr) {
        record('Junction insert valid row', false, juncErr.message);
      } else {
        record('Junction insert valid row', true, `Inserted (${apptId}, ${techId})`);

        // Test duplicate composite primary key
        const { error: juncDupErr } = await supabase.from('appointment_technicians').insert({ appointment_id: apptId, technician_id: techId });
        if (juncDupErr && (juncDupErr.code === '23505' || juncDupErr.message.includes('primary key') || juncDupErr.message.includes('unique'))) {
          record('Junction composite PK duplicate blocked', true, `Blocked: ${juncDupErr.message}`);
        } else {
          record('Junction composite PK duplicate blocked', false, `Expected duplicate PK error, got ${JSON.stringify(juncDupErr)}`);
        }
      }
    } else {
      record('Junction test setup', false, 'Failed to create tech/appt for junction test');
    }

  } catch (err) {
    console.error('Unhandled exception in test harness:', err);
  } finally {
    await cleanup();
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);
  }
}

runTests();
