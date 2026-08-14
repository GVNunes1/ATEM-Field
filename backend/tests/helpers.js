const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = process.env.TEST_API_URL || 'http://127.0.0.1:3001';
const trackedTestData = {
  technicians: new Set(),
  analyzers: new Set(),
  reservations: new Set()
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Configure backend/.env from backend/.env.example.`);
  }
  return value;
}

function trackTechnician(id) {
  if (id !== null && id !== undefined) trackedTestData.technicians.add(id);
}

function trackAnalyzer(id) {
  if (id !== null && id !== undefined) trackedTestData.analyzers.add(id);
}

function trackReservation(id) {
  if (id !== null && id !== undefined) trackedTestData.reservations.add(id);
}

function cleanupLocalTestData() {
  const dbPath = path.resolve(__dirname, '../data/db.json');
  if (!fs.existsSync(dbPath)) return;

  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    let modified = false;

    if (Array.isArray(db.technicians)) {
      const initialCount = db.technicians.length;
      db.technicians = db.technicians.filter((technician) => !technician.name || !technician.name.startsWith('E2E '));
      modified ||= db.technicians.length !== initialCount;
    }

    if (Array.isArray(db.analyzers)) {
      const initialCount = db.analyzers.length;
      db.analyzers = db.analyzers.filter((analyzer) => !analyzer.asset_tag || !analyzer.asset_tag.startsWith('PAT-WF-'));
      modified ||= db.analyzers.length !== initialCount;
    }

    if (Array.isArray(db.reservations)) {
      const initialCount = db.reservations.length;
      db.reservations = db.reservations.filter((reservation) => !reservation.notes || !reservation.notes.includes('E2E'));
      modified ||= db.reservations.length !== initialCount;
    }

    if (modified) {
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      console.log('✔ Removed temporary E2E data from local db.json.');
    }
  } catch (error) {
    throw new Error(`Could not clean local E2E data: ${error.message}`);
  }
}

async function findIds(client, table, column, pattern) {
  const { data, error } = await client.from(table).select('id').ilike(column, pattern);
  if (error) throw new Error(`Could not identify E2E rows in ${table}: ${error.message}`);
  return (data || []).map((row) => row.id);
}

async function deleteIds(client, table, column, ids) {
  const uniqueIds = [...new Set(ids)].filter((id) => id !== null && id !== undefined);
  if (uniqueIds.length === 0) return;

  const { error } = await client.from(table).delete().in(column, uniqueIds);
  if (error) throw new Error(`Could not remove E2E rows from ${table}: ${error.message}`);
}

/**
 * Removes only rows created by the E2E suite. The markers are deliberately
 * narrow so that normal production records are never selected for deletion.
 */
async function cleanupRemoteTestData() {
  const client = getSupabaseClient();
  const technicianIds = new Set([
    ...trackedTestData.technicians,
    ...(await findIds(client, 'technicians', 'name', 'E2E %'))
  ]);
  const analyzerIds = new Set([
    ...trackedTestData.analyzers,
    ...(await findIds(client, 'analyzers', 'asset_tag', 'PAT-WF-%'))
  ]);
  const reservationIds = new Set([
    ...trackedTestData.reservations,
    ...(await findIds(client, 'reservations', 'notes', '%E2E%'))
  ]);

  for (const technicianId of technicianIds) {
    const { data, error } = await client.from('reservations').select('id').eq('technician_id', technicianId);
    if (error) throw new Error(`Could not identify E2E technician reservations: ${error.message}`);
    for (const reservation of data || []) reservationIds.add(reservation.id);
  }

  for (const analyzerId of analyzerIds) {
    const { data, error } = await client.from('reservations').select('id').eq('analyzer_id', analyzerId);
    if (error) throw new Error(`Could not identify E2E analyzer reservations: ${error.message}`);
    for (const reservation of data || []) reservationIds.add(reservation.id);
  }

  await deleteIds(client, 'reservations', 'id', [...reservationIds]);
  await deleteIds(client, 'notification_logs', 'technician_id', [...technicianIds]);
  await deleteIds(client, 'appointment_technicians', 'technician_id', [...technicianIds]);
  await deleteIds(client, 'analyzers', 'id', [...analyzerIds]);
  await deleteIds(client, 'technicians', 'id', [...technicianIds]);

  trackedTestData.technicians.clear();
  trackedTestData.analyzers.clear();
  trackedTestData.reservations.clear();
}

async function cleanupTestData() {
  cleanupLocalTestData();
  await cleanupRemoteTestData();
}

async function ensureServerRunning() {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      console.log('✔ Backend server is already running on port 3001.');
      return null;
    }
  } catch (_error) {
    // The test runner starts the server below when it is not already available.
  }

  const backendDir = path.resolve(__dirname, '..');
  const distServerPath = path.join(backendDir, 'dist', 'server.js');

  if (!fs.existsSync(distServerPath)) {
    console.log('Compiling TypeScript backend before running E2E tests...');
    execSync('npm.cmd run build', { cwd: backendDir, stdio: 'inherit' });
  }

  console.log('Starting backend server process for E2E tests...');
  const serverProcess = spawn(process.execPath, [distServerPath], {
    cwd: backendDir,
    env: { ...process.env, PORT: '3001' }
  });

  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        console.log('✔ Backend server initialized and responding on port 3001.');
        return serverProcess;
      }
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  serverProcess.kill();
  throw new Error('Timed out waiting for backend server to respond on /health');
}

function stopServer(serverProcess) {
  if (serverProcess) {
    console.log('Stopping spawned backend server process...');
    serverProcess.kill();
  }
}

async function apiFetch(endpointPath, options = {}) {
  const url = `${BASE_URL}${endpointPath}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const config = { ...options, headers };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

function getSupabaseClient() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message || `Expected ${expected}, but got ${actual}`);
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) throw new Error(message || 'Expected value to not be null or undefined');
}

function isNonTechnicalAppointment(appointment) {
  if (!appointment) return false;
  const title = (appointment.title || '').trim();
  const clientName = (appointment.client_name || '').trim();
  const rawText = `${title} ${clientName}`;
  const text = rawText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!text) return false;

  const isSobreaviso = text.includes('sobreaviso') || text.includes('sobre aviso') || text.includes('sobraviso') || text.includes('sobra aviso');
  const isExamePeriodico = text.includes('periodic') || (text.includes('exame') && (text.includes('periodi') || text.includes('medico')));
  const isAniversario = text.includes('aniversario');
  const isRevisao = text.includes('revisao');
  const isTreinamento = text.includes('treinamento');
  const isHoliday = text.includes('confratenizacao') || text.includes('carnaval') || text.includes('corpus christi');

  return isSobreaviso || isExamePeriodico || isAniversario || isRevisao || isTreinamento || isHoliday;
}

module.exports = {
  BASE_URL,
  cleanupTestData,
  ensureServerRunning,
  stopServer,
  apiFetch,
  getSupabaseClient,
  trackTechnician,
  trackAnalyzer,
  trackReservation,
  isNonTechnicalAppointment,
  assert,
  assertEqual,
  assertNotNull
};
