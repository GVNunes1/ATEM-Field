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

export function canTransitionWorkflow(role: string, from: string, to: string) {
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'commercial') return (from === 'Data provisória' && to === 'Aguardando validação do supervisor')
    || (from === 'Validado pelo supervisor' && to === 'Confirmado com cliente');
  return role === 'supervisor' && from === 'Aguardando validação do supervisor' && to === 'Validado pelo supervisor';
}
