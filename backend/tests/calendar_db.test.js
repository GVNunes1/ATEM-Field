const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

// An isolated, in-memory PostgreSQL runtime. No dotenv, URLs, credentials or
// network clients are imported: this suite cannot access the real project.
let db;
const migration = name => readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const values = (title = 'Hospital fixture', date = '2026-10-01') => ({
  title, client_name: title, client_address: 'Rua de teste, 100',
  appointment_date: date, appointment_time: '08:00',
  appointment_end_date: date, appointment_end_time: '09:00',
  all_day: false, technician_ids: [1],
});
const event = (id, etag = 'v1', overrides = {}) => ({
  id, etag, status: 'confirmed', summary: 'Hospital fixture',
  updated: '2026-09-21T12:00:00Z', ...overrides,
});
const ingest = async (raw, data = values(), options = {}) => (await one(
  'select public.calendar_ingest($1,$2::jsonb,$3::jsonb,$4::bigint[],$5,$6::bigint,$7::integer) as result',
  [options.calendar || 'fixture-calendar', JSON.stringify(raw), JSON.stringify(data),
    options.team || data.technician_ids || [], options.writable ?? true,
    options.resolveId || null, options.revision ?? null],
)).result;
const appointment = id => one('select * from public.appointments where id=$1', [id]);
const activeJob = id => one("select * from public.calendar_outbox where appointment_id=$1 and status in ('pending','error','conflict')", [id]);
const queue = async (id, data = values('Local change'), patch = { summary: data.title }, revision) => {
  const current = await appointment(id);
  return (await one('select public.calendar_queue_edit($1,$2,$3::jsonb,$4::jsonb,$5) as result',
    [id, revision ?? current.google_sync_revision, JSON.stringify(data), JSON.stringify(patch), 'fixture-admin'])).result;
};
const seed = async (name, options) => {
  const raw = event(name);
  const result = await ingest(raw, values(), options);
  return { id: result.id, raw };
};
const denied = async fn => assert.rejects(fn, error => error.code === '42501');

before(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(migration('001_initial_schema.sql'));
  await db.exec(migration('002_workflow_fleet.sql'));
  await db.exec(migration('003_google_calendar_bidirectional.sql'));
  await db.exec("insert into public.technicians(id,name) values (1,'Ana Fixture'),(2,'Bruno Fixture'); set role service_role;");
});
after(async () => { if (db) await db.close(); });

test('002 and 003 reapply safely without changing existing appointment/workflow data', async () => {
  const { id } = await seed('idempotent');
  await db.query("update public.appointments set workflow_status='Confirmado', client_contact='Preservar contato' where id=$1", [id]);
  const original = await appointment(id);
  await db.exec('reset role');
  try {
    await db.exec(migration('002_workflow_fleet.sql'));
    await db.exec(migration('003_google_calendar_bidirectional.sql'));
  } finally { await db.exec('set role service_role'); }
  assert.deepEqual(await appointment(id), original);
});

test('service-role ingest adopts legacy identity, separates calendars and is idempotent', async () => {
  const legacy = await one("insert into public.appointments(external_id,title) values ('GGCAL-legacy-event','Legacy') returning id");
  const imported = await ingest(event('legacy-event'));
  assert.equal(imported.id, legacy.id);
  assert.equal((await ingest(event('legacy-event'))).unchanged, true);
  const second = await ingest(event('legacy-event'), values(), { calendar: 'other-calendar' });
  assert.notEqual(second.id, legacy.id);
  const row = await appointment(legacy.id);
  assert.equal(row.google_sync_status, 'synced');
  assert.equal(row.google_event_id, 'legacy-event');
});

test('queue edit atomically saves team/date, preserves workflow and rejects stale or second edits', async () => {
  const { id } = await seed('queue');
  await db.query("update public.appointments set workflow_status='Confirmado', client_contact='Contato original' where id=$1", [id]);
  await db.query("insert into public.reservations(appointment_id,reserved_date,status) values ($1,'2026-10-01','Reservado'),($1,'2026-10-01','Emprestado')", [id]);
  const old = await appointment(id);
  const changed = { ...values('Local queue', '2026-10-02'), technician_ids: [2] };
  const saved = await queue(id, changed);
  assert.equal(saved.google_sync_status, 'pending');
  assert.equal(saved.google_sync_revision, old.google_sync_revision + 1);
  assert.equal(saved.workflow_status, 'Confirmado');
  assert.equal(saved.client_contact, 'Contato original');
  assert.deepEqual((await db.query('select technician_id from public.appointment_technicians where appointment_id=$1', [id])).rows, [{ technician_id: 2 }]);
  const reserved = await one("select reserved_date::text as date from public.reservations where appointment_id=$1 and status='Reservado'", [id]);
  const loaned = await one("select reserved_date::text as date from public.reservations where appointment_id=$1 and status='Emprestado'", [id]);
  assert.equal(reserved.date, '2026-10-02');
  assert.equal(loaned.date, '2026-10-01');
  assert.equal((await activeJob(id)).expected_etag, 'v1');
  await assert.rejects(() => queue(id, changed, { summary: changed.title }, old.google_sync_revision), { code: '40001' });
  await assert.rejects(() => queue(id), { code: '40001' });
});

