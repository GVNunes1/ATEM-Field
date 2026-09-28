const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

let db;
let historicalAppointmentId;
let vehicleSequence = 0;
const migration = name => readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const stage = id => one('select workflow_status, workflow_assignee_id from public.appointments where id=$1', [id]);

async function appointment(withCar = true, workflow = 'Em execução') {
  const vehicle = withCar ? await one("insert into public.fleet_vehicles(name,plate) values ('Carro de teste',$1) returning id", [`TST-${String(++vehicleSequence).padStart(4, '0')}`]) : null;
  const appt = await one('insert into public.appointments(title,workflow_status,vehicle_id) values ($1,$2,$3) returning id', ['Atendimento de teste', workflow, vehicle?.id || null]);
  return { id: appt.id, vehicleId: vehicle?.id || null };
}
async function pattern(appointmentId) {
  return one("insert into public.reservations(appointment_id,status) values ($1,'Em Uso') returning id", [appointmentId]);
}
async function car(appointmentId, vehicleId) {
  return one('insert into public.fleet_usage(appointment_id,vehicle_id,km_initial) values ($1,$2,100) returning id', [appointmentId, vehicleId]);
}

before(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(migration('001_initial_schema.sql'));
  await db.exec(migration('002_workflow_fleet.sql'));
  await db.exec(migration('20260928115601_workflow_assignment.sql'));
  const historical = await one("insert into public.appointments(title,workflow_status) values ('Atendimento anterior','Em execução') returning id");
  historicalAppointmentId = historical.id;
  await db.query("insert into public.reservations(appointment_id,status) values ($1,'Devolvido')", [historical.id]);
  await db.exec(migration('20260928195306_auto_finish_after_asset_returns.sql'));
  await db.exec('set role service_role;');
});
after(async () => { if (db) await db.close(); });

test('finishes only after the car and every pattern are returned', async () => {
  const appt = await appointment();
  const first = await pattern(appt.id);
  const second = await pattern(appt.id);
  const usage = await car(appt.id, appt.vehicleId);
  await db.query("update public.fleet_usage set status='Devolvido' where id=$1", [usage.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Em execução');
  await db.query("update public.reservations set status='Devolvido' where id=$1", [first.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Em execução');
  await db.query("update public.reservations set status='Devolvido' where id=$1", [second.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Concluído');
});

test('also finishes when the car is returned last, including with damage', async () => {
  const appt = await appointment();
  const reservation = await pattern(appt.id);
  const usage = await car(appt.id, appt.vehicleId);
  await db.query("update public.reservations set status='Devolvido' where id=$1", [reservation.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Em execução');
  await db.query("update public.fleet_usage set status='Devolvido com pendência' where id=$1", [usage.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Concluído');
});

test('does not wait for a vehicle that was never assigned', async () => {
  const appt = await appointment(false);
  const reservation = await pattern(appt.id);
  await db.query("update public.reservations set status='Devolvido' where id=$1", [reservation.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Concluído');
});

test('does not finish while the assigned car has not been returned', async () => {
  const appt = await appointment();
  const reservation = await pattern(appt.id);
  await db.query("update public.reservations set status='Devolvido' where id=$1", [reservation.id]);
  assert.equal((await stage(appt.id)).workflow_status, 'Em execução');
});

test('reconciles completed past appointments but not an appointment without returned assets', async () => {
  assert.equal((await stage(historicalAppointmentId)).workflow_status, 'Concluído');
  const provisional = await appointment(false, 'Data provisória');
  const reservation = await pattern(provisional.id);
  await db.query("update public.reservations set status='Devolvido' where id=$1", [reservation.id]);
  assert.equal((await stage(provisional.id)).workflow_status, 'Data provisória');
  const empty = await appointment(false);
  assert.equal((await stage(empty.id)).workflow_status, 'Em execução');
});

test('public Data API roles cannot complete workflow through a return', async () => {
  const appt = await appointment(false);
  const reservation = await pattern(appt.id);
  await db.exec('set role anon;');
  try { await db.query("update public.reservations set status='Devolvido' where id=$1", [reservation.id]); }
  finally { await db.exec('set role service_role;'); }
  assert.equal((await stage(appt.id)).workflow_status, 'Em execução');
});
