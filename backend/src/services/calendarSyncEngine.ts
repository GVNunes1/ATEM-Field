import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabase';
import { executeCalendarPython } from './calendarConnector';
import { buildCalendarEdit, buildCalendarInsert, mapGoogleEvent } from './calendarMapping';

type Connector = (file: string, args?: string[], timeout?: number, input?: unknown) => Promise<any>;
async function rpc(name: string, input: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, input);
  if (error) throw error;
  return data;
}

async function technicians() {
  const { data, error } = await supabaseAdmin.from('technicians').select('id,name,status');
  if (error) throw error;
  return data || [];
}

async function ingest(calendarId: string, event: any, teamList: any[], writable: boolean, resolveId?: number, revision?: number) {
  const { values, team } = mapGoogleEvent(event, teamList);
  return rpc('calendar_ingest', {
    p_calendar: calendarId, p_event: event, p_values: values, p_team: team,
    p_writable: writable, p_resolve_id: resolveId || null, p_revision: revision ?? null
  });
}

export async function calendarSyncCounts() {
  const [pending, conflicts, errors] = await Promise.all(['pending','conflict','error'].map(status =>
    supabaseAdmin.from('calendar_outbox').select('id', { head: true, count: 'exact' }).eq('status', status)));
  const error = pending.error || conflicts.error || errors.error;
  if (error) return { setup_required: true, pending: 0, conflicts: 0, errors: 0, setup_error: 'A migração da agenda ainda não está disponível.' };
  return { setup_required: false, pending: pending.count || 0, conflicts: conflicts.count || 0, errors: errors.count || 0 };
}

export async function synchronizeCalendar(execute: Connector) {
  const owner = randomUUID();
  if (!await rpc('calendar_lease', { p_owner: owner })) return { busy: true, received: 0, created: 0, updated: 0, cancelled: 0, newTechnicians: 0, calendars: 0, warnings: ['Sincronização em andamento.'] };
  const renew = async () => {
    if (!await rpc('calendar_lease', { p_owner: owner })) throw new Error('Outra instância assumiu a sincronização. Tente novamente.');
  };
  try {
    const { data: control, error: controlError } = await supabaseAdmin.from('calendar_sync_control').select('imported_once').eq('id',1).single();
    if (controlError) throw controlError;
    const teamList = await technicians();
    await renew();
    const parsed = await execute('import_agenda.py', ['--defer-checkpoint', ...(!control.imported_once ? ['--full'] : [])]);
    const result = { received: (parsed.data || []).length, created: 0, updated: 0, cancelled: 0, newTechnicians: 0,
      calendars: parsed.calendar_count || 0, warnings: parsed.warnings || [], exported: 0 };
    for (const item of parsed.data || []) {
      await renew();
      const change = await ingest(item.google_calendar_id, item.google_event, teamList, item.calendar_writable === true);
      if (!change.unchanged && !change.preserved_local) result.updated++;
    }
    for (const removed of parsed.deleted_events || []) {
      await renew();
      const change = await ingest(removed.calendar_id, { id: removed.event_id, etag: removed.etag, updated: removed.updated, status: 'cancelled' }, teamList, false);
      if (change.cancelled) result.cancelled++;
    }
    // Cursor only advances after all DB transactions succeeded. Failed ingestion
    // is replayed on the next run, with etag-based no-op detection.
    await renew();
    await execute('import_agenda.py', ['--commit-checkpoint'], 30_000, { next_sync_state: parsed.next_sync_state });
    const { error: markError } = await supabaseAdmin.from('calendar_sync_control').update({ imported_once: true }).eq('id',1).eq('lease_owner',owner);
    if (markError) throw markError;

    const { data: jobs, error: jobsError } = await supabaseAdmin.from('calendar_outbox').select('*')
      .in('status',['pending','error']).order('created_at').limit(50);
    if (jobsError) throw jobsError;
    for (const job of jobs || []) {
      await renew();
      try {
        const output = await execute('write_calendar_event.py', [], 90_000, {
          calendar_id: job.calendar_id, event_id: job.event_id, expected_etag: job.expected_etag,
          event_patch: job.event_patch, operation_id: job.id
        });
        await renew();
        await ingest(job.calendar_id, output.event, teamList, true);
        result.exported++;
      } catch (error: any) {
        await renew();
        await rpc('calendar_fail', { p_operation: job.id, p_error: error.message || 'Falha ao atualizar Google Agenda.', p_remote: error.details?.remote_event || null });
        result.warnings.push(error.message || 'Uma edição aguarda sincronização.');
      }
    }
    return result;
  } finally {
    await rpc('calendar_lease', { p_owner: owner, p_release: true });
  }
}

export async function getCalendarAppointment(id: number) {
  const [{ data: appointment, error }, { data: links, error: linksError }] = await Promise.all([
    supabaseAdmin.from('appointments').select('*').eq('id',id).maybeSingle(),
    supabaseAdmin.from('appointment_technicians').select('technician_id').eq('appointment_id',id)
  ]);
  if (error || linksError) throw error || linksError;
  if (!appointment) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });
  return { ...appointment, technician_ids: (links || []).map(link => link.technician_id) };
}