test('invalid team rolls back all local data and does not enqueue a partial edit', async () => {
  const { id } = await seed('invalid-team');
  const old = await appointment(id);
  await assert.rejects(() => queue(id, { ...values('Must roll back'), technician_ids: [987654] }), /Equipe inválida/);
  assert.deepEqual(await appointment(id), old);
  assert.equal(await activeJob(id), undefined);
});

test('read-only calendar cannot enqueue outbound writes', async () => {
  const { id } = await seed('readonly', { writable: false });
  await assert.rejects(() => queue(id), /permissão de edição/);
  assert.equal(await activeJob(id), undefined);
});

test('unchanged remote event preserves pending edit; own operation marker acknowledges once', async () => {
  const { id, raw } = await seed('own-ack');
  const data = values('Changed here');
  await queue(id, data);
  const job = await activeJob(id);
  assert.equal((await ingest(raw)).preserved_local, true);
  assert.equal((await appointment(id)).title, data.title);
  const sent = event(raw.id, 'v2', { summary: data.title, updated: '2026-09-21T13:00:00Z',
    extendedProperties: { private: { atem_operation_id: job.id } } });
  assert.equal((await ingest(sent, data)).acknowledged, true);
  assert.equal((await appointment(id)).google_sync_status, 'synced');
  assert.equal((await one('select status from public.calendar_outbox where id=$1', [job.id])).status, 'sent');
  assert.equal((await ingest(sent, data)).unchanged, true);
  assert.equal(await activeJob(id), undefined);
});

test('remote ETag conflict never overwrites pending local data; Google resolution applies remote atomically', async () => {
  const { id, raw } = await seed('conflict-google');
  await queue(id, values('Keep local pending'));
  const remote = event(raw.id, 'remote-v2', { summary: 'Google change', updated: '2026-09-21T14:00:00Z' });
  const remoteValues = { ...values('Google change'), technician_ids: [2] };
  await ingest(remote, remoteValues);
  const conflict = await appointment(id);
  assert.equal(conflict.title, 'Keep local pending');
  assert.equal(conflict.google_sync_status, 'conflict');
  assert.equal(conflict.google_sync_conflict.etag, 'remote-v2');
  assert.equal((await activeJob(id)).status, 'conflict');
  await assert.rejects(() => ingest(remote, remoteValues, { resolveId: id, revision: conflict.google_sync_revision - 1 }), { code: '40001' });
  await ingest(remote, remoteValues, { resolveId: id, revision: conflict.google_sync_revision });
  assert.equal((await appointment(id)).title, 'Google change');
  assert.equal((await appointment(id)).google_sync_status, 'synced');
  assert.equal(await activeJob(id), undefined);
});

test('ATEM conflict resolution requeues original patch against current remote ETag', async () => {
  const { id, raw } = await seed('conflict-atem');
  await queue(id, values('Local winning change'));
  const original = await activeJob(id);
  await ingest(event(raw.id, 'google-v2', { updated: '2026-09-21T14:00:00Z' }));
  const conflict = await appointment(id);
  await one('select public.calendar_queue_edit($1,$2,$3::jsonb,$4::jsonb,$5,true) as result',
    [id, conflict.google_sync_revision, '{}', '{}', 'fixture-admin']);
  const retried = await activeJob(id);
  assert.notEqual(retried.id, original.id);
  assert.equal(retried.expected_etag, 'google-v2');
  assert.deepEqual(retried.event_patch, original.event_patch);
  assert.equal((await appointment(id)).title, 'Local winning change');
  assert.equal((await one('select status from public.calendar_outbox where id=$1', [original.id])).status, 'resolved');
});

test('transient failure is durable and successful retry clears error without duplicate operation', async () => {
  const { id, raw } = await seed('retry');
  const data = values('Retry change');
  await queue(id, data);
  const job = await activeJob(id);
  await one('select public.calendar_fail($1,$2)', [job.id, 'Transient network failure']);
  const failed = await activeJob(id);
  assert.equal(failed.id, job.id);
  assert.equal(failed.status, 'error');
  assert.equal(failed.attempts, 1);
  assert.equal((await appointment(id)).google_sync_status, 'error');
  await ingest(event(raw.id, 'retry-v2', { extendedProperties: { private: { atem_operation_id: job.id } } }), data);
  assert.equal((await appointment(id)).google_sync_error, null);
  assert.equal((await appointment(id)).google_sync_status, 'synced');
  await one('select public.calendar_fail($1,$2)', [job.id, 'Stale failure must not revert success']);
  assert.equal((await appointment(id)).google_sync_status, 'synced');
});

