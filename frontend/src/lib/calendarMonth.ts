import type { CalendarAppointment, CalendarTechnician } from '../components/CalendarEventEditor';

export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDate = (value: string) => new Date(`${value}T12:00:00`);
export const shiftDate = (value: string, days: number) => {
  const date = localDate(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

export function monthDays(month: string) {
  const first = localDate(`${month}-01`);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  const start = shiftDate(dateKey(first), -first.getDay());
  const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => shiftDate(start, index));
}

export function lastAppointmentDay(appointment: CalendarAppointment) {
  const start = appointment.appointment_date.slice(0, 10);
  const end = appointment.appointment_end_date?.slice(0, 10);
  if (!end || end <= start) return start;
  // Google uses an exclusive end for all-day events. Timed events ending at
  // midnight also occupy no time on their final date.
  return appointment.all_day || appointment.appointment_end_time?.slice(0, 5) === '00:00'
    ? shiftDate(end, -1) : end;
}

export function appointmentTeam(appointment: CalendarAppointment, technicians: CalendarTechnician[]) {
  if (appointment.technician_names || appointment.technician_name) return appointment.technician_names || appointment.technician_name || '';
  const ids = appointment.technician_ids || [appointment.technician_id];
  return technicians.filter(technician => ids.some(id => Number(id) === Number(technician.id))).map(technician => technician.name).join(', ');
}

export function appointmentStage(appointment: CalendarAppointment) {
  // Cancellation is a deletion operation, not a visible scheduling stage.
  // Old local labels must never hide an appointment that still exists.
  const cancelledLabel = /^(cancelad[oa]|cancelled|canceled)$/i;
  const workflow = cancelledLabel.test(appointment.workflow_status || '') ? undefined : appointment.workflow_status;
  const stages: Record<string, { label: string; tone: string }> = {
    'Data provisória': { label: 'Provisória', tone: 'provisional' },
    'Aguardando validação do supervisor': { label: 'Em validação', tone: 'provisional' },
    'Validado pelo supervisor': { label: 'Validada', tone: 'confirmed' },
    'Confirmado com cliente': { label: 'Confirmada', tone: 'confirmed' },
    'Em execução': { label: 'Em execução', tone: 'running' },
    'Concluído': { label: 'Concluída', tone: 'done' },
  };
  const full = workflow || (cancelledLabel.test(appointment.status || '') ? undefined : appointment.status) || 'Data provisória';
  return { ...(stages[full] || { label: full, tone: 'scheduled' }), full };
}

export function appointmentTime(appointment: CalendarAppointment, day?: string) {
  if (appointment.all_day) return 'Dia inteiro';
  if (day && day > appointment.appointment_date.slice(0, 10)) return 'Continuação';
  return appointment.appointment_time?.slice(0, 5) || 'Sem horário';
}

export const appointmentTitle = (appointment: CalendarAppointment) => appointment.client_name || appointment.title || 'Atendimento';
export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function groupMonthAppointments(days: string[], appointments: CalendarAppointment[], technicians: CalendarTechnician[], search = '', selectedTech = 'ALL') {
  const grouped = new Map(days.map(day => [day, [] as CalendarAppointment[]]));
  const query = normalizeSearch(search.trim());
  for (const appointment of appointments) {
    if (typeof appointment.appointment_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(appointment.appointment_date)) continue;
    const team = appointmentTeam(appointment, technicians);
    if (selectedTech !== 'ALL' && !normalizeSearch(team).includes(normalizeSearch(selectedTech))) continue;
    if (query && !normalizeSearch(`${appointment.title || ''} ${appointment.client_name || ''} ${appointment.client_address || ''} ${team}`).includes(query)) continue;
    const start = appointment.appointment_date.slice(0, 10);
    const end = lastAppointmentDay(appointment);
    if (start > days[days.length - 1] || end < days[0]) continue;
    for (const day of days) {
      if (day >= start && day <= end) grouped.get(day)?.push(appointment);
    }
  }
  for (const appointments of grouped.values()) appointments.sort((a, b) => Number(Boolean(b.all_day)) - Number(Boolean(a.all_day)) || (a.appointment_time || '99:99').localeCompare(b.appointment_time || '99:99') || appointmentTitle(a).localeCompare(appointmentTitle(b), 'pt-BR'));
  return grouped;
}
