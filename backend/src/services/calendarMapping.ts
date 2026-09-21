import { parseAndMatchTechnicians } from './technicianMatcher';

export const CALENDAR_TIME_ZONE = 'America/Sao_Paulo';
const TEAM_BLOCK = /\[ATEM FIELD\][\s\S]*?\[\/ATEM FIELD\]/g;

export function dateTimeParts(value: { date?: string; dateTime?: string }) {
  if (value?.date) return { date: value.date, time: '00:00' };
  if (!value?.dateTime) return { date: null, time: null };
  const date = new Date(value.dateTime);
  if (!Number.isFinite(date.getTime())) throw new Error('Horário Google inválido.');
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

export function mapGoogleEvent(event: any, technicians: any[]) {
  if (event.status === 'cancelled') return { values: {}, team: [] };
  const start = dateTimeParts(event.start);
  const end = dateTimeParts(event.end);
  const description = String(event.description || '');
  const block = description.match(/\[ATEM FIELD\]([\s\S]*?)\[\/ATEM FIELD\]/);
  const teamText = (block ? block[1] : description).replace(/Técnicos?:/gi, '').split(/_{10,}|Microsoft Teams|Join the meeting now/i)[0];
  const team = parseAndMatchTechnicians(teamText, technicians).matched.map(t => t.id);
  return {
    team,
    values: {
      title: event.summary || 'Atendimento Agendado',
      client_name: event.extendedProperties?.private?.atem_client_name || event.summary || 'Atendimento Agendado',
      client_address: event.location || '',
      appointment_date: start.date, appointment_time: start.time,
      appointment_end_date: end.date, appointment_end_time: end.time,
      all_day: Boolean(event.start?.date)
    }
  };
}

function validDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function buildCalendarEdit(input: any, appointment: any, technicians: any[]) {
  const title = String(input.title || '').trim();
  const clientName = String(input.client_name || title).trim();
  const address = String(input.client_address || '').trim();
  if (!title || title.length > 500 || clientName.length > 500 || address.length > 2000) throw new Error('Confira o título, cliente e endereço.');
  if (!validDate(input.appointment_date) || !validDate(input.appointment_end_date)) throw new Error('Informe datas válidas de início e término.');
  if (typeof input.all_day !== 'boolean') throw new Error('Informe se o evento é de dia inteiro.');
  const allDay = input.all_day;
  const startTime = allDay ? '00:00' : input.appointment_time;
  const endTime = allDay ? '00:00' : input.appointment_end_time;
  if (![startTime, endTime].every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new Error('Informe horários válidos.');
  if (`${input.appointment_end_date}T${endTime}` <= `${input.appointment_date}T${startTime}`) throw new Error('O término deve ser posterior ao início.');
  if (!Array.isArray(input.technician_ids) || input.technician_ids.length > 100 || input.technician_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Equipe inválida.');
  const ids = [...new Set<number>(input.technician_ids)];
  const team = ids.map(id => technicians.find(t => Number(t.id) === id));
  if (team.some(t => !t)) throw new Error('Um integrante da equipe não foi encontrado.');
  const values = { title, client_name: clientName, client_address: address,
    appointment_date: input.appointment_date, appointment_time: startTime,
    appointment_end_date: input.appointment_end_date, appointment_end_time: endTime,
    all_day: allDay, technician_ids: ids };
  const raw = appointment.google_event || {};
  const eventPatch: any = {};
  if (title !== appointment.title) eventPatch.summary = title;
  if (address !== (appointment.client_address || '')) eventPatch.location = address;
  if (clientName !== appointment.client_name || (eventPatch.summary && raw.extendedProperties?.private?.atem_client_name !== clientName)) {
    eventPatch.extendedProperties = { private: { atem_client_name: clientName } };
  }
  const currentIds = (appointment.technician_ids || []).map(Number).sort((a,b) => a-b);
  if (JSON.stringify([...ids].sort((a,b) => a-b)) !== JSON.stringify(currentIds)) {
    const original = String(raw.description || '').replace(TEAM_BLOCK, '').trim();
    eventPatch.description = `${original}${original ? '\n\n' : ''}[ATEM FIELD]\nTécnicos: ${team.map(t => t.name).join(', ')}\n[/ATEM FIELD]`;
  }
  if (allDay !== appointment.all_day || values.appointment_date !== appointment.appointment_date
    || startTime !== appointment.appointment_time || values.appointment_end_date !== appointment.appointment_end_date
    || endTime !== appointment.appointment_end_time) {
    eventPatch.start = allDay ? { date: values.appointment_date } : { dateTime: `${values.appointment_date}T${startTime}:00`, timeZone: CALENDAR_TIME_ZONE };
    eventPatch.end = allDay ? { date: values.appointment_end_date } : { dateTime: `${values.appointment_end_date}T${endTime}:00`, timeZone: CALENDAR_TIME_ZONE };
  }
  return { values, eventPatch };
}
