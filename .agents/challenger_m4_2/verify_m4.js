const { spawn } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '../../backend');
const { createClient } = require(path.join(backendDir, 'node_modules/@supabase/supabase-js'));

// Load environment variables from backend/.env
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });


const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}/api`;

async function main() {
  console.log('--- EMPIRICAL TEST SUITE FOR MILESTONE 4 ---');
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  
  // Spawn backend server
  console.log(`Starting Express server on port ${PORT}...`);
  const serverProcess = spawn('node', ['dist/server.js'], {
    cwd: path.resolve(__dirname, '../../backend'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', (d) => { serverOutput += d.toString(); });
  serverProcess.stderr.on('data', (d) => { serverOutput += d.toString(); });

  // Wait for server to start
  await new Promise((res) => setTimeout(res, 3000));

  const results = {
    healthCheck: false,
    statsCheck: false,
    techniciansCheck: false,
    analyzersCheck: false,
    appointmentsCheck: false,
    techMutationCheck: false,
    analyzerMutationCheck: false,
    cleanupSuccess: false,
    details: {}
  };

  try {
    // 0. Healthcheck
    console.log('\n--- 0. Testing GET /health ---');
    const healthRes = await fetch(`http://localhost:${PORT}/health`);
    const healthJson = await healthRes.json();
    console.log('Health response:', healthJson);
    results.healthCheck = healthRes.status === 200 && healthJson.status === 'ok';

    // 1. GET /api/dashboard/stats
    console.log('\n--- 1. Testing GET /api/dashboard/stats ---');
    const statsRes = await fetch(`${BASE_URL}/dashboard/stats`);
    const statsJson = await statsRes.json();
    console.log('Stats response status:', statsRes.status);
    console.log('Stats data:', JSON.stringify(statsJson, null, 2));
    results.statsCheck = statsRes.status === 200 && statsJson.success === true && !!statsJson.stats;
    results.details.stats = statsJson.stats;

    // 2. GET /api/technicians
    console.log('\n--- 2. Testing GET /api/technicians ---');
    const techRes = await fetch(`${BASE_URL}/technicians`);
    const techJson = await techRes.json();
    const techCount = techJson.technicians ? techJson.technicians.length : 0;
    console.log(`Technicians count returned: ${techCount}`);
    results.details.techniciansCount = techCount;
    // Task requires verifying 120 technicians returned
    results.techniciansCheck = techRes.status === 200 && techJson.success === true && techCount >= 120;

    // 3. GET /api/analyzers
    console.log('\n--- 3. Testing GET /api/analyzers ---');
    const anRes = await fetch(`${BASE_URL}/analyzers`);
    const anJson = await anRes.json();
    const anCount = anJson.analyzers ? anJson.analyzers.length : 0;
    console.log(`Analyzers count returned: ${anCount}`);
    results.details.analyzersCount = anCount;
    // Task requires verifying 6 analyzers returned
    results.analyzersCheck = anRes.status === 200 && anJson.success === true && anCount >= 6;

    // 4. GET /api/appointments
    console.log('\n--- 4. Testing GET /api/appointments ---');
    const apptRes = await fetch(`${BASE_URL}/appointments`);
    const apptJson = await apptRes.json();
    const apptCount = apptJson.appointments ? apptJson.appointments.length : 0;
    console.log(`Appointments count returned: ${apptCount}`);
    results.details.appointmentsCount = apptCount;
    // Task requires verifying 1,982 appointments returned
    results.appointmentsCheck = apptRes.status === 200 && apptJson.success === true && apptCount >= 1982;

    // 5. POST /api/technicians (Creation Mutation)
    console.log('\n--- 5. Testing POST /api/technicians ---');
    const testTechPayload = {
      name: 'Técnico Empírico M4',
      phone: '+5511988887777',
      email: 'empirical.m4@atemfield.com',
      role: 'Técnico de Validação',
      avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde'
    };
    const postTechRes = await fetch(`${BASE_URL}/technicians`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testTechPayload)
    });
    const postTechJson = await postTechRes.json();
    console.log('POST technician response:', postTechJson);
    let createdTechId = postTechJson.id;

    if (postTechRes.status === 200 && postTechJson.success && createdTechId) {
      // Confirm mutation directly in Supabase
      const { data: verifyTech, error: verifyTechErr } = await supabaseAdmin
        .from('technicians')
        .select('*')
        .eq('id', createdTechId)
        .single();
      
      if (verifyTech && verifyTech.name === testTechPayload.name) {
        console.log(`✅ Live Supabase mutation confirmed for Technician ID ${createdTechId}:`, verifyTech.name);
        results.techMutationCheck = true;
        results.details.createdTechnician = verifyTech;
      } else {
        console.error('❌ Could not verify created technician in Supabase:', verifyTechErr);
      }
    }

    // 6. POST /api/analyzers (Creation Mutation)
    console.log('\n--- 6. Testing POST /api/analyzers ---');
    const testAnalyzerPayload = {
      asset_tag: `PAT-EMP-${Date.now().toString().slice(-4)}`,
      name: 'Analisador Empírico M4',
      type: 'Analisador de Desfibrilador',
      serial_number: `SN-EMP-${Date.now().toString().slice(-4)}`,
      brand_model: 'Fluke Test Kit',
      notes: 'Criado pelo script de teste empírico Challenger M4'
    };
    const postAnRes = await fetch(`${BASE_URL}/analyzers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testAnalyzerPayload)
    });
    const postAnJson = await postAnRes.json();
    console.log('POST analyzer response:', postAnJson);
    let createdAnalyzerId = postAnJson.id;

    if (postAnRes.status === 200 && postAnJson.success && createdAnalyzerId) {
      // Confirm mutation directly in Supabase
      const { data: verifyAn, error: verifyAnErr } = await supabaseAdmin
        .from('analyzers')
        .select('*')
        .eq('id', createdAnalyzerId)
        .single();

      if (verifyAn && verifyAn.asset_tag === testAnalyzerPayload.asset_tag) {
        console.log(`✅ Live Supabase mutation confirmed for Analyzer ID ${createdAnalyzerId}:`, verifyAn.asset_tag);
        results.analyzerMutationCheck = true;
        results.details.createdAnalyzer = verifyAn;
      } else {
        console.error('❌ Could not verify created analyzer in Supabase:', verifyAnErr);
      }
    }

    // Cleanup created test records
    console.log('\n--- 7. Cleaning up test records from Supabase ---');
    if (createdTechId) {
      const { error: delTechErr } = await supabaseAdmin.from('technicians').delete().eq('id', createdTechId);
      if (!delTechErr) console.log(`Deleted test technician ID ${createdTechId}`);
    }
    if (createdAnalyzerId) {
      const { error: delAnErr } = await supabaseAdmin.from('analyzers').delete().eq('id', createdAnalyzerId);
      if (!delAnErr) console.log(`Deleted test analyzer ID ${createdAnalyzerId}`);
    }
    results.cleanupSuccess = true;

  } catch (err) {
    console.error('Error during empirical test execution:', err);
  } finally {
    serverProcess.kill('SIGTERM');
    console.log('\n--- SUMMARY RESULTS ---');
    console.log(JSON.stringify(results, null, 2));
  }
}

main();
