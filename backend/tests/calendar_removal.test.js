const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

test('Google deletion removes the appointment atomically while preserving loan history and closing queued edits', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    for (const name of ['001_initial_schema.sql', '002_workflow_fleet.sql', '003_google_calendar_bidirectional.sql', '20260921195933_calendar_removal_and_profile_permissions.sql']) {
      await db.exec(readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
    }
    await db.exec("insert into public.technicians(id,name) values (1,'Fixture'); set role service_role;");
    const raw = { id: 'delete-fixture', etag: 'v1', status: 'confirmed', updated: '2026-09-21T12:00:00Z' };
    const values = { title: 'Fixture', client_name: 'Fixture', appointment_date: '2026-10-01', appointment_time: '08:00', appointment_end_date: '2026-10-01', appointment_end_time: '09:00', all_day: false };
    const ingest = async event => (await db.query('select public.calendar_ingest($1,$2,$3,$4,true) as result', ['fixture-calendar', event, values, [1]])).rows[0].result;
    const { id } = await ingest(raw);
    await db.query("insert into public.analyzers(id,asset_tag,name,status) values (900,'QA-900','Reservado','Reservado'),(901,'QA-901','Em uso','Em Uso')");
    await db.query("insert into public.reservations(appointment_id,analyzer_id,status) values ($1,900,'Reservado'),($1,901,'Em Uso')", [id]);
    await db.query("insert into public.notification_logs(appointment_id,message) values ($1,'Preservar histórico')", [id]);
    const current = (await db.query('select * from public.appointments where id=$1', [id])).rows[0];
    await db.query('select public.calendar_queue_edit($1,$2,$3,$4,$5)', [id, current.google_sync_revision, { ...values, title: 'Local pending', technician_ids: [1] }, { summary: 'Local pending' }, 'fixture']);
    const result = await ingest({ ...raw, etag: 'deleted', status: 'cancelled' });
    assert.equal(result.deleted, true);
    assert.equal((await db.query('select * from public.appointments where id=$1', [id])).rows.length, 0);
    assert.equal((await db.query('select * from public.calendar_outbox where appointment_id=$1', [id])).rows.length, 0);
    assert.deepEqual((await db.query('select appointment_id,status from public.reservations order by analyzer_id')).rows, [{ appointment_id: null, status: 'Cancelado' }, { appointment_id: null, status: 'Em Uso' }]);
    assert.deepEqual((await db.query('select status from public.analyzers order by id')).rows, [{ status: 'Disponível' }, { status: 'Em Uso' }]);
    assert.equal((await db.query('select message from public.notification_logs')).rows[0].message, 'Preservar histórico');
    assert.equal((await ingest({ ...raw, status: 'cancelled' })).ignored, true, 'Tombstone replay is idempotent');

    const live = await ingest({ ...raw, id: 'still-live' });
    await db.query("update public.appointments set status='Cancelado' where id=$1", [live.id]);
    await ingest({ ...raw, id: 'still-live' });
    assert.equal((await db.query('select status from public.appointments where id=$1', [live.id])).rows[0].status, 'Agendado', 'A real live Google event clears a stale local cancellation label');
    await db.exec('reset role; set role anon');
    await assert.rejects(() => db.query("update public.technicians set role='Gerente' where id=1"), { code: '42501' });
    await assert.rejects(() => db.query('select public.calendar_remove_appointment($1)', [live.id]), { code: '42501' });
  } finally { await db.close(); }
});
