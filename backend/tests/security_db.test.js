const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
let db;
const migration = name => readFileSync(path.join(__dirname, '../migrations', name), 'utf8');
const securityMigration = '20261007182848_security_access_controls.sql';
before(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  for (const name of ['001_initial_schema.sql', '002_workflow_fleet.sql', '003_google_calendar_bidirectional.sql']) await db.exec(migration(name));
  await db.exec(`alter table public.technicians add column pin text;
    create table public.app_credentials(id bigint primary key, username text not null, technician_id bigint references public.technicians, pin text not null, status text not null);
    grant all on public.app_credentials to anon, authenticated, service_role;
    insert into public.technicians(id,name,pin) values(1,'Fixture','fixture-hash');
    insert into public.app_credentials values(1,'admin',null,'master-hash','Ativo'),(2,'fixture',1,'fixture-hash','Ativo');
    insert into public.equipment_categories(id,name) values(1,'Fixture');
    insert into public.appointments(id,title) values(1,'Fixture');`);
  // Demonstrate both the broad grant and the lingering column grant pre-fix.
  await db.exec("set role anon; update public.equipment_categories set name='Anonymous mutation' where id=1; update public.appointments set client_name='Column mutation' where id=1; reset role;");
  await db.exec(migration(securityMigration));
});
after(async () => { await db.close(); });

test('public roles lose table and column privileges, including private direct reads', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const sql of [
        "update public.equipment_categories set name='Attacker' where id=1",
        "update public.appointments set client_name='Attacker' where id=1",
        "insert into public.appointments(title) values('Attacker')",
        'delete from public.reservations where id=1',
        'select client_name from public.appointments',
        'select pin from public.technicians',
        'select public.revoke_app_credential(2)',
        "select public.upgrade_login_pin('technicians',1,'fixture-hash','invalid')",
      ]) await assert.rejects(db.exec(sql), error => error.code === '42501', sql);
      const rows = (await db.query(`select relname, has_table_privilege(current_user, c.oid, 'INSERT, UPDATE, DELETE') as writes,
        has_any_column_privilege(current_user, c.oid, 'SELECT, INSERT, UPDATE') as columns
        from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public'
        and relname in ('analyzers','appointments','appointment_technicians','appointment_equipments','equipment_categories','test_templates','notification_logs','reservations','technicians','app_credentials')`)).rows;
      assert.equal(rows.length, 10);
      assert.ok(rows.every(row => !row.writes && !row.columns));
    } finally { await db.exec('reset role'); }
  }
});

test('service role retains normal mutations and revokes PIN, JWT/portal profile and credential atomically', async () => {
  await db.exec('set role service_role');
  try {
    await db.exec("update public.equipment_categories set name='Legitimate update' where id=1; select public.revoke_app_credential(2);");
    assert.deepEqual((await db.query('select status,pin from public.technicians where id=1')).rows, [{ status: 'Inativo', pin: null }]);
    assert.equal((await db.query('select * from public.app_credentials where id=2')).rows.length, 0);
    assert.equal((await db.query('select auth_version from public.technicians where id=1')).rows[0].auth_version, 1);
    await db.exec("update public.technicians set status='Ativo',pin='new-fixture-hash' where id=1");
    assert.equal((await db.query('select auth_version from public.technicians where id=1')).rows[0].auth_version, 1);
    await assert.rejects(db.exec('select public.revoke_app_credential(1)'), error => error.code === '22023');
    assert.equal((await db.query('select * from public.app_credentials where id=1')).rows.length, 1);
  } finally { await db.exec('reset role'); }
});

test('failed linked-profile revocation rolls back deletion; migration can reapply', async () => {
  await db.exec(`insert into public.app_credentials values(3,'fixture-rollback',1,'hash','Ativo');
    create function public.fail_fixture_revocation() returns trigger language plpgsql as $$begin raise exception 'fixture failure'; end$$;
    create trigger fixture_failure before update on public.technicians for each row execute function public.fail_fixture_revocation();`);
  await assert.rejects(db.exec('select public.revoke_app_credential(3)'), /fixture failure/);
  assert.equal((await db.query('select id from public.app_credentials where id=3')).rows.length, 1);
  await db.exec('drop trigger fixture_failure on public.technicians;');
  await db.exec(migration(securityMigration));
});

test('PIN upgrade is service-only, validates table/hash and cannot overwrite a concurrent reset', async () => {
  const hash = '$2b$12$' + 'a'.repeat(53);
  await db.exec("update public.technicians set pin='fixture-old' where id=1; set role service_role;");
  try {
    await db.query('select public.upgrade_login_pin($1,$2,$3,$4)', ['technicians', 1, 'fixture-old', hash]);
    assert.equal((await db.query('select pin from public.technicians where id=1')).rows[0].pin, hash);
    await assert.rejects(db.query('select public.upgrade_login_pin($1,$2,$3,$4)', ['technicians', 1, 'fixture-old', hash]), error => error.code === '40001');
    await assert.rejects(db.query('select public.upgrade_login_pin($1,$2,$3,$4)', ['technicians', 1, hash, 'plaintext']), error => error.code === '22023');
    await assert.rejects(db.query('select public.upgrade_login_pin($1,$2,$3,$4)', ['reservations', 1, hash, hash]), error => error.code === '22023');
  } finally { await db.exec('reset role'); }
});
