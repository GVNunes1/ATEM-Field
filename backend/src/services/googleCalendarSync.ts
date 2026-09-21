import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { supabaseAdmin } from './supabase';
import { parseAndMatchTechnicians } from './technicianMatcher';
import { calendarSyncCounts, synchronizeCalendar } from './calendarSyncEngine';
import { executeCalendarPython, scriptPath } from './calendarConnector';

export { executeCalendarPython };

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_SYNC_SCHEDULE = '*/10 * * * *';
const defaultTechnicianAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=250&q=80';

type SyncTrigger = 'startup' | 'schedule' | 'manual' | 'oauth';

interface CalendarEventPayload {
  external_id: string;
  title: string;
  client_name: string;
  client_address: string;
  appointment_date: string;
  appointment_time: string;
  technicians_raw?: string;
}

interface ImportResult {
  success: boolean;
  auth_required?: boolean;
  error?: string;
  data?: CalendarEventPayload[];
  deleted_external_ids?: string[];
  warnings?: string[];
  calendar_count?: number;
  incremental?: boolean;
}

interface RuntimeStatus {
  automatic: boolean;
  schedule: string;
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastTrigger: SyncTrigger | null;
  lastResult: null | {
    received: number;
    created: number;
    updated: number;
    cancelled: number;
    newTechnicians: number;
    calendars: number;
    warnings: string[];
  };
}

const syncSchedule = process.env.GOOGLE_CALENDAR_SYNC_CRON?.trim() || DEFAULT_SYNC_SCHEDULE;
let syncPromise: Promise<any> | null = null;
let oauthProcess: ChildProcessWithoutNullStreams | null = null;
const runtimeStatus: RuntimeStatus = {
  automatic: process.env.GOOGLE_CALENDAR_SYNC_ENABLED !== 'false',
  schedule: syncSchedule,
  running: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastTrigger: null,
  lastResult: null
};

function normalizeNameKey(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '');
}

function stripCalendarInviteNoise(value: string) {
  const markers = [
    /_{10,}\s*Microsoft Teams/i,
    /Microsoft Teams Need help/i,
    /Join the meeting now/i,
    /meetup-join/i,
    /The information contained in this message/i
  ];
  const indexes = markers.map(marker => value.search(marker)).filter(index => index >= 0);
  return indexes.length ? value.slice(0, Math.min(...indexes)) : value;
}

function sanitizeTechnicianName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').replace(/\s*[-–—]+\s*$/, '').trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{M}\p{N}\s.'’\-]*$/u.test(name)) return null;
  if ((name.match(/\p{N}/gu) || []).length > 3) return null;
  if (/\b(teams|meeting|meetup|passcode|dial|conference|recipient|forwarding|dissemination|reproduction)\b/i.test(name)) return null;
  return name;
}

