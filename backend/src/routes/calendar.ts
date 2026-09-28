import { Router, Request, Response } from 'express';
import { AuthenticatedRequest, requireAuthentication, requireRole } from '../security/authService';
import { createCalendarAppointment, deleteCalendarAppointment, getCalendarAppointment, listWritableCalendars, queueCalendarEdit, resolveCalendarConflict } from '../services/calendarSyncEngine';
import { getGoogleCalendarSyncStatus, runGoogleCalendarSync } from '../services/googleCalendarSync';
import { schedulingRoles } from '../security/roles';

export const calendarRouter = Router();

calendarRouter.get('/calendar/calendars', requireAuthentication, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const calendars = await listWritableCalendars();
    return res.json({ success: true, calendars });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || 'Não foi possível carregar as agendas.' });
  }
});

calendarRouter.post('/appointments/calendar',
  requireAuthentication, requireRole(schedulingRoles), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const status = await getGoogleCalendarSyncStatus();
      if (!status.write_authorized) {
        return res.status(409).json({
          success: false,
          requires_write_auth: true,
          error: 'Autorize a edição do Google Agenda antes de criar novos atendimentos.'
        });
      }
      if (req.user!.role === 'commercial' && ((req.body.technician_ids?.length || 0) > 0 || req.body.technician_id || req.body.vehicle_id)) {
        return res.status(403).json({ success: false, error: 'A atribuição de equipe e veículo é feita pela supervisão.' });
      }
      const appointment = await createCalendarAppointment(req.body, req.user!.sub);
      return res.status(201).json({
        success: true,
        appointment: publicCalendarAppointment(appointment),
        message: 'Atendimento criado e sincronizado com o Google Agenda.'
      });
    } catch (error) {
      fail(res, error);
    }
  });

function fail(res: Response, error: any) {
  const status = error.status || (error.code === '40001' || error.code === '23505' ? 409
    : error.code === 'P0002' ? 404 : error.code === 'P0001' || error.code === '22023' ? 400 : 500);
  res.status(status).json({ success: false, error: status === 500
    ? 'Não foi possível salvar a agenda. Confira a conexão e a migração do banco.' : error.message });
  if (status === 500) console.error('[Google Agenda] Falha ao salvar:', error.message);
}

for (const resolve of [false, true]) {
  calendarRouter[resolve ? 'post' : 'patch'](`/appointments/:id/calendar${resolve ? '/resolve' : ''}`,
    requireAuthentication, requireRole(resolve ? ['admin', 'manager', 'supervisor'] : schedulingRoles), async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Agendamento inválido.' });
        if (!resolve && req.user!.role === 'commercial') {
          const current = await getCalendarAppointment(id);
          if (!['Data provisória', 'Validado pelo supervisor'].includes(current.workflow_status || 'Data provisória')) {
            return res.status(403).json({ success: false, error: 'O Comercial só pode editar as etapas que lhe pertencem.' });
          }
          if (!Array.isArray(req.body.technician_ids)) return res.status(400).json({ success: false, error: 'Equipe inválida.' });
          const requested = [...req.body.technician_ids].map(Number).sort((a, b) => a - b);
          const assigned = [...current.technician_ids].map(Number).sort((a, b) => a - b);
          if (JSON.stringify(requested) !== JSON.stringify(assigned)) {
            return res.status(403).json({ success: false, error: 'A equipe só pode ser alterada pela supervisão.' });
          }
        }
        if (!resolve || req.body.resolution === 'atem') {
          const status = await getGoogleCalendarSyncStatus();
          if (!status.write_authorized) return res.status(409).json({ success: false, requires_write_auth: true,
            error: 'Autorize a edição do Google Agenda antes de salvar alterações.' });
        }
        const appointment = await (resolve ? resolveCalendarConflict : queueCalendarEdit)(id, req.body, req.user!.sub);
        const pending = appointment.google_sync_status === 'pending';
        if (pending) void runGoogleCalendarSync('manual').catch(error => console.error('[Google Agenda] Edição na fila:', error.message));
        return res.status(pending ? 202 : 200).json({ success: true, appointment: publicCalendarAppointment(appointment),
          sync_status: appointment.google_sync_status, message: pending ? 'Alteração salva; envio ao Google em andamento.' : 'Agenda atualizada.' });
      } catch (error) { fail(res, error); }
    });
}

calendarRouter.delete('/appointments/:id', requireAuthentication, requireRole(['admin', 'manager', 'supervisor']), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Agendamento inválido.' });
    }
    const actorId = (req as any).user?.sub || 'user';
    const result = await deleteCalendarAppointment(id, actorId);
    return res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

// Raw Google payloads can contain guest emails and meeting credentials. Keep
// those server-side; the conflict dialog needs only the compared display fields.
export function publicCalendarAppointment(appointment: any) {
  const { google_event, google_etag, google_sync_conflict, ...result } = appointment;
  if (google_sync_conflict) {
    const { summary, location, start, end, status } = google_sync_conflict;
    result.google_sync_conflict = { summary, location, start, end, status };
  } else result.google_sync_conflict = null;
  return result;
}
