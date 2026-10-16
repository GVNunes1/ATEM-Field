import { publicCalendarAppointment, portalProfile } from '../security/publicData';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { networkInterfaces } from 'os';
import { supabaseAdmin } from './supabase';
import { isNonTechnicalAppointment } from '../utils/appointmentUtils';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const ACTIVE_RESERVATION_STATUSES = ['Reservado', 'Em Uso'];
const reservationLocks = new Set<string>();
const reservationMutationLocks = new Set<number>();

interface TechnicianPortalAccessClaims {
  version: 2 | 3;
  technicianId: number;
  expiresAt: number;
  authVersion?: number;
}

export class TechnicianPortalAuthError extends Error {
  constructor(message: string, public readonly statusCode = 401) {
    super(message);
    this.name = 'TechnicianPortalAuthError';
  }
}

function technicianPortalSecret() {
  const configured = process.env.TECHNICIAN_PORTAL_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!configured) throw new Error('TECHNICIAN_PORTAL_SECRET não configurado.');
  return createHash('sha256').update(`atem-field-technician-portal:${configured}`).digest('hex');
}

function signTechnicianPortalPayload(encodedPayload: string) {
  return createHmac('sha256', technicianPortalSecret()).update(encodedPayload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createTechnicianPortalAccess(technicianId: number, authVersion = 0) {
  if (!Number.isSafeInteger(authVersion) || authVersion < 0) throw new Error('Versão de acesso inválida.');
  const configuredHours = Number(process.env.TECHNICIAN_PORTAL_LINK_TTL_HOURS || 72);
  const ttlHours = Number.isFinite(configuredHours) ? Math.min(Math.max(configuredHours, 1), 168) : 72;
  const claims: TechnicianPortalAccessClaims = {
    version: 3,
    technicianId,
    authVersion,
    expiresAt: Math.floor(Date.now() / 1000) + ttlHours * 60 * 60
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${encodedPayload}.${signTechnicianPortalPayload(encodedPayload)}`;
}

function verifyTechnicianPortalAccess(accessToken: string): TechnicianPortalAccessClaims {
  const [encodedPayload, signature, extra] = accessToken.split('.');
  if (!encodedPayload || !signature || extra || !safeEqual(signature, signTechnicianPortalPayload(encodedPayload))) {
    throw new TechnicianPortalAuthError('Link de acesso inválido. Solicite um novo link ao supervisor.');
  }
  let claims: TechnicianPortalAccessClaims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TechnicianPortalAccessClaims;
  } catch {
    throw new TechnicianPortalAuthError('Link de acesso inválido. Solicite um novo link ao supervisor.');
  }
  if (![2, 3].includes(claims.version) || !Number.isInteger(claims.technicianId) || claims.technicianId <= 0 || !Number.isInteger(claims.expiresAt)
    || (claims.version === 3 && (!Number.isSafeInteger(claims.authVersion) || Number(claims.authVersion) < 0))) {
    throw new TechnicianPortalAuthError('Link de acesso inválido. Solicite um novo link ao supervisor.');
  }
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new TechnicianPortalAuthError('Este link expirou. Solicite um novo link ao supervisor.');
  }
  return claims;
}

export async function resolveTechnicianPortalTechnician(accessToken: string) {
  if (!accessToken) throw new TechnicianPortalAuthError('Acesso ausente. Abra o link individual enviado pelo supervisor.');
  const claims = verifyTechnicianPortalAccess(accessToken);
  const { data: technician, error } = await supabaseAdmin
    .from('technicians')
    .select('id, name, role, status, avatar_url, auth_version')
    .eq('id', claims.technicianId)
    .eq('status', 'Ativo')
    .maybeSingle();
  if (error) throw error;
  if (!technician) throw new TechnicianPortalAuthError('O cadastro deste técnico não está ativo.', 403);
  const tokenVersion = claims.version === 2 ? 0 : claims.authVersion;
  if (tokenVersion !== (technician.auth_version ?? 0)) throw new TechnicianPortalAuthError('Este acesso foi revogado. Solicite um novo link.', 401);
  return technician;
}

export function getTechnicianPortalBaseUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (configured && /^https?:\/\//i.test(configured)) return configured;

  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(address.address)) {
        return `http://${address.address}:${process.env.PORT || 3001}`;
      }
    }
  }
  return `http://127.0.0.1:${process.env.PORT || 3001}`;
}

