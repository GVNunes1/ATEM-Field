const { spawn } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '../../backend');
const { createClient } = require(path.join(backendDir, 'node_modules/@supabase/supabase-js'));

// Load environment variables from backend/.env
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PORT = 3098;
const BASE_URL = `http://localhost:${PORT}/api`;

async function main() {
  console.log('--- COMPREHENSIVE STRESS TEST SUITE FOR MILESTONE 4 ---');
  
  const serverProcess = spawn('node', ['dist/server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((res) => setTimeout(res, 3000));

  const stressResults = {
    missingFieldsTechCheck: false,
    duplicateAssetTagCheck: false,
    notFoundChecklistCheck: false,
    notFoundReservationCheck: false,
    categoriesEndpointCheck: false,
    reservationsEndpointCheck: false
  };

  try {
    // 1. Missing required fields in POST /api/technicians
    console.log('\n--- Stress Test 1: Missing required fields in POST /api/technicians ---');
    const badTechRes = await fetch(`${BASE_URL}/technicians`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }) // missing name/phone
    });
    const badTechJson = await badTechRes.json();
    console.log('Missing fields response:', badTechRes.status, badTechJson);
    stressResults.missingFieldsTechCheck = badTechRes.status === 400 && badTechJson.success === false;

    // 2. Duplicate asset_tag in POST /api/analyzers
    console.log('\n--- Stress Test 2: Duplicate asset_tag in POST /api/analyzers ---');
    const dupAnRes = await fetch(`${BASE_URL}/analyzers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_tag: 'PAT-104050', // Existing analyzer asset tag
        name: 'Duplicate Test',
        type: 'Analisador de Desfibrilador',
        serial_number: 'SN-DUP-1'
      })
    });
    const dupAnJson = await dupAnRes.json();
    console.log('Duplicate asset_tag response:', dupAnRes.status, dupAnJson);
    stressResults.duplicateAssetTagCheck = dupAnRes.status === 400 && dupAnJson.success === false;

    // 3. GET /api/appointments/99999999/checklist (Non-existent ID)
    console.log('\n--- Stress Test 3: Checklist for non-existent appointment ---');
    const notFoundChecklistRes = await fetch(`${BASE_URL}/appointments/99999999/checklist`);
    const notFoundChecklistJson = await notFoundChecklistRes.json();
    console.log('Non-existent checklist response:', notFoundChecklistRes.status, notFoundChecklistJson);
    stressResults.notFoundChecklistCheck = notFoundChecklistRes.status === 404 && notFoundChecklistJson.success === false;

    // 4. POST /api/reservations (Non-existent appointment ID)
    console.log('\n--- Stress Test 4: Reservation for non-existent appointment ---');
    const badResRes = await fetch(`${BASE_URL}/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointment_id: 99999999,
        analyzer_id: 1,
        technician_id: 1
      })
    });
    const badResJson = await badResRes.json();
    console.log('Non-existent appointment reservation response:', badResRes.status, badResJson);
    stressResults.notFoundReservationCheck = badResRes.status === 404 && badResJson.success === false;

    // 5. GET /api/categories
    console.log('\n--- Stress Test 5: GET /api/categories ---');
    const catRes = await fetch(`${BASE_URL}/categories`);
    const catJson = await catRes.json();
    console.log('Categories count returned:', catJson.categories ? catJson.categories.length : 0);
    stressResults.categoriesEndpointCheck = catRes.status === 200 && catJson.success === true && catJson.categories.length >= 7;

    // 6. GET /api/reservations
    console.log('\n--- Stress Test 6: GET /api/reservations ---');
    const resRes = await fetch(`${BASE_URL}/reservations`);
    const resJson = await resRes.json();
    console.log('Reservations count returned:', resJson.reservations ? resJson.reservations.length : 0);
    stressResults.reservationsEndpointCheck = resRes.status === 200 && resJson.success === true;

  } catch (err) {
    console.error('Error during stress tests:', err);
  } finally {
    serverProcess.kill('SIGTERM');
    console.log('\n--- STRESS TEST SUMMARY RESULTS ---');
    console.log(JSON.stringify(stressResults, null, 2));
  }
}

main();
