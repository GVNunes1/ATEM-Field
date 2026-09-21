import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuthentication, requireRole } from '../security/authService';
import { queueCalendarEdit, resolveCalendarConflict } from '../services/calendarSyncEngine';
import { getGoogleCalendarSyncStatus, runGoogleCalendarSync } from '../services/googleCalendarSync';

export const calendarRouter = Router();

function fail(res: Response, error: any) {
  const status = error.status || (error.code === '40001' || error.code === '23505' ? 409
    : error.code === 'P0002' ? 404 : error.code === 'P0001' || error.code === '22023' ? 400 : 500);
  res.status(status).json({ success: false, error: status === 500
    ? 'Não foi possível salvar a agenda. Confira a conexão e a migração do banco.' : error.message });
  if (status === 500) console.error('[Google Agenda] Falha ao salvar:', error.message);
}

for (const resolve of [false, true]) {
  calendarRouter[resolve ? 'post' : 'patch'](`/appointments/:id/calendar${resolve ? '/resolve' : ''}`,
    requireAuthentication, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Agendamento inválido.' });
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