export function createTechnicianPortalUrl(technicianId: number, authVersion = 0) {
  const accessToken = createTechnicianPortalAccess(technicianId, authVersion);
  return `${getTechnicianPortalBaseUrl()}/portal-tecnico#access=${encodeURIComponent(accessToken)}`;
}

function dateInSaoPaulo(dayOffset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const reference = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + dayOffset, 12));
  return reference.toISOString().slice(0, 10);
}

function analyzerMatchesType(analyzer: any, analyzerType: string) {
  const candidate = `${analyzer.type || ''} ${analyzer.name || ''}`.trim().toLocaleLowerCase('pt-BR');
  const required = analyzerType.toLocaleLowerCase('pt-BR');
  return Boolean(candidate && required && (candidate.includes(required) || required.includes(candidate)));
}

function targetFollowsSource(source: any, target: any) {
  if (!source?.appointment_date || !target?.appointment_date) return false;
  if (target.appointment_date !== source.appointment_date) {
    return target.appointment_date > source.appointment_date;
  }
  if (!source.appointment_time || !target.appointment_time) return true;
  return target.appointment_time >= source.appointment_time;
}

function normalizeRequiredParameters(value: any) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function fetchAppointmentsForTechnician(technicianId: number, fromDate: string, toDate: string) {
  const { data: links, error: linksError } = await supabaseAdmin
    .from('appointment_technicians')
    .select('appointment_id')
    .eq('technician_id', technicianId);
  if (linksError) throw linksError;
  const linkedIds = [...new Set((links || []).map(link => link.appointment_id))];

  const { data: primaryAppointments, error: primaryError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('technician_id', technicianId)
    .gte('appointment_date', fromDate)
    .lte('appointment_date', toDate);
  if (primaryError) throw primaryError;

  const linkedAppointments: any[] = [];
  for (let index = 0; index < linkedIds.length; index += 150) {
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .in('id', linkedIds.slice(index, index + 150))
      .gte('appointment_date', fromDate)
      .lte('appointment_date', toDate);
    if (error) throw error;
    linkedAppointments.push(...(data || []));
  }

  return [...new Map([...primaryAppointments || [], ...linkedAppointments].map(item => [item.id, item])).values()]
    .sort((left, right) => `${left.appointment_date || ''} ${left.appointment_time || ''}`.localeCompare(`${right.appointment_date || ''} ${right.appointment_time || ''}`));
}

export async function getTechnicianPortalData(technician: any, days = 45) {
  const safeDays = Math.min(Math.max(Number(days) || 45, 1), 120);
  const fromDate = dateInSaoPaulo(0);
  const toDate = dateInSaoPaulo(safeDays);
  const appointments = await fetchAppointmentsForTechnician(technician.id, fromDate, toDate);
  if (!appointments.length) {
    return {
      technician: portalProfile(technician),
      fromDate,
      toDate,
      appointments: [],
      summary: { appointments: 0, pendingReservations: 0, completedReservations: 0, activeReservations: 0 }
    };
  }

  const appointmentIds = appointments.map(appointment => appointment.id);
  const appointmentDates = [...new Set(appointments.map(appointment => appointment.appointment_date).filter(Boolean))];
  const [{ data: equipments, error: equipmentsError }, { data: currentReservations, error: reservationsError }] = await Promise.all([
    supabaseAdmin.from('appointment_equipments').select('*').in('appointment_id', appointmentIds),
    supabaseAdmin.from('reservations').select('*').in('appointment_id', appointmentIds).in('status', ACTIVE_RESERVATION_STATUSES)
  ]);
  if (equipmentsError) throw equipmentsError;
  if (reservationsError) throw reservationsError;

  const categoryIds = [...new Set((equipments || []).map(item => item.category_id).filter((id): id is number => id !== null))];
  const [{ data: categories, error: categoryError }, { data: templates, error: templateError }, { data: analyzers, error: analyzerError }, conflictsResult] = await Promise.all([
    categoryIds.length ? supabaseAdmin.from('equipment_categories').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [], error: null }),
    categoryIds.length ? supabaseAdmin.from('test_templates').select('*').in('category_id', categoryIds) : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from('analyzers').select('*').order('asset_tag', { ascending: true }),
    appointmentDates.length
      ? supabaseAdmin.from('reservations').select('id, appointment_id, analyzer_id, reserved_date, status').in('reserved_date', appointmentDates).in('status', ACTIVE_RESERVATION_STATUSES)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (categoryError) throw categoryError;
  if (templateError) throw templateError;
  if (analyzerError) throw analyzerError;
  if (conflictsResult.error) throw conflictsResult.error;

  const categoryById = new Map((categories || []).map(category => [category.id, category.name]));
  const analyzerById = new Map((analyzers || []).map(analyzer => [analyzer.id, analyzer]));
  const conflicts = conflictsResult.data || [];
  let pendingReservations = 0;
  let completedReservations = 0;
  let activeReservations = 0;

  const enrichedAppointments = appointments.map(appointment => {
    const isTechnical = !isNonTechnicalAppointment(appointment);
    const appointmentEquipments = (equipments || [])
      .filter(item => item.appointment_id === appointment.id)
      .map(item => ({ ...item, category_name: item.category_id ? categoryById.get(item.category_id) || 'Outros' : 'Outros' }));

    if (!isTechnical) {
      return {
        ...publicCalendarAppointment(appointment),
        isTechnicalService: false,
        equipments: appointmentEquipments,
        testTemplates: [],
        analyzerRequirements: [],
        reservationProgress: { completed: 0, total: 0 }
      };
    }
    const appointmentCategoryIds = new Set(appointmentEquipments.map(item => item.category_id).filter(Boolean));
    const appointmentTemplates = (templates || [])
      .filter(template => appointmentCategoryIds.has(template.category_id))
      .map(template => ({
        ...template,
        category_name: categoryById.get(template.category_id) || 'Outros',
        required_parameters: normalizeRequiredParameters(template.required_parameters)
      }));
    const reservations = (currentReservations || [])
      .filter(reservation => reservation.appointment_id === appointment.id)
      .map(reservation => ({
        ...reservation,
        analyzer: reservation.analyzer_id ? analyzerById.get(reservation.analyzer_id) || null : null,
        canReturn: true
      }));
    activeReservations += reservations.filter(reservation => reservation.canReturn).length;

    const requirementsByType = new Map<string, { analyzerType: string; isMandatory: boolean }>();
    for (const template of appointmentTemplates) {
      if (!template.analyzer_type) continue;
      const key = template.analyzer_type.toLocaleLowerCase('pt-BR');
      const isMandatory = Number(template.is_mandatory) !== 0;
      const current = requirementsByType.get(key);
      requirementsByType.set(key, {
        analyzerType: current?.analyzerType || template.analyzer_type,
        isMandatory: Boolean(current?.isMandatory || isMandatory)
      });
    }

    if (!requirementsByType.size) {
      requirementsByType.set('padrão / simulador', {
        analyzerType: 'Padrão / Simulador',
        isMandatory: false
      });
    }

    const requirementEntries = [...requirementsByType.values()];
    const analyzerRequirements = requirementEntries.map(({ analyzerType, isMandatory }) => {
      const existingReservations = reservations
        .filter(reservation => {
          if (!reservation.analyzer) return false;
          if (requirementEntries.length === 1) return true;
          return analyzerMatchesType(reservation.analyzer, analyzerType);
        });
      const reservedAnalyzerIds = new Set(reservations.map(reservation => reservation.analyzer_id).filter(Boolean));
      const availableAnalyzers = (analyzers || []).filter(analyzer => {
        if (/manuten|indispon|baixado/i.test(analyzer.status || '')) return false;
        if (reservedAnalyzerIds.has(analyzer.id)) return false;
        return !conflicts.some(conflict =>
          conflict.analyzer_id === analyzer.id &&
          conflict.reserved_date === appointment.appointment_date &&
          conflict.appointment_id !== appointment.id
        );
      });
      if (isMandatory) {
        if (existingReservations.length) completedReservations += 1;
        else pendingReservations += 1;
      }
      return {
        analyzerType,
        isMandatory,
        existingReservations,
        // Temporary compatibility for portal clients that still expect one item.
        existingReservation: existingReservations[0] || null,
        availableAnalyzers
      };
    });

    const mandatoryRequirements = analyzerRequirements.filter(item => item.isMandatory);

    return {
      ...publicCalendarAppointment(appointment),
      equipments: appointmentEquipments,
      testTemplates: appointmentTemplates,
      analyzerRequirements,
      reservationProgress: {
        completed: mandatoryRequirements.filter(item => item.existingReservations.length > 0).length,
        total: mandatoryRequirements.length
      }
    };
  });

  const appointmentsWithReschedule = enrichedAppointments.map(sourceAppointment => ({
    ...sourceAppointment,
    analyzerRequirements: sourceAppointment.analyzerRequirements.map((requirement: any) => {
      const existingReservations = requirement.existingReservations.map((reservation: any) => {
        const rescheduleOptions = reservation.canReturn && reservation.analyzer
          ? enrichedAppointments
            .filter(targetAppointment => targetAppointment.id !== sourceAppointment.id)
            .filter(targetAppointment => targetAppointment.isTechnicalService !== false)
            .filter(targetAppointment => targetFollowsSource(sourceAppointment, targetAppointment))
            .filter(targetAppointment => !conflicts.some(conflict =>
              conflict.id !== reservation.id &&
              conflict.analyzer_id === reservation.analyzer_id &&
              conflict.reserved_date === targetAppointment.appointment_date
            ))
            .map(targetAppointment => ({
              id: targetAppointment.id,
              appointment_date: targetAppointment.appointment_date,
              appointment_time: targetAppointment.appointment_time,
              client_name: targetAppointment.client_name,
              title: targetAppointment.title
            }))
          : [];
        return {
          ...reservation,
          canReschedule: reservation.canReturn,
          rescheduleOptions
        };
      });
      return {
        ...requirement,
        existingReservations,
        existingReservation: existingReservations[0] || null
      };
    })
  }));

  return {
    technician: portalProfile(technician),
    fromDate,
    toDate,
    appointments: appointmentsWithReschedule,
    summary: { appointments: appointmentsWithReschedule.length, pendingReservations, completedReservations, activeReservations }
  };
}

async function technicianCanAccessAppointment(technicianId: number, appointmentId: number, primaryTechnicianId: number | null) {
  if (primaryTechnicianId === technicianId) return true;
  const { data, error } = await supabaseAdmin
    .from('appointment_technicians')
    .select('appointment_id')
    .eq('appointment_id', appointmentId)
    .eq('technician_id', technicianId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function matchingRequirementForAppointment(appointmentId: number, analyzer: any) {
  const { data: appointmentEquipments, error: equipmentError } = await supabaseAdmin
    .from('appointment_equipments')
    .select('category_id')
    .eq('appointment_id', appointmentId);
  if (equipmentError) throw equipmentError;
  const categoryIds = [...new Set((appointmentEquipments || [])
    .map(item => item.category_id)
    .filter((id): id is number => id !== null))];
  const { data: templates, error: templateError } = categoryIds.length
    ? await supabaseAdmin.from('test_templates').select('analyzer_type').in('category_id', categoryIds)
    : { data: [], error: null };
  if (templateError) throw templateError;
  return [...new Set((templates || []).map(template => template.analyzer_type).filter(Boolean))]
    .find(analyzerType => analyzerMatchesType(analyzer, analyzerType)) || null;
}

export async function reserveAnalyzerFromTechnicianPortal(technician: any, appointmentId: number, analyzerId: number) {
  if (!Number.isInteger(appointmentId) || appointmentId <= 0 || !Number.isInteger(analyzerId) || analyzerId <= 0) {
    throw new TechnicianPortalAuthError('Atendimento ou patrimônio inválido.', 400);
  }

  const lockKey = `${appointmentId}:${analyzerId}`;
  if (reservationLocks.has(lockKey)) throw new TechnicianPortalAuthError('Esta reserva já está sendo processada.', 409);
  reservationLocks.add(lockKey);

  try {
    const [{ data: appointment, error: appointmentError }, { data: analyzer, error: analyzerError }] = await Promise.all([
      supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle(),
      supabaseAdmin.from('analyzers').select('*').eq('id', analyzerId).maybeSingle()
    ]);
    if (appointmentError) throw appointmentError;
    if (analyzerError) throw analyzerError;
    if (!appointment) throw new TechnicianPortalAuthError('Atendimento não encontrado.', 404);
    if (isNonTechnicalAppointment(appointment)) {
      throw new TechnicianPortalAuthError('Agendamentos não técnicos (Sobreaviso, Exame, Aniversário, Revisão, Treinamento, etc.) não permitem reserva de padrões.', 400);
    }
    if (!analyzer) throw new TechnicianPortalAuthError('Patrimônio não encontrado.', 404);
    if (!await technicianCanAccessAppointment(technician.id, appointment.id, appointment.technician_id)) {
      throw new TechnicianPortalAuthError('Este atendimento não pertence ao seu cadastro.', 403);
    }
    if (!appointment.appointment_date || appointment.appointment_date < dateInSaoPaulo(0)) {
      throw new TechnicianPortalAuthError('Não é possível reservar patrimônio para um atendimento encerrado.', 409);
    }
    if (/manuten|indispon|baixado/i.test(analyzer.status || '')) {
      throw new TechnicianPortalAuthError('Este patrimônio está indisponível.', 409);
    }

    const [{ data: conflict, error: conflictError }, { data: currentReservations, error: currentError }] = await Promise.all([
      supabaseAdmin
        .from('reservations')
        .select('id')
        .eq('analyzer_id', analyzer.id)
        .eq('reserved_date', appointment.appointment_date)
        .in('status', ACTIVE_RESERVATION_STATUSES)
        .neq('appointment_id', appointment.id)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('reservations')
        .select('id, analyzer_id, status')
        .eq('appointment_id', appointment.id)
        .in('status', ACTIVE_RESERVATION_STATUSES)
    ]);
    if (conflictError) throw conflictError;
    if (currentError) throw currentError;
    if (conflict) throw new TechnicianPortalAuthError('Este patrimônio acabou de ser reservado para outro atendimento nesta data.', 409);

    const sameAnalyzerReservation = (currentReservations || []).find(reservation => reservation.analyzer_id === analyzer.id);
    if (sameAnalyzerReservation) {
      return { reservationId: sameAnalyzerReservation.id, assetTag: analyzer.asset_tag, alreadyReserved: true };
    }

    const { data: reservation, error: insertError } = await supabaseAdmin
      .from('reservations')
      .insert({
        appointment_id: appointment.id,
        analyzer_id: analyzer.id,
        technician_id: technician.id,
        reserved_date: appointment.appointment_date,
        status: 'Reservado',
        checkout_at: new Date().toISOString(),
        checkin_at: null,
        notes: 'Reserva autenticada pelo Portal do Técnico'
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    const { error: analyzerUpdateError } = await supabaseAdmin.from('analyzers').update({ status: 'Reservado' }).eq('id', analyzer.id);
    if (analyzerUpdateError) console.error('Reserva criada, mas o status do analisador não foi atualizado:', analyzerUpdateError.message);

    return { reservationId: reservation.id, assetTag: analyzer.asset_tag, alreadyReserved: false };
  } finally {
    reservationLocks.delete(lockKey);
  }
}

export async function rescheduleAnalyzerFromTechnicianPortal(technician: any, reservationId: number, targetAppointmentId: number) {
  if (!Number.isInteger(reservationId) || reservationId <= 0 || !Number.isInteger(targetAppointmentId) || targetAppointmentId <= 0) {
    throw new TechnicianPortalAuthError('Reserva ou atendimento de destino inválido.', 400);
  }
  if (reservationMutationLocks.has(reservationId)) {
    throw new TechnicianPortalAuthError('Esta reserva já está sendo atualizada.', 409);
  }
  reservationMutationLocks.add(reservationId);

  try {
    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from('reservations')
      .select('id, analyzer_id, appointment_id, technician_id, reserved_date, checkout_at, status, notes')
      .eq('id', reservationId)
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation) throw new TechnicianPortalAuthError('Reserva não encontrada.', 404);
    if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.status)) {
      throw new TechnicianPortalAuthError('Esta reserva não está ativa para reagendamento.', 409);
    }
    if (!reservation.analyzer_id || !reservation.appointment_id) {
      throw new TechnicianPortalAuthError('A reserva não possui patrimônio ou atendimento vinculado.', 409);
    }

    const [{ data: analyzer, error: analyzerError }, { data: sourceAppointment, error: sourceError }, { data: targetAppointment, error: targetError }] = await Promise.all([
      supabaseAdmin.from('analyzers').select('*').eq('id', reservation.analyzer_id).maybeSingle(),
      supabaseAdmin.from('appointments').select('*').eq('id', reservation.appointment_id).maybeSingle(),
      supabaseAdmin.from('appointments').select('*').eq('id', targetAppointmentId).maybeSingle()
    ]);
    if (analyzerError) throw analyzerError;
    if (sourceError) throw sourceError;
    if (targetError) throw targetError;
    if (!analyzer) throw new TechnicianPortalAuthError('Patrimônio não encontrado.', 404);
    if (!sourceAppointment) throw new TechnicianPortalAuthError('Atendimento atual não encontrado.', 404);
    if (!targetAppointment) throw new TechnicianPortalAuthError('Atendimento de destino não encontrado.', 404);
    if (!await technicianCanAccessAppointment(technician.id, sourceAppointment.id, sourceAppointment.technician_id)) {
      throw new TechnicianPortalAuthError('O atendimento atual não pertence à sua equipe.', 403);
    }

    if (reservation.appointment_id === targetAppointment.id) {
      return {
        reservationId,
        assetTag: analyzer.asset_tag,
        alreadyScheduled: true,
        appointmentId: targetAppointment.id,
        reservedDate: targetAppointment.appointment_date,
        status: reservation.status
      };
    }
    if (!await technicianCanAccessAppointment(technician.id, targetAppointment.id, targetAppointment.technician_id)) {
      throw new TechnicianPortalAuthError('O atendimento de destino não pertence ao seu cadastro.', 403);
    }
    if (!targetAppointment.appointment_date || targetAppointment.appointment_date < dateInSaoPaulo(0)) {
      throw new TechnicianPortalAuthError('Escolha um atendimento de hoje ou de uma data futura.', 409);
    }
    if (!targetFollowsSource(sourceAppointment, targetAppointment)) {
      throw new TechnicianPortalAuthError('O novo atendimento deve ocorrer no mesmo horário ou depois do atendimento atual.', 409);
    }

    const { data: conflict, error: conflictError } = await supabaseAdmin
      .from('reservations')
      .select('id')
      .eq('analyzer_id', analyzer.id)
      .eq('reserved_date', targetAppointment.appointment_date)
      .in('status', ACTIVE_RESERVATION_STATUSES)
      .neq('id', reservation.id)
      .limit(1)
      .maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) {
      throw new TechnicianPortalAuthError('Este patrimônio já está vinculado a outro atendimento na data escolhida.', 409);
    }

    const changedAt = new Date().toISOString();
    const auditNote = `Reagendado em ${changedAt}: atendimento #${sourceAppointment.id} (${sourceAppointment.appointment_date}) → #${targetAppointment.id} (${targetAppointment.appointment_date}).`;
    const notes = reservation.notes?.trim() ? `${reservation.notes.trim()}\n${auditNote}` : auditNote;
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({
        appointment_id: targetAppointment.id,
        reserved_date: targetAppointment.appointment_date,
        checkin_at: null,
        checkin_date: null,
        notes
      })
      .eq('id', reservation.id)
      .eq('technician_id', reservation.technician_id)
      .eq('appointment_id', sourceAppointment.id)
      .in('status', ACTIVE_RESERVATION_STATUSES)
      .select('id, appointment_id, reserved_date, status')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      throw new TechnicianPortalAuthError('A reserva foi alterada em outro dispositivo. Atualize o painel.', 409);
    }

    return {
      reservationId,
      assetTag: analyzer.asset_tag,
      analyzerType: analyzer.type,
      alreadyScheduled: false,
      fromAppointmentId: sourceAppointment.id,
      appointmentId: updated.appointment_id,
      reservedDate: updated.reserved_date,
      status: updated.status
    };
  } finally {
    reservationMutationLocks.delete(reservationId);
  }
}

