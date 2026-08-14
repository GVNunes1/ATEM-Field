const { apiFetch, getSupabaseClient, assert, assertEqual, assertNotNull } = require('./helpers');

async function runTier1Tests() {
  const results = [];
  const record = (name, passed, detail = '') => results.push({ name, passed, detail });

  try {
    const client = getSupabaseClient();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey, 'Supabase environment variables must be configured for E2E tests');

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
      const { error, status } = await client.from(table).select('*').limit(1);
      const restResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`
        }
      });
      assert(!error || status === 200 || restResponse.status === 200 || restResponse.status === 206, `Supabase table is not accessible: ${table}`);
    }

    record('Supabase Tables & Schema Accessibility', true, `Checked ${tables.length} tables through the client and REST API`);
  } catch (error) {
    record('Supabase Tables & Schema Accessibility', false, error.message);
  }

  try {
    const response = await apiFetch('/api/dashboard/stats');
    assertEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    assert(response.data.success === true, 'Expected success: true');
    assertNotNull(response.data.stats, 'Expected stats object');

    const { totalAnalyzers, availableAnalyzers, reservedAnalyzers, activeTechnicians, todayAppointments } = response.data.stats;
    assert(typeof availableAnalyzers === 'number', 'Expected availableAnalyzers to be a number');
    assert(typeof reservedAnalyzers === 'number', 'Expected reservedAnalyzers to be a number');
    const client = getSupabaseClient();
    const [{ count: expectedActiveTechnicians, error: countError }, { count: expectedAnalyzers, error: analyzerCountError }] = await Promise.all([
      client.from('technicians').select('id', { count: 'exact', head: true }).eq('status', 'Ativo'),
      client.from('analyzers').select('id', { count: 'exact', head: true })
    ]);
    assert(!countError, `Could not count active technicians: ${countError?.message}`);
    assert(!analyzerCountError, `Could not count analyzers: ${analyzerCountError?.message}`);
    assertEqual(totalAnalyzers, expectedAnalyzers, `Expected totalAnalyzers to match Supabase (${expectedAnalyzers}), got ${totalAnalyzers}`);
    assertEqual(activeTechnicians, expectedActiveTechnicians, `Expected activeTechnicians to match Supabase (${expectedActiveTechnicians}), got ${activeTechnicians}`);
    assert(typeof todayAppointments === 'number', 'Expected todayAppointments to be a number');
    record('/api/dashboard/stats returns valid metrics', true, `totalAnalyzers: ${totalAnalyzers}, activeTechnicians: ${activeTechnicians}`);
  } catch (error) {
    record('/api/dashboard/stats returns valid metrics', false, error.message);
  }

  try {
    const response = await apiFetch('/api/technicians');
    assertEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    assert(response.data.success === true, 'Expected success: true');
    assert(Array.isArray(response.data.technicians), 'Expected technicians array');
    assert(response.data.technicians.length > 0, 'Expected at least one technician');
    const corruptedPattern = /(teams\.microsoft|meetup-join|meetingoptions|organizerid|passcode|dialin\.|@thread|confidential and legally protected)/i;
    const corrupted = response.data.technicians.filter(technician => corruptedPattern.test(technician.name || ''));
    assertEqual(corrupted.length, 0, `Expected no corrupted calendar fragments, got ${corrupted.length}`);
    record('/api/technicians returns a clean technician list', true, `Returned ${response.data.technicians.length} valid technicians`);
  } catch (error) {
    record('/api/technicians returns a clean technician list', false, error.message);
  }

  try {
    const response = await apiFetch('/api/analyzers');
    assertEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    assert(response.data.success === true, 'Expected success: true');
    assert(Array.isArray(response.data.analyzers), 'Expected analyzers array');
    const client = getSupabaseClient();
    const { count: expectedAnalyzers, error: countError } = await client.from('analyzers').select('id', { count: 'exact', head: true });
    assert(!countError, `Could not count analyzers: ${countError?.message}`);
    assertEqual(response.data.analyzers.length, expectedAnalyzers, `Expected ${expectedAnalyzers} analyzers, got ${response.data.analyzers.length}`);
    record('/api/analyzers returns the complete inventory', true, `Returned ${response.data.analyzers.length} analyzers`);
  } catch (error) {
    record('/api/analyzers returns the complete inventory', false, error.message);
  }

  try {
    const response = await apiFetch('/api/appointments');
    assertEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    assert(response.data.success === true, 'Expected success: true');
    assert(Array.isArray(response.data.appointments), 'Expected appointments array');
    assert(response.data.appointments.length > 0, 'Expected at least one appointment');
    record('/api/appointments returns synchronized data', true, `Returned ${response.data.appointments.length} appointments`);
  } catch (error) {
    record('/api/appointments returns synchronized data', false, error.message);
  }

  return results;
}

module.exports = { runTier1Tests };