async function fetchAllRows(table: string, columns = '*') {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await (supabaseAdmin.from(table as any) as any)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function inferCategoryId(item: CalendarEventPayload) {
  const text = `${item.title} ${item.client_name}`.toLocaleLowerCase('pt-BR');
  if (text.includes('monitor') || text.includes('mp') || text.includes('sinais')) return 2;
  if (text.includes('ventila') || text.includes('cpap') || text.includes('tecme')) return 3;
  if (text.includes('bomba') || text.includes('infus')) return 4;
  if (text.includes('ultrassom') || text.includes('eco')) return 5;
  if (text.includes('autoclave') || text.includes('cisa') || text.includes('esteriliza')) return 6;
  if (text.includes('bisturi') || text.includes('eletrocirurgico')) return 7;
  return 1;
}

async function persistCalendarChanges(parsed: ImportResult) {
  const items = parsed.data || [];
  const existingTechs = await fetchAllRows('technicians');
  const existingAppointments = await fetchAllRows('appointments', 'id, external_id');
  const existingEquipmentLinks = await fetchAllRows('appointment_equipments', 'appointment_id');
  const techMapByName = new Map(existingTechs.map((technician: any) => [normalizeNameKey(technician.name), technician]));
  const appointmentIdByExternalId = new Map(
    existingAppointments.filter((appointment: any) => appointment.external_id).map((appointment: any) => [appointment.external_id, appointment.id])
  );
  const appointmentsWithEquipment = new Set(existingEquipmentLinks.map((equipment: any) => equipment.appointment_id));

  let created = 0;
  let updated = 0;
  let newTechnicians = 0;

  for (const item of items) {
    const rawTechnicians = stripCalendarInviteNoise(item.technicians_raw || '')
      .replace(/Técnicos?:/gi, '')
      .replace(/\([^)]*\)/g, '')
      .trim();
    const { matched } = parseAndMatchTechnicians(rawTechnicians, existingTechs);
    const technicianIds = matched.map(t => t.id);
    const technicianNames = matched.map(t => t.name);

    const existingId = appointmentIdByExternalId.get(item.external_id);
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .upsert({
        external_id: item.external_id,
        title: item.title,
        client_name: item.client_name,
        client_address: item.client_address,
        client_contact: 'Sincronizado automaticamente do Google Agenda',
        technician_id: technicianIds[0] || null,
        technician_names: technicianNames.length ? technicianNames.join(', ') : 'Equipe de Campo',
        appointment_date: item.appointment_date,
        appointment_time: item.appointment_time
      }, { onConflict: 'external_id' })
      .select('id')
      .single();
    if (appointmentError || !appointment) throw appointmentError || new Error('Falha ao salvar atendimento.');

    const appointmentId = appointment.id;
    appointmentIdByExternalId.set(item.external_id, appointmentId);
    if (existingId) updated += 1;
    else created += 1;

    const { error: deleteLinksError } = await supabaseAdmin
      .from('appointment_technicians')
      .delete()
      .eq('appointment_id', appointmentId);
    if (deleteLinksError) throw deleteLinksError;
    if (technicianIds.length) {
      const { error: linkError } = await supabaseAdmin.from('appointment_technicians').insert(
        technicianIds.map(technicianId => ({ appointment_id: appointmentId, technician_id: technicianId }))
      );
      if (linkError) throw linkError;
    }

    if (!appointmentsWithEquipment.has(appointmentId)) {
      const { error: equipmentError } = await supabaseAdmin.from('appointment_equipments').insert({
        appointment_id: appointmentId,
        category_id: inferCategoryId(item),
        model: item.client_name,
        serial_number: `S/N-REG-${item.appointment_date.replace(/-/g, '')}`,
        tag: `PAT-HOSP-${appointmentId}`,
        sector: 'Assistência Técnica'
      });
      if (equipmentError) throw equipmentError;
      appointmentsWithEquipment.add(appointmentId);
    }
  }

  const deletedExternalIds = parsed.deleted_external_ids || [];
  let cancelled = 0;
  for (let index = 0; index < deletedExternalIds.length; index += 100) {
    const batch = deletedExternalIds.slice(index, index + 100);
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'Cancelado' })
      .in('external_id', batch)
      .select('id');
    if (error) throw error;
    cancelled += data?.length || 0;
  }

  return { received: items.length, created, updated, cancelled, newTechnicians };
}

