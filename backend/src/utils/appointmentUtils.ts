export function isNonTechnicalAppointment(appointment: { title?: string | null; client_name?: string | null } | null | undefined): boolean {
  if (!appointment) return false;
  const title = (appointment.title || '').trim();
  const clientName = (appointment.client_name || '').trim();
  const rawText = `${title} ${clientName}`;
  const text = rawText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!text) return false;

  const isSobreaviso = text.includes('sobreaviso') || text.includes('sobre aviso') || text.includes('sobraviso') || text.includes('sobra aviso');
  const isExamePeriodico = text.includes('periodic') || (text.includes('exame') && (text.includes('periodi') || text.includes('medico')));
  const isAniversario = text.includes('aniversario');
  const isRevisao = text.includes('revisao');
  const isTreinamento = text.includes('treinamento');
  const isHoliday = text.includes('confratenizacao') || text.includes('carnaval') || text.includes('corpus christi');

  return isSobreaviso || isExamePeriodico || isAniversario || isRevisao || isTreinamento || isHoliday;
}
