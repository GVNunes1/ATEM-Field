export const roleLabel = (role?: string) => ({ admin: 'Administrador', manager: 'Gerente', supervisor: 'Supervisor', commercial: 'Comercial', technician: 'Técnico de Campo' }[role || ''] || 'Técnico de Campo');
export const canManageSchedule = (role?: string) => ['admin', 'manager', 'supervisor'].includes(role || '');
export const canCreateSchedule = (role?: string) => canManageSchedule(role) || role === 'commercial';
export const canAdvanceSchedule = (role: string | undefined, from: string) => ['admin', 'manager'].includes(role || '')
  || (role === 'commercial' && ['Data provisória', 'Validado pelo supervisor'].includes(from))
  || (role === 'supervisor' && from === 'Aguardando validação do supervisor');