test('remote cancellation preserves workflow data, ignores missing events and requires accepting deletion on conflicts', async () => {
  assert.equal((await ingest(event('missing-cancel', 'v2', { status: 'cancelled' }), {})).ignored, true);
  const { id, raw } = await seed('cancel');
  await queue(id);
  const cancelled = event(raw.id, 'cancel-v2', { status: 'cancelled' });
  await ingest(cancelled, {});
  const conflict = await appointment(id);
  await assert.rejects(() => one('select public.calendar_queue_edit($1,$2,$3::jsonb,$4::jsonb,$5,true)',
    [id, conflict.google_sync_revision, '{}', '{}', 'fixture-admin']), /Evento excluído/);
  await ingest(cancelled, {}, { resolveId: id, revision: conflict.google_sync_revision });
  const after = await appointment(id);
  assert.equal(after.status, 'Cancelado');
  assert.equal(after.workflow_status, conflict.workflow_status);
  assert.equal(after.title, conflict.title);
});

test('older remote versions cannot overwrite newer synced data', async () => {
  const { id, raw } = await seed('old-event');
  const newer = event(raw.id, 'new-v2', { updated: '2026-09-22T12:00:00Z' });
  await ingest(newer, values('Newest'));
  assert.equal((await ingest(raw, values('Old'))).unchanged, true);
  assert.equal((await appointment(id)).title, 'Newest');
});

test('durable lease excludes another worker, renews owner, expires and releases safely', async () => {
  const a = randomUUID(), b = randomUUID();
  const lease = async (id, release = false) => (await one('select public.calendar_lease($1,$2) as held', [id, release])).held;
  assert.equal(await lease(a), true);
  assert.equal(await lease(a), true);
  assert.equal(await lease(b), false);
  assert.equal(await lease(b, true), false);
  await db.exec("update public.calendar_sync_control set lease_until=now()-interval '1 second'");
  assert.equal(await lease(b), true);
  assert.equal(await lease(a, true), false);
  assert.equal(await lease(b, true), true);
  assert.equal(await lease(a), true);
  assert.equal(await lease(a, true), true);
});

test('fleet active-use constraint prevents two simultaneous withdrawals for one vehicle', async () => {
  const vehicle = await one("insert into public.fleet_vehicles(name,plate) values ('Fixture','TST-0001') returning id");
  const usage = await one('insert into public.fleet_usage(vehicle_id,km_initial) values ($1,100) returning id', [vehicle.id]);
  await assert.rejects(() => db.query('insert into public.fleet_usage(vehicle_id,km_initial) values ($1,100)', [vehicle.id]), { code: '23505' });
  await db.query("update public.fleet_usage set status='Devolvido' where id=$1", [usage.id]);
  await db.query('insert into public.fleet_usage(vehicle_id,km_initial) values ($1,150)', [vehicle.id]);
});

test('sync/fleet data and RPCs deny anon/authenticated, with RLS and invoker functions', async () => {
  const tables = ['calendar_outbox', 'calendar_sync_control', 'fleet_vehicles', 'fleet_usage'];
  const rls = await db.query('select relname,relrowsecurity from pg_class where relname=any($1::text[])', [tables]);
  assert.equal(rls.rows.length, tables.length);
  assert.ok(rls.rows.every(row => row.relrowsecurity));
  const routines = await db.query("select proname,prosecdef,proconfig from pg_proc where proname like 'calendar_%'");
  assert.equal(routines.rows.length, 4);
  assert.ok(routines.rows.every(row => !row.prosecdef && row.proconfig.includes('search_path=""')));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    try {
      for (const table of tables) await denied(() => db.query(`select * from public.${table}`));
      await denied(() => db.query('select public.calendar_lease($1)', [randomUUID()]));
      await denied(() => db.query('select public.calendar_queue_edit(1,1,$1::jsonb,$2::jsonb,$3)', ['{}', '{}', 'forged']));
      await denied(() => db.query('select google_event, google_sync_conflict from public.appointments'));
      await denied(() => db.query("update public.appointments set google_sync_status='synced'"));
    } finally { await db.exec('reset role; set role service_role'); }
  }
});

test('deleting appointment cleans outbox, child records, and removes appointment', async () => {
  const { id } = await seed('delete-target');
  await queue(id, values('Queued for deletion'));
  assert.ok(await activeJob(id));
  // Deleting directly without outbox cleanup causes FK violation because of ON DELETE RESTRICT (23001)
  await assert.rejects(() => db.query('delete from public.appointments where id=$1', [id]), { code: '23001' });
  // Simulating our deletion service cleanup logic:
  await db.exec('reset role');
  try {
    await db.query('delete from public.calendar_outbox where appointment_id=$1', [id]);
    await db.query('delete from public.appointment_technicians where appointment_id=$1', [id]);
    await db.query('delete from public.appointments where id=$1', [id]);
  } finally {
    await db.exec('set role service_role');
  }
  assert.equal(await appointment(id), undefined);
});