async function persistCalendarChangesInBatches(parsed: ImportResult) {
  const items = parsed.data || [];
  const [existingTechs, existingAppointments, existingEquipmentLinks] = await Promise.all([
    fetchAllRows('technicians'),
    fetchAllRows('appointments', 'id, external_id'),
    fetchAllRows('appointment_equipments', 'appointment_id')
  ]);
  const namesByExternalId = new Map<string, any[]>();

  for (const item of items) {
    const rawTechnicians = stripCalendarInviteNoise(item.technicians_raw || '')
      .replace(/Técnicos?:/gi, '')
      .replace(/\([^)]*\)/g, '')
      .trim();
    const { matched } = parseAndMatchTechnicians(rawTechnicians, existingTechs);
    namesByExternalId.set(item.external_id, matched);
  }

  const newTechnicians = 0;

  const existingIdByExternalId = new Map(
    existingAppointments.filter((appointment: any) => appointment.external_id).map((appointment: any) => [appointment.external_id, appointment.id])
  );
  const appointmentRows = items.map(item => {
    const matchedTechs = namesByExternalId.get(item.external_id) || [];
    return {
      external_id: item.external_id,
      title: item.title,
      client_name: item.client_name,
      client_address: item.client_address,
      client_contact: 'Sincronizado automaticamente do Google Agenda',
      technician_id: matchedTechs[0]?.id || null,
      technician_names: matchedTechs.length ? matchedTechs.map((t: any) => t.name).join(', ') : 'Equipe de Campo',
      appointment_date: item.appointment_date,
      appointment_time: item.appointment_time
    };
  });

  const appointmentIdByExternalId = new Map(existingIdByExternalId);
  for (let index = 0; index < appointmentRows.length; index += 100) {
    const batch = appointmentRows.slice(index, index + 100);
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .upsert(batch, { onConflict: 'external_id' })
      .select('id, external_id');
    if (error) throw error;
    (data || []).forEach(appointment => {
      if (appointment.external_id) appointmentIdByExternalId.set(appointment.external_id, appointment.id);
    });
  }

  const affectedAppointmentIds = items
    .map(item => appointmentIdByExternalId.get(item.external_id))
    .filter((id): id is number => typeof id === 'number');
  for (let index = 0; index < affectedAppointmentIds.length; index += 100) {
    const { error } = await supabaseAdmin
      .from('appointment_technicians')
      .delete()
      .in('appointment_id', affectedAppointmentIds.slice(index, index + 100));
    if (error) throw error;
  }

  const junctionRows = items.flatMap(item => {
    const appointmentId = appointmentIdByExternalId.get(item.external_id);
    if (!appointmentId) return [];
    const matchedTechs = namesByExternalId.get(item.external_id) || [];
    return matchedTechs.map((t: any) => ({ appointment_id: appointmentId, technician_id: t.id }));
  });
  for (let index = 0; index < junctionRows.length; index += 500) {
    const { error } = await supabaseAdmin.from('appointment_technicians').insert(junctionRows.slice(index, index + 500));
    if (error) throw error;
  }

  const appointmentsWithEquipment = new Set(existingEquipmentLinks.map((equipment: any) => equipment.appointment_id));
  const equipmentRows = items.flatMap(item => {
    const appointmentId = appointmentIdByExternalId.get(item.external_id);
    if (!appointmentId || appointmentsWithEquipment.has(appointmentId)) return [];
    appointmentsWithEquipment.add(appointmentId);
    return [{
      appointment_id: appointmentId,
      category_id: inferCategoryId(item),
      model: item.client_name,
      serial_number: `S/N-REG-${item.appointment_date.replace(/-/g, '')}`,
      tag: `PAT-HOSP-${appointmentId}`,
      sector: 'Assistência Técnica'
    }];
  });
  for (let index = 0; index < equipmentRows.length; index += 500) {
    const { error } = await supabaseAdmin.from('appointment_equipments').insert(equipmentRows.slice(index, index + 500));
    if (error) throw error;
  }

  let cancelled = 0;
  const deletedExternalIds = parsed.deleted_external_ids || [];
  for (let index = 0; index < deletedExternalIds.length; index += 100) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'Cancelado' })
      .in('external_id', deletedExternalIds.slice(index, index + 100))
      .select('id');
    if (error) throw error;
    cancelled += data?.length || 0;
  }

  return {
    received: items.length,
    created: items.filter(item => !existingIdByExternalId.has(item.external_id)).length,
    updated: items.filter(item => existingIdByExternalId.has(item.external_id)).length,
    cancelled,
    newTechnicians
  };
}

async function synchronize(trigger: SyncTrigger) {
  runtimeStatus.running = true;
  runtimeStatus.lastAttemptAt = new Date().toISOString();
  runtimeStatus.lastTrigger = trigger;
  try {
    const result = await synchronizeCalendar(executeCalendarPython);
    runtimeStatus.lastSuccessAt = new Date().toISOString();
    runtimeStatus.lastError = null;
    runtimeStatus.lastResult = result;
    console.log(`[Google Agenda] Sincronização ${trigger}: ${result.created} novo(s), ${result.updated} atualizado(s), ${result.cancelled} cancelado(s).`);
    return result;
  } catch (error: any) {
    runtimeStatus.lastError = error?.message || String(error);
    throw error;
  } finally {
    runtimeStatus.running = false;
  }
}