async function reconcileAnalyzerReservationStatus(analyzerId: number) {
  const [{ data: analyzer, error: analyzerError }, { data: active, error: activeError }] = await Promise.all([
    supabaseAdmin.from('analyzers').select('id, status').eq('id', analyzerId).maybeSingle(),
    supabaseAdmin.from('reservations').select('status').eq('analyzer_id', analyzerId).in('status', ACTIVE_RESERVATION_STATUSES)
  ]);
  if (analyzerError) throw analyzerError;
  if (activeError) throw activeError;
  if (!analyzer) return null;

  // A warehouse block such as maintenance must not be cleared by a return.
  if (!['Disponível', 'Reservado', 'Em Uso'].includes(analyzer.status || '')) return analyzer.status;

  const nextStatus = (active || []).some(item => item.status === 'Em Uso')
    ? 'Em Uso'
    : (active || []).length > 0
      ? 'Reservado'
      : 'Disponível';

  if (nextStatus !== analyzer.status) {
    const { error } = await supabaseAdmin.from('analyzers').update({ status: nextStatus }).eq('id', analyzerId);
    if (error) throw error;
  }
  return nextStatus;
}

export async function returnAnalyzerFromTechnicianPortal(technician: any, reservationId: number) {
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw new TechnicianPortalAuthError('Reserva inválida.', 400);
  }
  if (reservationMutationLocks.has(reservationId)) {
    throw new TechnicianPortalAuthError('Esta reserva já está sendo atualizada.', 409);
  }
  reservationMutationLocks.add(reservationId);

  try {
    const { data: reservation, error } = await supabaseAdmin
      .from('reservations')
      .select('id, analyzer_id, appointment_id, technician_id, status')
      .eq('id', reservationId)
      .maybeSingle();
    if (error) throw error;
    if (!reservation) throw new TechnicianPortalAuthError('Reserva não encontrada.', 404);
    const { data: appointment, error: appointmentError } = reservation.appointment_id
      ? await supabaseAdmin.from('appointments').select('id, technician_id').eq('id', reservation.appointment_id).maybeSingle()
      : { data: null, error: null };
    if (appointmentError) throw appointmentError;
    if (!appointment || !await technicianCanAccessAppointment(technician.id, appointment.id, appointment.technician_id)) {
      throw new TechnicianPortalAuthError('Somente técnicos escalados podem devolver padrões deste atendimento.', 403);
    }
    if (reservation.status === 'Devolvido') {
      return {
        reservationId,
        alreadyReturned: true,
        analyzerStatus: reservation.analyzer_id ? await reconcileAnalyzerReservationStatus(reservation.analyzer_id) : null
      };
    }
    if (!ACTIVE_RESERVATION_STATUSES.includes(reservation.status)) {
      throw new TechnicianPortalAuthError('Esta reserva não está ativa para devolução.', 409);
    }
    if (!reservation.appointment_id) {
      throw new TechnicianPortalAuthError('A reserva não possui atendimento vinculado.', 409);
    }

    const returnedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'Devolvido', checkin_at: returnedAt, checkin_date: returnedAt, audit_actor_id: String(technician.id) })
      .eq('id', reservation.id)
      .eq('technician_id', reservation.technician_id)
      .eq('appointment_id', reservation.appointment_id)
      .in('status', ACTIVE_RESERVATION_STATUSES)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      throw new TechnicianPortalAuthError('A reserva foi atualizada em outro dispositivo. Atualize o painel.', 409);
    }

    const analyzerStatus = reservation.analyzer_id
      ? await reconcileAnalyzerReservationStatus(reservation.analyzer_id)
      : null;
    return { reservationId, alreadyReturned: false, analyzerStatus };
  } finally {
    reservationMutationLocks.delete(reservationId);
  }
}
