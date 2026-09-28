import { isNonTechnicalAppointment } from '../utils/appointmentUtils';

export interface OperationalAlert {
  id: string;
  appointment_id: number;
  severity: 'warning' | 'critical';
  kind: string;
  message: string;
}

export interface AppointmentReadiness {
  appointment_id: number;
  state: 'ready' | 'attention' | 'planning';
  checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  missing: string[];
}

const activeReservation = (status: string) => ['Reservado', 'Em Uso', 'Aguardando Aprovação'].includes(status);
const confirmedStages = new Set(['Confirmado com cliente', 'Em execução', 'Concluído']);

export function buildOperationalInsights(
  appointments: any[], reservations: any[], analyzers: any[],
  vehicles: any[], activeUsages: any[], now = new Date()
): { readiness: AppointmentReadiness[]; alerts: OperationalAlert[] } {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const analyzerById = new Map(analyzers.map(item => [Number(item.id), item]));
  const vehicleById = new Map(vehicles.map(item => [Number(item.id), item]));
  const usageByVehicle = new Map(activeUsages.map(item => [Number(item.vehicle_id), item]));
  const reservationsByAppointment = new Map<number, any[]>();
  for (const reservation of reservations) {
    const id = Number(reservation.appointment_id);
    if (!id || !activeReservation(String(reservation.status))) continue;
    const list = reservationsByAppointment.get(id) || [];
    list.push(reservation);
    reservationsByAppointment.set(id, list);
  }

  const readiness: AppointmentReadiness[] = [];
  const alerts: OperationalAlert[] = [];
  for (const appointment of appointments) {
    if (!appointment.appointment_date || /cancelad/i.test(String(appointment.status || ''))
      || appointment.workflow_status === 'Concluído' || isNonTechnicalAppointment(appointment)) continue;
    const id = Number(appointment.id);
    const stage = String(appointment.workflow_status || 'Data provisória');
    const confirmed = confirmedStages.has(stage) || Boolean(appointment.commercial_confirmed_at);
    const linkedReservations = reservationsByAppointment.get(id) || [];
    const approvedReservations = linkedReservations.filter(reservation => ['Reservado', 'Em Uso'].includes(reservation.status));
    const vehicle = vehicleById.get(Number(appointment.vehicle_id));
    const usage = usageByVehicle.get(Number(appointment.vehicle_id));
    const teamReady = Boolean(appointment.technician_id)
      || Boolean(String(appointment.technician_names || '').trim()
        && appointment.technician_names !== 'Equipe de Campo');
    const calibrationExpired = linkedReservations.some(reservation => {
      const expiry = analyzerById.get(Number(reservation.analyzer_id))?.calibration_expiry;
      return expiry && String(expiry).slice(0, 10) < String(appointment.appointment_date);
    });
    const calibrationUnknown = linkedReservations.some(reservation =>
      !analyzerById.get(Number(reservation.analyzer_id))?.calibration_expiry);
    const patternInOtherUse = linkedReservations.some(reservation =>
      reservation.status === 'Reservado'
      && analyzerById.get(Number(reservation.analyzer_id))?.status === 'Em Uso');
    const vehicleConflict = Boolean(usage && Number(usage.appointment_id) !== id);
    const vehicleUnavailable = Boolean(vehicle && /baixado|manuten|indispon|revis/i.test(String(vehicle.status || '')));
    const checks = [
      { key: 'client', label: 'Cliente confirmou', ok: confirmed, detail: confirmed ? 'Confirmado' : 'Confirmação pendente' },
      { key: 'team', label: 'Equipe definida', ok: teamReady, detail: teamReady ? String(appointment.technician_names || 'Equipe atribuída') : 'Sem técnico escalado' },
      { key: 'vehicle', label: 'Carro disponível', ok: Boolean(vehicle) && !vehicleConflict && !vehicleUnavailable,
        detail: !vehicle ? 'Sem carro reservado' : vehicleConflict ? 'Carro em uso em outra atividade' : vehicleUnavailable ? 'Carro indisponível' : String(vehicle.plate || vehicle.name || 'Reservado') },
      { key: 'pattern', label: 'Padrões reservados', ok: approvedReservations.length > 0,
        detail: approvedReservations.length ? `${approvedReservations.length} liberado(s)`
          : linkedReservations.length ? 'Reserva aguardando aprovação' : 'Nenhum padrão reservado' },
      { key: 'pattern_usage', label: 'Padrões disponíveis para retirada', ok: !patternInOtherUse,
        detail: patternInOtherUse ? 'Padrão reservado ainda consta em uso' : 'Sem conflito de uso identificado' },
      { key: 'calibration', label: 'Calibração válida', ok: !calibrationExpired && !calibrationUnknown,
        detail: calibrationExpired ? 'Há padrão com calibração vencida na data'
          : calibrationUnknown ? 'Validade da calibração não cadastrada'
            : linkedReservations.length ? 'Válida na data do atendimento' : 'Verificação após a reserva' }
    ];
    const missing = checks.filter(check => !check.ok).map(check => check.label);
    readiness.push({ appointment_id: id, state: confirmed ? missing.length ? 'attention' : 'ready' : 'planning', checks, missing });

    const dueAt = new Date(`${appointment.appointment_date}T${String(appointment.appointment_time || '08:00').slice(0, 5)}:00-03:00`);
    const hoursToStart = (dueAt.getTime() - now.getTime()) / 3_600_000;
    const upcoming = hoursToStart >= -24 && hoursToStart <= 48;
    if (confirmed && upcoming) {
      for (const check of checks.filter(item => !item.ok)) {
        alerts.push({ id: `${id}:${check.key}`, appointment_id: id,
          severity: hoursToStart <= 24 ? 'critical' : 'warning', kind: check.key,
          message: check.detail });
      }
    }
    const lastActivity = new Date(appointment.last_activity_at || appointment.created_at || now).getTime();
    if (!confirmed && appointment.appointment_date >= today && now.getTime() - lastActivity >= 48 * 3_600_000) {
      alerts.push({ id: `${id}:stale`, appointment_id: id, severity: 'warning',
        kind: 'stale', message: 'Fluxo sem atualização há mais de 2 dias' });
    }
  }
  alerts.sort((left, right) => (left.severity === 'critical' ? -1 : 1) - (right.severity === 'critical' ? -1 : 1));
  return { readiness, alerts };
}