export function runGoogleCalendarSync(trigger: SyncTrigger = 'manual') {
  if (syncPromise) return syncPromise;
  syncPromise = synchronize(trigger).finally(() => { syncPromise = null; });
  return syncPromise;
}

export async function getGoogleCalendarSyncStatus() {
  let authentication: any;
  try {
    authentication = await executeCalendarPython('import_agenda.py', ['--status'], 30_000);
  } catch (error: any) {
    authentication = {
      configured: false,
      authenticated: false,
      refreshable: false,
      requires_auth: true,
      error: error?.message || String(error)
    };
  }
  return {
    ...runtimeStatus,
    ...authentication,
    bidirectional: true,
    can_authorize_browser: process.env.NODE_ENV !== 'production',
    ...(await calendarSyncCounts())
  };
}

export function startGoogleCalendarAuthorization(): Promise<{ auth_url: string }> {
  if (process.env.NODE_ENV === 'production') {
    return Promise.reject(new Error(
      'A credencial Google atual é do tipo Desktop e precisa ser renovada no computador do administrador. ' +
      'Execute renovar-google-agenda.bat e atualize GOOGLE_CALENDAR_TOKEN_JSON na Northflank.'
    ));
  }
  if (oauthProcess) return Promise.reject(new Error('Já existe uma autorização Google em andamento.'));
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_EXECUTABLE?.trim() || 'python';
    const child = spawn(python, ['-u', scriptPath('google_auth_flow.py')], {
      cwd: path.resolve(__dirname, '../..'),
      windowsHide: true,
      env: process.env
    });
    oauthProcess = child;
    let stdout = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Timeout ao iniciar a autorização Google.'));
      }
    }, 15_000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (settled || newline < 0) return;
      try {
        const parsed = JSON.parse(stdout.slice(0, newline).trim());
        settled = true;
        clearTimeout(timeout);
        if (!parsed.success || !parsed.auth_url) reject(new Error(parsed.error || 'Link Google indisponível.'));
        else resolve({ auth_url: parsed.auth_url });
      } catch {
        // Wait for a complete JSON line.
      }
    });
    child.stderr.on('data', chunk => console.error('[Google OAuth]', chunk.toString('utf8').trim()));
    child.on('error', error => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('close', code => {
      oauthProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Autorização Google finalizada antes de gerar o link (código ${code}).`));
      } else if (code === 0 && runtimeStatus.automatic) {
        setTimeout(() => void runGoogleCalendarSync('oauth').catch(error => {
          console.error('[Google Agenda] Falha após OAuth:', error);
        }), 1_000);
      }
    });
  });
}

export function setupGoogleCalendarSync() {
  if (!runtimeStatus.automatic) {
    console.log('[Google Agenda] Sincronização automática desativada por configuração.');
    return;
  }
  if (!cron.validate(syncSchedule)) {
    runtimeStatus.automatic = false;
    runtimeStatus.lastError = `Expressão cron inválida: ${syncSchedule}`;
    console.error(`[Google Agenda] ${runtimeStatus.lastError}`);
    return;
  }

  console.log(`[Google Agenda] Sincronização automática ativa (${syncSchedule}, ${SAO_PAULO_TIME_ZONE}).`);
  cron.schedule(syncSchedule, () => {
    void runGoogleCalendarSync('schedule').catch(error => {
      console.error('[Google Agenda] Falha agendada:', error?.message || error);
    });
  }, { timezone: SAO_PAULO_TIME_ZONE });

  setTimeout(() => {
    void runGoogleCalendarSync('startup').catch((error: any) => {
      if (error?.authRequired) console.warn('[Google Agenda] Aguardando autorização inicial da conta Google.');
      else console.error('[Google Agenda] Falha na sincronização inicial:', error?.message || error);
    });
  }, 3_000);
}