export async function queueCalendarEdit(id: number, input: any, actorId: string) {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw Object.assign(new Error('Atualize a agenda antes de editar.'),{status:400});
  const appointment = await getCalendarAppointment(id);
  if (appointment.google_sync_revision !== input.expected_revision) throw Object.assign(new Error('A agenda mudou. Atualize antes de salvar.'), {status:409});
  let edit;
  try { edit = buildCalendarEdit(input, appointment, await technicians()); }
  catch (error: any) { throw Object.assign(error, {status:400}); }
  const { values, eventPatch } = edit;
  if (!Object.keys(eventPatch).length) return appointment;
  return rpc('calendar_queue_edit', { p_id: id, p_revision: input.expected_revision, p_values: values, p_patch: eventPatch, p_actor: actorId });
}

export async function resolveCalendarConflict(id: number, input: any, actorId: string) {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 || !['google','atem'].includes(input.resolution)) {
    throw Object.assign(new Error('Resolução de conflito inválida.'),{status:400});
  }
  const appointment = await getCalendarAppointment(id);
  if (appointment.google_sync_status !== 'conflict' || !appointment.google_sync_conflict) throw Object.assign(new Error('Atualize a agenda: não há conflito para resolver.'), {status:409});
  if (input.resolution === 'atem') {
    return rpc('calendar_queue_edit', { p_id: id, p_revision: input.expected_revision, p_values: {}, p_patch: {}, p_actor: actorId, p_resolution: true });
  }
  await ingest(appointment.google_calendar_id, appointment.google_sync_conflict, await technicians(), appointment.calendar_writable, id, input.expected_revision);
  return getCalendarAppointment(id);
}

export async function listWritableCalendars(execute: Connector = executeCalendarPython) {
  try {
    const result = await execute('import_agenda.py', ['--list-calendars'], 30_000);
    if (result && Array.isArray(result.calendars)) {
      return result.calendars;
    }
  } catch (err: any) {
    console.warn('[Google Agenda] Não foi possível listar agendas via conector:', err?.message);
  }
  const { data } = await supabaseAdmin.from('appointments')
    .select('google_calendar_id')
    .not('google_calendar_id', 'is', null);
  const distinct = [...new Set((data || []).map(r => r.google_calendar_id).filter(Boolean))];
  if (!distinct.length) {
    distinct.push(process.env.GOOGLE_CALENDAR_ID || 'tecnicosmultmed@gmail.com');
  }
  return distinct.map(id => ({
    id,
    name: id === 'tecnicosmultmed@gmail.com' ? 'Geral (tecnicosmultmed@gmail.com)' : id,
    writable: true,
    primary: id === 'tecnicosmultmed@gmail.com'
  }));
}

export async function createCalendarAppointment(input: any, actorId: string, execute: Connector = executeCalendarPython) {
  const teamList = await technicians();
  const defaultCalendar = process.env.GOOGLE_CALENDAR_ID || 'tecnicosmultmed@gmail.com';
  let insertData;
  try {
    insertData = buildCalendarInsert(input, teamList, defaultCalendar);
  } catch (error: any) {
    throw Object.assign(error, { status: 400 });
  }
  const { values, eventPatch, calendarId } = insertData;
  if (!calendarId) {
    throw Object.assign(new Error('Agenda de destino não informada.'), { status: 400 });
  }

  const operationId = randomUUID();
  let output: any;
  try {
    output = await execute('write_calendar_event.py', [], 60_000, {
      operation: 'insert',
      calendar_id: calendarId,
      operation_id: operationId,
      event_patch: eventPatch
    });
  } catch (error: any) {
    throw Object.assign(
      new Error(error.message || 'Falha ao criar evento no Google Agenda.'),
      { status: error.authRequired ? 401 : 502, details: error.details }
    );
  }

  if (!output || !output.event) {
    throw Object.assign(new Error('Resposta inválida do Google Agenda ao criar evento.'), { status: 502 });
  }

  const change = await ingest(calendarId, output.event, teamList, true);
  if (!change || !change.id) {
    throw Object.assign(new Error('Falha ao registrar agendamento no banco de dados.'), { status: 500 });
  }

  return getCalendarAppointment(change.id);
}

export async function deleteCalendarAppointment(id: number, actorId: string, execute: Connector = executeCalendarPython) {
  const { data: appointment, error } = await supabaseAdmin.from('appointments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!appointment) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });

  // 1. Tentar deletar do Google Agenda se estiver vinculado
  if (appointment.google_calendar_id && appointment.google_event_id) {
    try {
      const operationId = randomUUID();
      await execute('write_calendar_event.py', [], 30_000, {
        operation: 'delete',
        calendar_id: appointment.google_calendar_id,
        event_id: appointment.google_event_id,
        operation_id: operationId
      });
    } catch (gErr: any) {
      console.warn('[Google Agenda] Aviso ao excluir evento remoto:', gErr.message || gErr);
    }
  }

  // 2. Limpar calendar_outbox (que tem ON DELETE RESTRICT)
  await supabaseAdmin.from('calendar_outbox').delete().eq('appointment_id', id);

  // 3. Limpar tabelas associadas
  await Promise.all([
    supabaseAdmin.from('appointment_technicians').delete().eq('appointment_id', id),
    supabaseAdmin.from('appointment_equipments').delete().eq('appointment_id', id),
    supabaseAdmin.from('reservations').delete().eq('appointment_id', id),
    supabaseAdmin.from('notification_logs').delete().eq('appointment_id', id)
  ]);

  // 4. Deletar o agendamento
  const { error: delError } = await supabaseAdmin.from('appointments').delete().eq('id', id);
  if (delError) throw delError;

  return { success: true, message: 'Atendimento excluído com sucesso.' };
}

