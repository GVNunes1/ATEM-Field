export type OperationalRole = 'technician' | 'supervisor' | 'manager' | 'commercial';

// Only the administrator-maintained job title is authoritative. Never accept
// a role from the login request, and never promote a technician record to admin.
export function roleFromSpecialty(value: unknown): OperationalRole {
  const title = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (/^(gerente|manager)\b/.test(title)) return 'manager';
  if (/^(supervisor|supervisora)\b/.test(title)) return 'supervisor';
  if (/^(comercial|commercial|vendas|sales)\b/.test(title)) return 'commercial';
  return 'technician';
}

export const schedulingRoles = ['admin', 'manager', 'supervisor', 'commercial'];

export const workflowStages = [
  'Data provisória',
  'Aguardando validação do supervisor',
  'Validado pelo supervisor',
  'Confirmado com cliente',
  'Em execução',
  'Concluído'
] as const;

export function missingWorkflowFields(appointment: Record<string, any>, nextStatus: string, hasAssignedTechnician: boolean): string[] {
  const nextIndex = workflowStages.findIndex(stage => stage === nextStatus);
  if (nextIndex < 1) return [];
  const missing: string[] = [];
  if (!String(appointment.title || '').trim()) missing.push('Título do atendimento');
  if (!String(appointment.client_name || '').trim()) missing.push('Cliente / unidade');
  if (!String(appointment.client_address || '').trim()) missing.push('Local / endereço');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appointment.appointment_date || ''))) missing.push('Data de início');
  if (!appointment.all_day && !/^\d{2}:\d{2}/.test(String(appointment.appointment_time || ''))) missing.push('Hora de início');
  if (!appointment.all_day && !/^\d{2}:\d{2}/.test(String(appointment.appointment_end_time || ''))) missing.push('Hora de término');
  if (nextIndex >= 2 && !hasAssignedTechnician) missing.push('Técnico escalado');
  return missing;
}

export function canReceiveWorkflowStage(stage: string, specialty: unknown, isAssignedTechnician: boolean): boolean {
  const role = roleFromSpecialty(specialty);
  if (stage === 'Aguardando validação do supervisor' || stage === 'Concluído') return role === 'supervisor';
  if (stage === 'Validado pelo supervisor' || stage === 'Data provisória') return role === 'commercial';
  if (stage === 'Confirmado com cliente' || stage === 'Em execução') return role === 'technician' && isAssignedTechnician;
  return false;
}

export function canTransitionWorkflow(role: string, from: string, to: string) {
  if (role === 'admin' || role === 'manager') return from !== to && workflowStages.includes(to as typeof workflowStages[number]);
  if (role === 'commercial') return (from === 'Data provisória' && to === 'Aguardando validação do supervisor')
    || (from === 'Validado pelo supervisor' && to === 'Confirmado com cliente');
  return role === 'supervisor' && ((from === 'Aguardando validação do supervisor' && to === 'Validado pelo supervisor')
    || (from === 'Confirmado com cliente' && to === 'Em execução')
    || (from === 'Em execução' && to === 'Concluído'));
}
