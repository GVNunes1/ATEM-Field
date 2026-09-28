const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

let db;
const migration = name => readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

before(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(migration('001_initial_schema.sql'));
  await db.exec(migration('002_workflow_fleet.sql'));
  await db.exec("alter table public.reservations add column operation_type text default 'Atendimento';");
  await db.exec(migration('20260928121606_start_workflow_on_pattern_checkout.sql'));
  await db.exec("insert into public.technicians(id,name) values (1,'Ana Fixture'),(2,'Bruno Fixture'); set role service_role;");
});
after(async () => { if (db) await db.close(); });

test('confirmed appointment starts when its scheduled technician checks out an attendance pattern', async () => {
  const appt = await one("insert into public.appointments(title,technician_id,workflow_status) values ('Hospital',1,'Confirmado com cliente') returning id");
  const reservation = await one("insert into public.reservations(analyzer_id,technician_id,appointment_id,status,operation_type) values (null,1,$1,'Reservado','Atendimento') returning id", [appt.id]);
  await db.query("update public.reservations set status='Em Uso',checkout_at=now() where id=$1", [reservation.id]);
  const result = await one('select workflow_status from public.appointments where id=$1', [appt.id]);
  assert.equal(result.workflow_status, 'Em execução');
  await db.query("update public.reservations set status='Em Uso' where id=$1", [reservation.id]);
  assert.equal((await one('select workflow_status from public.appointments where id=$1', [appt.id])).workflow_status, 'Em execução');
});

test('team membership works even without a legacy primary technician', async () => {
  const appt = await one("insert into public.appointments(title,workflow_status) values ('Hospital em equipe','Confirmado com cliente') returning id");
  await db.query('insert into public.appointment_technicians(appointment_id,technician_id) values ($1,2)', [appt.id]);
  const reservation = await one("insert into public.reservations(technician_id,appointment_id,status) values (2,$1,'Reservado') returning id", [appt.id]);
  await db.query("update public.reservations set status='Em Uso' where id=$1", [reservation.id]);
  assert.equal((await one('select workflow_status from public.appointments where id=$1', [appt.id])).workflow_status, 'Em execução');
});

test('provisional, unassigned and non-attendance withdrawals do not start a workflow', async () => {
  for (const [stage, techId, operation] of [
    ['Data provisória', 1, 'Atendimento'],
    ['Confirmado com cliente', 2, 'Atendimento'],
    ['Confirmado com cliente', 1, 'Empréstimo'],
  ]) {
    const appt = await one('insert into public.appointments(title,technician_id,workflow_status) values ($1,1,$2) returning id', ['Hospital', stage]);
    const reservation = await one('insert into public.reservations(technician_id,appointment_id,status,operation_type) values ($1,$2,$3,$4) returning id', [techId, appt.id, 'Reservado', operation]);
    await db.query("update public.reservations set status='Em Uso' where id=$1", [reservation.id]);
    assert.equal((await one('select workflow_status from public.appointments where id=$1', [appt.id])).workflow_status, stage);
  }
});

test('public Data API role cannot advance workflow through reservation update', async () => {
  const appt = await one("insert into public.appointments(title,technician_id,workflow_status) values ('Hospital',1,'Confirmado com cliente') returning id");
  const reservation = await one('insert into public.reservations(technician_id,appointment_id,status) values (1,$1,$2) returning id', [appt.id, 'Reservado']);
  await db.exec('set role anon;');
  try { await db.query("update public.reservations set status='Em Uso' where id=$1", [reservation.id]); }
  finally { await db.exec('set role service_role;'); }
  assert.equal((await one('select workflow_status from public.appointments where id=$1', [appt.id])).workflow_status, 'Confirmado com cliente');
});
