const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.JWT_SECRET = 'isolated-security-fixture-signing-secret';
process.env.TECHNICIAN_PORTAL_SECRET = 'isolated-portal-fixture-signing-secret';
process.env.BCRYPT_SALT_ROUNDS = '4';
const tables = {};
let mutations = [], rpcCalls = [], nextId = 100;
const client = {
  from(table) {
    let filters = [], columns = '*', mode = 'read', values, start = 0, head = false;
    const query = {
      select(v = '*', options) { columns = v; head = Boolean(options?.head); return query; },
      eq(key, value) { filters.push(row => String(row[key]) === String(value)); return query; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      gte() { return query; }, lte() { return query; }, not() { return query; },
      order() { return query; }, limit() { return query; },
      range(value) { start = value; return query; },
      insert(value) { mode = 'insert'; values = value; return query; },
      update(value) { mode = 'update'; values = value; return query; },
      delete() { mode = 'delete'; return query; },
      maybeSingle() { return execute(true); }, single() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    async function execute(single) {
      let rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      if (mode !== 'read') {
        mutations.push({ table, mode, values });
        if (mode === 'insert') { rows = [{ id: nextId++, ...values }]; (tables[table] ||= []).push(...rows); }
        if (mode === 'update') rows.forEach(row => Object.assign(row, values));
        if (mode === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
      }
      const count = rows.length;
      if (start) rows = [];
      if (columns !== '*') rows = rows.map(row => Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, row[key]])));
      return { data: head ? null : single ? rows[0] || null : structuredClone(rows), error: null, count };
    }
    return query;
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'upgrade_login_pin') {
      const row = tables[args.target_table].find(row => row.id === args.profile_id && row.pin === args.expected_pin);
      if (!row) return { error: new Error('concurrent reset fixture') };
      row.pin = args.hashed_pin;
    }
    return { data: null, error: null };
  },
};
const modulePath = require.resolve('../dist/services/supabase');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { supabaseAdmin: client } };
const { AuthService, CryptoService } = require('../dist/security/authService');
const { migrateLoginPins, hashLoginPin } = require('../dist/security/loginPins');
const { getTechnicianPortalData, createTechnicianPortalAccess } = require('../dist/services/telegramDashboard');
// Optional negative replay compiles the immutable original API in memory. It
// uses the same isolated fixtures and cannot initialize a live DB client.
let router;
if (process.env.SECURITY_BASELINE_REPLAY === 'true') {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const Module = require('node:module');
  const ts = require('typescript');
  const source = execFileSync('git', ['show', 'HEAD:backend/src/routes/api.ts'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' });
  const filename = require.resolve('../dist/routes/api');
  const original = new Module(filename, module); original.filename = filename; original.paths = Module._nodeModulePaths(path.dirname(filename));
  original._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
  router = original.exports.default;
} else router = require('../dist/routes/api').default;
let server, base, admin, technician, other, manager;
const call = async (route, method = 'GET', token, body, headers = {}) => {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
before(async () => {
  const hash = await CryptoService.hashSecret('8246');
  tables.technicians = [
    { id: 77, name: 'Fixture', role: 'Técnico de Campo', status: 'Ativo', phone: '11999995555', pin: hash },
    { id: 78, name: 'Other Fixture', role: 'Técnico de Campo', status: 'Ativo', pin: hash },
    { id: 79, name: 'Manager Fixture', role: 'Gerente', status: 'Ativo', pin: hash },
  ];
  tables.app_credentials = [{ id: 1, username: 'admin', pin: hash }, { id: 2, username: 'fixture', technician_id: 77, pin: hash }];
  tables.appointments = [{ id: 10, title: 'Manutenção', client_name: 'Private client', technician_id: 77,
    appointment_date: '2026-10-20', google_event: { attendees: [{ email: 'secret@fixture.invalid' }], description: 'meeting-secret' },
    google_etag: 'private-etag', google_sync_conflict: { summary: 'Compared title', description: 'meeting-secret', attendees: ['private'], start: { date: '2026-10-20' } } }];
  tables.reservations = [{ id: 44, analyzer_id: 1, technician_id: 77, appointment_id: 10, status: 'Reservado', reserved_date: '2026-10-20', notes: 'Private note' }];
  tables.analyzers = [{ id: 1, name: 'Fixture analyzer', asset_tag: 'FIX-1', type: 'Fixture', status: 'Disponível', notes: 'Private maintenance note' }];
  tables.equipment_categories = [{ id: 1, name: 'Fixture category' }];
  tables.appointment_technicians = [];
  tables.appointment_equipments = [];
  tables.notification_logs = [{ id: 1, message: 'Private message' }];
  admin = AuthService.generateSessionToken({ id: 0, name: 'Admin', role: 'admin' });
  technician = AuthService.generateSessionToken({ id: 77, name: 'Fixture', role: 'technician' });
  other = AuthService.generateSessionToken({ id: 78, name: 'Other', role: 'technician' });
  manager = AuthService.generateSessionToken({ id: 79, name: 'Manager', role: 'manager' });
  const app = express(); app.use(express.json()); app.use('/api', router);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test('all formerly public mutations reject anonymous users and ordinary technicians before database mutation', async () => {
  const routes = [['POST','/categories/templates'],['POST','/analyzers'],['PATCH','/analyzers/1'],['DELETE','/analyzers/1'],['POST','/reservations/44/approve'],['PATCH','/reservations/44'],['DELETE','/reservations/44']];
  mutations = [];
  for (const [method, route] of routes) {
    assert.equal((await call(route, method, undefined, {})).status, 401, route);
    assert.equal((await call(route, method, technician, {})).status, 403, route);
  }
  assert.equal(mutations.length, 0);
  const response = await call('/categories/templates', 'POST', manager, { category_id: 1, analyzer_type: 'Fixture', required_parameters: ['voltage'] });
  assert.equal(response.status, 200);
  assert.ok(mutations.some(row => row.table === 'test_templates'));
});

test('portal links require owner or management; portal capability cannot access full app', async () => {
  assert.equal((await call('/technicians/77/portal-link')).status, 401);
  assert.equal((await call('/technicians/77/portal-link', 'GET', other)).status, 403);
  assert.equal((await call('/technicians/77/portal-link', 'GET', technician)).status, 200);
  assert.equal((await call('/technicians/77/portal-link', 'GET', manager)).status, 200);
  const portalToken = createTechnicianPortalAccess(77);
  assert.equal((await call('/credentials', 'GET', portalToken)).status, 401);
  const dashboard = await call('/technician-portal', 'GET', portalToken);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.technician.pin, undefined);
  assert.equal(dashboard.body.technician.phone, undefined);
  assert.ok(!JSON.stringify(dashboard.body).includes('meeting-secret'));
});

test('configured bcrypt PIN remains valid; phone suffix, shared defaults and legacy plaintext fail', async () => {
  for (const pin of ['5555', '3247', '1234', '6233', '0000', '', '8246wrong']) {
    assert.equal((await call('/auth/login', 'POST', undefined, { type: 'technician', technician_id: 77, pin })).status, 401, pin);
  }
  const signed = await call('/auth/login', 'POST', undefined, { type: 'technician', technician_id: 77, pin: '8246' });
  assert.equal(signed.status, 200); assert.equal(AuthService.verifySessionToken(signed.body.token).sub, '77');
  assert.equal((await call('/auth/admin-login', 'POST', undefined, { pin: '8246' })).status, 200);
  assert.equal((await call('/auth/login', 'POST', undefined, { type: 'admin', pin: '8246' })).status, 200);
  const saved = tables.technicians[0].pin; tables.technicians[0].pin = '8246';
  try { assert.equal((await call('/auth/login', 'POST', undefined, { type: 'technician', technician_id: 77, pin: '8246' })).status, 401); }
  finally { tables.technicians[0].pin = saved; }
});

test('PIN creation and reset persist hashes in both account copies and never return the secret or hash', async () => {
  const created = await call('/credentials', 'POST', admin, { display_name: 'New fixture', username: 'newfixture', user_type: 'technician', pin: '9156' });
  assert.equal(created.status, 200); assert.equal(created.body.credential.pin, undefined); assert.equal(created.body.credential.has_pin, true);
  const credential = tables.app_credentials.find(row => row.username === 'newfixture');
  assert.notEqual(credential.pin, '9156'); assert.equal(await CryptoService.verifySecret('9156', credential.pin), true);
  assert.equal(tables.technicians.find(row => row.id === credential.technician_id).pin, credential.pin);
  const reset = await call(`/credentials/${credential.id}`, 'PATCH', admin, { pin: '9278' });
  assert.equal(reset.status, 200); assert.equal(reset.body.credential.pin, undefined);
  assert.equal(await CryptoService.verifySecret('9278', tables.technicians.find(row => row.id === credential.technician_id).pin), true);
  for (const route of ['/credentials', '/technicians']) {
    const result = await call(route, 'GET', admin);
    assert.equal(result.status, 200); assert.ok(!JSON.stringify(result.body).includes('$2')); assert.ok(!JSON.stringify(result.body).includes('9156'));
  }
  assert.equal((await call('/credentials', 'POST', admin, { display_name: 'Invalid', pin: 'a'.repeat(73) })).status, 400);
  assert.equal((await call('/credentials/2', 'DELETE', admin)).status, 200);
  assert.deepEqual(rpcCalls.at(-1), { name: 'revoke_app_credential', args: { credential_id: 2 } });
  assert.equal((await call('/credentials/1', 'DELETE', admin)).status, 400);
});

test('private reads require authentication, kiosk availability is minimal, malformed sessions fail closed', async () => {
  for (const route of ['/appointments/10/checklist', '/notifications/logs']) assert.equal((await call(route)).status, 401);
  assert.equal((await call('/appointments/10/checklist', 'GET', other)).status, 403);
  assert.equal((await call('/notifications/logs', 'GET', technician)).status, 403);
  assert.equal((await call('/analyzers', 'GET', 'malformed')).status, 401);
  for (const route of ['/reservations', '/analyzers', '/dashboard/stats', '/technicians']) {
    const result = await call(route); assert.equal(result.status, 200, route);
    const json = JSON.stringify(result.body);
    for (const privateValue of ['Private note', 'Private client', '11999995555', 'Private maintenance note', '$2']) assert.ok(!json.includes(privateValue), `${route}: ${privateValue}`);
  }
  assert.equal((await call('/reservations', 'GET', technician)).body.reservations[0].technician_phone, '11999995555');
});

test('raw calendar payload and delegated profile secrets are absent in both appointment branches and empty portals', async () => {
  for (const title of ['Manutenção', 'Treinamento']) {
    tables.appointments[0].title = title;
    const checklist = await call('/appointments/10/checklist', 'GET', technician);
    assert.equal(checklist.status, 200);
    assert.equal(checklist.body.appointment.google_event, undefined);
    assert.equal(checklist.body.appointment.google_etag, undefined);
    assert.equal(checklist.body.appointment.google_sync_conflict.summary, 'Compared title');
    const portal = await getTechnicianPortalData(tables.technicians[0]);
    assert.equal(portal.technician.pin, undefined);
    assert.ok(!JSON.stringify(portal).includes('meeting-secret'));
  }
  const saved = tables.appointments; tables.appointments = [];
  try { assert.equal((await getTechnicianPortalData(tables.technicians[0])).technician.pin, undefined); }
  finally { tables.appointments = saved; }
  const workflow = await call('/appointments/10/workflow', 'PATCH', technician, {});
  assert.equal(workflow.status, 200, JSON.stringify(workflow.body));
  assert.equal(workflow.body.appointment.google_event, undefined);
  assert.equal(workflow.body.appointment.google_etag, undefined);
  assert.ok(!JSON.stringify(workflow.body).includes('meeting-secret'));
});

test('untrusted admin header cannot authorize special calibration or automatic approval', async () => {
  const body = { analyzer_id: 1, technician_id: 77, operation_type: 'Calibração', reserved_date: '2026-10-21', direct_checkout: true };
  assert.equal((await call('/reservations', 'POST', technician, body, { 'x-admin-token': 'true' })).status, 403);
  tables.technicians[0].name = 'EQAT';
  try {
    const eqat = await call('/reservations', 'POST', technician, body, { 'x-admin-token': 'true' });
    assert.equal(eqat.status, 200, JSON.stringify(eqat.body)); assert.equal(eqat.body.status, 'Aguardando Aprovação');
    const row = tables.reservations.at(-1); assert.equal(row.approved_by, null); assert.equal(row.approved_at, null);
  } finally { tables.technicians[0].name = 'Fixture'; }
});

test('startup migration preserves chosen PINs, skips hashes and fails closed on write or length errors', async () => {
  const original = tables.app_credentials;
  tables.app_credentials = [{ id: 901, pin: '8524' }];
  const oldTech = tables.technicians; tables.technicians = [{ id: 902, pin: '9642' }];
  try {
    await migrateLoginPins(client);
    assert.equal(await CryptoService.verifySecret('8524', tables.app_credentials[0].pin), true);
    assert.equal(await CryptoService.verifySecret('9642', tables.technicians[0].pin), true);
    const hash = tables.technicians[0].pin; await migrateLoginPins(client); assert.equal(tables.technicians[0].pin, hash);
    await assert.rejects(hashLoginPin('😀'.repeat(19)), /72 bytes/);
    const failing = { from() { const q = { select: () => q, order: () => q, range: async () => ({ error: new Error('offline fixture') }) }; return q; } };
    await assert.rejects(migrateLoginPins(failing), /migrar/);
    tables.technicians[0].pin = '9642';
    await assert.rejects(migrateLoginPins({ from: client.from, rpc: async () => ({ error: new Error('write failure fixture') }) }), /proteger/);
  } finally { tables.app_credentials = original; tables.technicians = oldTech; }
});

test('revoked JWT and portal access stay revoked after the same identity is reactivated with a new PIN', async () => {
  const jwt = require('jsonwebtoken');
  const crypto = require('node:crypto');
  const row = tables.technicians.find(row => row.id === 77);
  const original = { ...row };
  const legacyJwt = jwt.sign({ sub: '77', role: 'technician', name: 'Fixture' }, process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: 'atem-field-backend', audience: 'atem-field-app', expiresIn: '1h' });
  const payload = Buffer.from(JSON.stringify({ version: 2, technicianId: 77, expiresAt: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  const key = crypto.createHash('sha256').update(`atem-field-technician-portal:${process.env.TECHNICIAN_PORTAL_SECRET}`).digest('hex');
  const legacyPortal = payload + '.' + crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const oldPortal = createTechnicianPortalAccess(77, 0);
  try {
    assert.equal((await call('/auth/session', 'GET', legacyJwt)).status, 200);
    assert.equal((await call('/technician-portal', 'GET', legacyPortal)).status, 200);
    // These are the exact linked-profile changes performed by the SQL RPC.
    Object.assign(row, { status: 'Inativo', pin: null, auth_version: 1 });
    assert.equal((await call('/auth/session', 'GET', technician)).status, 401);
    row.status = 'Ativo'; row.pin = await hashLoginPin('9428');
    for (const token of [technician, legacyJwt]) assert.equal((await call('/auth/session', 'GET', token)).status, 401);
    for (const token of [oldPortal, legacyPortal]) assert.equal((await call('/technician-portal', 'GET', token)).status, 401);
    const fresh = await call('/auth/login', 'POST', undefined, { type: 'technician', technician_id: 77, pin: '9428' });
    assert.equal(fresh.status, 200); assert.equal(AuthService.verifySessionToken(fresh.body.token).auth_version, 1);
    assert.equal((await call('/auth/session', 'GET', fresh.body.token)).status, 200);
    assert.equal((await call('/technicians/77/portal-link', 'GET', fresh.body.token)).status, 200);
    assert.equal((await call('/technician-portal', 'GET', createTechnicianPortalAccess(77, 1))).status, 200);
  } finally { Object.keys(row).forEach(key => delete row[key]); Object.assign(row, original); }
});
