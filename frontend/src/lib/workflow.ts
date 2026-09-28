import type { CalendarAppointment } from '../components/CalendarEventEditor';

export const workflowStages = [
  { id: 'Data provisória', short: 'Provisória', tone: 'provisional', owner: 'Comercial' },
  { id: 'Aguardando validação do supervisor', short: 'Em validação', tone: 'review', owner: 'Supervisão' },
  { id: 'Validado pelo supervisor', short: 'Validado', tone: 'validated', owner: 'Comercial' },
  { id: 'Confirmado com cliente', short: 'Confirmado', tone: 'confirmed', owner: 'Equipe' },
  { id: 'Em execução', short: 'Em execução', tone: 'running', owner: 'Equipe' },
  { id: 'Concluído', short: 'Concluído', tone: 'done', owner: 'Arquivo' }
] as const;

export type WorkflowStage = typeof workflowStages[number]['id'];
export const workflowStatus = (appointment: CalendarAppointment): WorkflowStage | null =>
  workflowStages.find(stage => stage.id === (appointment.workflow_status || 'Data provisória'))?.id || null;

export function nextWorkflowStatus(status: WorkflowStage): WorkflowStage | null {
  return workflowStages[workflowStages.findIndex(stage => stage.id === status) + 1]?.id || null;
}

export function canAdvanceWorkflow(role: string | undefined, from: WorkflowStage): boolean {
  if (!nextWorkflowStatus(from)) return false;
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'commercial') return from === 'Data provisória' || from === 'Validado pelo supervisor';
  return role === 'supervisor' && (from === 'Aguardando validação do supervisor' || from === 'Confirmado com cliente' || from === 'Em execução');
}

export function missingWorkflowFields(appointment: CalendarAppointment, next: WorkflowStage): string[] {
  const missing: string[] = [];
  if (!String(appointment.title || '').trim()) missing.push('Título');
  if (!String(appointment.client_name || '').trim()) missing.push('Cliente');
  if (!String(appointment.client_address || '').trim()) missing.push('Local');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appointment.appointment_date || ''))) missing.push('Data');
  if (!appointment.all_day && !/^\d{2}:\d{2}/.test(String(appointment.appointment_time || ''))) missing.push('Hora inicial');
  if (!appointment.all_day && !/^\d{2}:\d{2}/.test(String(appointment.appointment_end_time || ''))) missing.push('Hora final');
  if (workflowStages.findIndex(stage => stage.id === next) >= 2 && !((appointment.technician_ids?.length || 0) > 0 || appointment.technician_id)) missing.push('Técnico');
  return missing;
}
