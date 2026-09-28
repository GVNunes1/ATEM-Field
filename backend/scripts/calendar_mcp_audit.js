// Read-only Supabase MCP audit. Requires the credentials already configured in backend/.env.
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Supabase MCP credentials are unavailable.');

const queries = {
  advisors_security: '',
  workflow_status_counts: `select coalesce(workflow_status,'(nulo)') as stage, count(*) as appointments from public.appointments where status is distinct from 'Cancelado' group by 1 order by appointments desc`,
  workflow_assignment_schema: `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='appointments' and column_name like 'workflow_assign%' order by column_name`,
  pattern_checkout_trigger: `select tgname, tgenabled from pg_trigger where tgrelid='public.reservations'::regclass and tgname='trg_start_workflow_on_pattern_checkout'`,
  pattern_checkout_columns: `select column_name from information_schema.columns where table_schema='public' and table_name='reservations' and column_name in ('operation_type','checkout_at','technician_id','appointment_id','status') order by column_name`,
  counts: `select count(*) as appointments,
    count(*) filter (where google_calendar_id is not null and google_event_id is not null) as google_linked,
    count(*) filter (where google_calendar_id is null and external_id like 'GGCAL-%') as legacy_google,
    count(*) filter (where external_id is null and google_calendar_id is null) as local_only
    from public.appointments`,
  duplicate_groups: `select appointment_date, appointment_time,
    lower(regexp_replace(coalesce(client_name,title,''),'[[:space:]]+',' ','g')) as location_key,
    count(*) as copies, count(distinct google_calendar_id) as calendars,
    count(distinct google_event_id) as google_ids,
    array_agg(id order by id) as appointment_ids
    from public.appointments
    where appointment_date between date '2026-09-01' and date '2026-09-30'
    group by 1,2,3 having count(*) > 1 order by copies desc limit 30`,
  identities: `select id, appointment_date, appointment_time, client_name, external_id,
    google_calendar_id, google_event_id, google_event->>'iCalUID' as ical_uid,
    google_event->>'recurringEventId' as recurring_id, created_at,
    (select count(*) from public.reservations r where r.appointment_id=a.id) as reservations,
    (select count(*) from public.calendar_outbox o where o.appointment_id=a.id and o.status in ('pending','error','conflict')) as unsent_edits
    from public.appointments a
    where appointment_date=date '2026-09-16'
      and client_name ilike '%Itapetininga%'
    order by client_name,id limit 35`,
  indexes: `select indexname,indexdef from pg_indexes where schemaname='public' and tablename='appointments' order by indexname`,
  legacy_matches: `with matches as (
    select l.id legacy_id, count(n.id) linked_matches,
      count(n.id) filter (where l.appointment_date=n.appointment_date and l.appointment_time=n.appointment_time) matching_time,
      count(n.id) filter (where l.title=n.title) matching_title
    from public.appointments l left join public.appointments n
      on n.google_event_id=substring(l.external_id from 7)
      and n.google_calendar_id is not null
    where l.google_calendar_id is null and l.external_id like 'GGCAL-%'
    group by l.id)
    select count(*) as legacy_total,
      count(*) filter (where linked_matches=0) as no_linked_match,
      count(*) filter (where linked_matches=1) as single_linked_match,
      count(*) filter (where linked_matches>1) as ambiguous_linked_match,
      count(*) filter (where linked_matches=1 and matching_time=1 and matching_title=1) as exact_match
    from matches`,
  legacy_samples: `select l.id legacy_id,n.id linked_id,l.external_id legacy_external_id,
    n.google_calendar_id,n.google_event_id,l.appointment_date,n.appointment_date,
    l.appointment_time,n.appointment_time,l.title=n.title as same_title,
    (select count(*) from public.reservations r where r.appointment_id=l.id) as legacy_reservations,
    (select count(*) from public.reservations r where r.appointment_id=n.id) as linked_reservations
    from public.appointments l join public.appointments n
      on n.google_event_id=substring(l.external_id from 7) and n.google_calendar_id is not null
    where l.google_calendar_id is null and l.external_id like 'GGCAL-%'
      and l.appointment_date=date '2026-09-16'
    order by l.id limit 20`,
  calendar_overview: `select google_calendar_id,count(*) as events,
    count(distinct google_event->>'iCalUID') as distinct_ical_uid
    from public.appointments where google_calendar_id is not null
    group by google_calendar_id order by events desc limit 30`,
  linked_ical_duplicates: `select google_event->>'iCalUID' as ical_uid,
    count(*) as copies,count(distinct google_calendar_id) as calendars,
    array_agg(id order by id) as ids
    from public.appointments where google_calendar_id is not null
      and google_event->>'iCalUID' is not null
      and appointment_date between date '2026-09-01' and date '2026-09-30'
    group by 1 having count(*)>1 order by copies desc limit 20`,
  google_provenance: `select id,google_event_id,created_at,
    google_event->>'created' as google_created,
    google_event->>'updated' as google_updated,
    google_event->'creator' as creator,
    google_event->'organizer' as organizer,
    google_event->'extendedProperties' as properties,
    google_event->>'iCalUID' as ical_uid,
    google_event->>'status' as google_status,
    google_event->>'htmlLink' as html_link
    from public.appointments
    where id in (20915,23757,23876,23995,24114,24233,24352,24471)
    order by id`,
  duplicate_totals: `with groups as (
    select appointment_date,appointment_time,
      lower(regexp_replace(coalesce(client_name,title,''),'[[:space:]]+',' ','g')) as place,
      lower(regexp_replace(coalesce(client_address,''),'[[:space:]]+',' ','g')) as address,
      count(*) as copies,
      count(*) filter (where google_calendar_id is not null) linked,
      count(*) filter (where google_calendar_id is null) legacy
    from public.appointments group by 1,2,3,4)
    select count(*) filter (where copies>1) as duplicated_groups,
      coalesce(sum(copies-1) filter (where copies>1),0) as surplus_rows,
      coalesce(sum(linked) filter (where copies>1),0) as linked_in_groups,
      coalesce(sum(legacy) filter (where copies>1),0) as legacy_in_groups,
      max(copies) as max_copies from groups`,
  state_counts: `select
    count(*) filter (where google_event->>'status'='cancelled') as google_tombstones,
    count(*) filter (where google_event->>'status'='confirmed') as google_confirmed,
    count(*) filter (where google_event->>'status' is null and google_calendar_id is not null) as google_unknown,
    count(*) filter (where google_calendar_id is null and status='Cancelado') as legacy_cancelled,
    count(*) filter (where google_calendar_id is null and status<>'Cancelado') as legacy_other,
    count(*) filter (where google_event->>'status'='cancelled' and exists(select 1 from public.reservations r where r.appointment_id=appointments.id)) as tombstones_with_reservations,
    count(*) filter (where google_event->>'status'='cancelled' and exists(select 1 from public.calendar_outbox o where o.appointment_id=appointments.id and o.status in ('pending','error','conflict'))) as tombstones_with_unsent_edits,
    to_regprocedure('public.calendar_remove_appointment(bigint)') is not null as removal_function_present
    from public.appointments`,
  live_duplicate_totals: `with groups as (
    select appointment_date,appointment_time,
      lower(regexp_replace(coalesce(client_name,title,''),'[[:space:]]+',' ','g')) as place,
      lower(regexp_replace(coalesce(client_address,''),'[[:space:]]+',' ','g')) as address,
      count(*) as copies
    from public.appointments where google_event->>'status' is distinct from 'cancelled'
    group by 1,2,3,4)
    select count(*) filter (where copies>1) as groups,
      coalesce(sum(copies-1) filter (where copies>1),0) as surplus_rows,
      max(copies) as max_copies from groups`,
  live_group_breakdown: `with groups as (
    select appointment_date,appointment_time,
      lower(regexp_replace(coalesce(client_name,title,''),'[[:space:]]+',' ','g')) as place,
      lower(regexp_replace(coalesce(client_address,''),'[[:space:]]+',' ','g')) as address,
      count(*) copies,
      count(*) filter (where google_calendar_id is not null) linked,
      count(*) filter (where google_calendar_id is null) legacy,
      count(distinct coalesce(technician_names,'')) distinct_teams,
      count(*) filter (where exists(select 1 from public.reservations r where r.appointment_id=appointments.id)) with_reservations
    from public.appointments where google_event->>'status' is distinct from 'cancelled'
    group by 1,2,3,4 having count(*)>1)
    select linked,legacy,distinct_teams,count(*) groups,
      sum(copies-1) surplus,sum(with_reservations) records_with_reservations
    from groups group by 1,2,3 order by groups desc`,
  live_groups: `with groups as (
    select appointment_date,appointment_time,
      lower(regexp_replace(coalesce(client_name,title,''),'[[:space:]]+',' ','g')) as place,
      lower(regexp_replace(coalesce(client_address,''),'[[:space:]]+',' ','g')) as address,
      count(*) copies
    from public.appointments where google_event->>'status' is distinct from 'cancelled'
    group by 1,2,3,4 having count(*)>1)
    select g.appointment_date,g.appointment_time,g.place,g.copies,
      jsonb_agg(jsonb_build_object('id',a.id,'linked',a.google_calendar_id is not null,
        'team',a.technician_names,'reservations',(select count(*) from public.reservations r where r.appointment_id=a.id),
        'event',a.google_event_id,'source',a.google_event#>>'{extendedProperties,private,origem}') order by a.id) as records
    from groups g join public.appointments a on a.appointment_date=g.appointment_date
      and a.appointment_time is not distinct from g.appointment_time
      and lower(regexp_replace(coalesce(a.client_name,a.title,''),'[[:space:]]+',' ','g'))=g.place
      and lower(regexp_replace(coalesce(a.client_address,''),'[[:space:]]+',' ','g'))=g.address
    group by 1,2,3,4 order by copies desc,g.appointment_date limit 30`,
  source_counts: `select coalesce(google_event#>>'{extendedProperties,private,origem}','legacy-or-unknown') as source,
    google_event->>'status' as google_status,count(*) as rows
    from public.appointments group by 1,2 order by rows desc limit 20`,
  appointment_fks: `select conrelid::regclass::text as referencing_table,conname,confdeltype
    from pg_constraint where contype='f' and confrelid='public.appointments'::regclass
    order by referencing_table,conname`,
  archive_counts: `select (select count(*) from atem_archive.cancelled_google_appointments_20260925) as archived,
    (select count(*) from public.appointments where google_event->>'status'='cancelled') as current_tombstones,
    (select count(*) from public.appointments a where a.google_event->>'status'='cancelled'
      and not exists(select 1 from atem_archive.cancelled_google_appointments_20260925 b where b.appointment_id=a.id)) as tombstones_not_archived,
    (select count(*) from atem_archive.cancelled_google_appointments_20260925 b where jsonb_array_length(b.reservations)>0) as archived_with_reservations`,
  september_counts: `select appointment_date,count(*) as visible_events,
    count(*) filter (where google_calendar_id is not null) as current_google,
    count(*) filter (where google_calendar_id is null) as historical
    from public.appointments where appointment_date between date '2026-09-01' and date '2026-09-30'
      and appointment_date in (date '2026-09-16',date '2026-09-17',date '2026-09-18')
    group by appointment_date order by appointment_date`,
  sync_freshness: `select now() as checked_at,
    (select imported_once from public.calendar_sync_control where id=1) as imported_once,
    (select lease_until from public.calendar_sync_control where id=1) as lease_until,
    (select max(created_at) from public.appointments where google_calendar_id is not null) as latest_google_row_created,
    (select max(google_updated_at) from public.appointments where google_event->>'status'='confirmed') as latest_google_event_updated`,
  'apply-calendar-migration': fs.readFileSync(path.resolve(__dirname, '../migrations/20260921195933_calendar_removal_and_profile_permissions.sql'), 'utf8'),
  'archive-calendar-tombstones': fs.readFileSync(path.resolve(__dirname, '../migrations/20260925195133_archive_cancelled_google_events.sql'), 'utf8'),
  'cleanup-calendar-tombstones': fs.readFileSync(path.resolve(__dirname, 'cleanup_cancelled_google_batch.sql'), 'utf8'),
  'apply-workflow-assignment': fs.readFileSync(path.resolve(__dirname, '../migrations/20260928115601_workflow_assignment.sql'), 'utf8'),
  'apply-pattern-checkout-workflow': fs.readFileSync(path.resolve(__dirname, '../migrations/20260928121606_start_workflow_on_pattern_checkout.sql'), 'utf8'),
};

async function main() {
  const keys = process.argv.slice(2);
  if (!keys.length || keys.some(key => !Object.hasOwn(queries, key))) throw new Error(`Choose audits: ${Object.keys(queries).join(', ')}`);
  const writeMode = keys.some(key => ['apply-calendar-migration', 'archive-calendar-tombstones', 'cleanup-calendar-tombstones', 'apply-workflow-assignment', 'apply-pattern-checkout-workflow'].includes(key));
  if (writeMode && keys.length !== 1) throw new Error('Run each database maintenance action separately from audits.');
  const child = spawn('npx.cmd', ['-y', '@supabase/mcp-server-supabase@0.13.0', '--project-ref', projectRef, ...(!writeMode ? ['--read-only'] : [])], {
    cwd: path.resolve(__dirname, '..'), env: process.env, windowsHide: true, shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let sequence = 0;
  let connected = false;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  child.once('error', error => { for (const task of pending.values()) task.reject(error); });
  child.once('exit', code => { if (!connected) for (const task of pending.values()) task.reject(new Error(`MCP exited before initialization (${code}).`)); });
  const timer = setTimeout(() => { child.kill(); for (const task of pending.values()) task.reject(new Error('Supabase MCP timed out.')); }, 90000);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'atem-calendar-audit', version: '1.0.0' } });
    connected = true;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const available = await request('tools/list', {});
    const execute = available.tools?.find(tool => tool.name === 'execute_sql');
    if (!execute) throw new Error(`execute_sql unavailable. MCP tools: ${(available.tools || []).map(tool => tool.name).join(', ')}`);
    const executions = keys[0] === 'cleanup-calendar-tombstones' ? Array(7).fill(keys[0]) : keys;
    for (const [index, key] of executions.entries()) {
      const result = await request('tools/call', key === 'advisors_security'
        ? { name: 'get_advisors', arguments: { type: 'security' } }
        : { name: 'execute_sql', arguments: { query: queries[key] } });
      if (result.isError) throw new Error(`${key}: ${JSON.stringify(result.content)}`);
      process.stdout.write(`AUDIT ${key}${executions.length > 1 ? ` ${index + 1}/${executions.length}` : ''}\n`);
      for (const item of result.content || []) if (item.type === 'text') process.stdout.write(item.text + '\n');
    }
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
