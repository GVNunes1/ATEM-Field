import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import { supabaseAdmin } from '../services/supabase';
import { isNonTechnicalAppointment } from '../utils/appointmentUtils';
import {
  parseAnalyzersExcelBuffer,
  generateAnalyzersExcelTemplate,
  mapRowToAnalyzer,
  AnalyzerExcelRow,
  MAX_EXCEL_BASE64_LENGTH,
  MAX_EXCEL_ROWS
} from '../utils/excelUtils';
import {
  getGoogleCalendarSyncStatus,
  runGoogleCalendarSync,
  startGoogleCalendarAuthorization
} from '../services/googleCalendarSync';
import {
  createTechnicianPortalUrl,
  getTechnicianPortalData,
  rescheduleAnalyzerFromTechnicianPortal,
  returnAnalyzerFromTechnicianPortal,
  reserveAnalyzerFromTechnicianPortal,
  resolveTechnicianPortalTechnician,
  TechnicianPortalAuthError
} from '../services/telegramDashboard';
import { syncOfficialTechniciansDatabase } from '../scripts/syncOfficialTechnicians';
import { AuthService, CryptoService, requireAuthentication, requireRole, isManagementRole, requireManagement } from '../security/authService';
import { calendarRouter, publicCalendarAppointment } from './calendar';
import { canReceiveWorkflowStage, canTransitionWorkflow, missingWorkflowFields, roleFromSpecialty, schedulingRoles } from '../security/roles';

const router = Router();
router.use(calendarRouter);
const technicianMergeLocks = new Set<number>();

const defaultTechnicianAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=250&q=80';

function normalizeNameKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');
}

function stripCalendarInviteNoise(value: string) {
  const markers = [
    /_{10,}\s*Microsoft Teams/i,
    /Microsoft Teams Need help/i,
    /Join the meeting now/i,
    /meetup-join/i,
    /The information contained in this message/i
  ];
  const indexes = markers.map(marker => value.search(marker)).filter(index => index >= 0);
  return indexes.length ? value.slice(0, Math.min(...indexes)) : value;
}

function sanitizeTechnicianName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!/^[\p{L}][\p{L}\p{M}\p{N}\s.'’\-]*$/u.test(name)) return null;
  if ((name.match(/\p{N}/gu) || []).length > 3) return null;
  if (/\b(teams|meeting|meetup|passcode|dial|conference|recipient|forwarding|dissemination|reproduction)\b/i.test(name)) return null;
  return name;
}

function normalizedOptionalValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function hasMeaningfulValue(value: unknown) {
  const normalized = normalizedOptionalValue(value)?.toLocaleLowerCase('pt-BR');
  return Boolean(normalized && normalized !== 'pendente' && !normalized.startsWith('pendente ('));
}

function parsePositiveId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseNonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parsePhotoData(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
    throw new Error(`${fieldName} deve ser uma imagem JPEG, PNG ou WebP em formato válido.`);
  }
  if (value.length > 2_800_000) {
    throw new Error(`${fieldName} excede o limite de 2 MB.`);
  }
  return value;
}

function appointmentTimeMinutes(value: unknown) {
  const match = String(value || '').match(/^(\d{1,2}):([0-5]\d)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

async function getAppointmentTeamIds(appointmentId: number) {
  const [{ data: appointment }, { data: links }] = await Promise.all([
    supabaseAdmin.from('appointments').select('technician_id').eq('id', appointmentId).maybeSingle(),
    supabaseAdmin.from('appointment_technicians').select('technician_id').eq('appointment_id', appointmentId)
  ]);
  return [...new Set([
    ...(appointment?.technician_id ? [Number(appointment.technician_id)] : []),
    ...((links || []).map((link: any) => Number(link.technician_id)).filter(Boolean))
  ])];
}

async function refreshAppointmentTechnicianSummary(appointmentIds: number[]) {
  if (!appointmentIds.length) return;

  const [{ data: links, error: linksError }, { data: appointments, error: appointmentsError }] = await Promise.all([
    supabaseAdmin
      .from('appointment_technicians')
      .select('appointment_id, technician_id')
      .in('appointment_id', appointmentIds),
    supabaseAdmin
      .from('appointments')
      .select('id, technician_id')
      .in('id', appointmentIds)
  ]);
  if (linksError) throw linksError;
  if (appointmentsError) throw appointmentsError;

  const technicianIds = [...new Set((links || []).map(link => link.technician_id))];
  const { data: technicians, error: technicianError } = technicianIds.length
    ? await supabaseAdmin.from('technicians').select('id, name').in('id', technicianIds)
    : { data: [], error: null };
  if (technicianError) throw technicianError;

  const nameById = new Map((technicians || []).map(technician => [technician.id, technician.name]));
  const primaryByAppointment = new Map((appointments || []).map(appointment => [appointment.id, appointment.technician_id]));
  for (let index = 0; index < appointmentIds.length; index += 10) {
    const batch = appointmentIds.slice(index, index + 10);
    const results = await Promise.all(batch.map(appointmentId => {
      const ids = (links || [])
        .filter(link => link.appointment_id === appointmentId)
        .map(link => link.technician_id);
      const names = ids.map(id => nameById.get(id)).filter((name): name is string => Boolean(name));
      const currentPrimary = primaryByAppointment.get(appointmentId);
      const primaryId = currentPrimary && ids.includes(currentPrimary) ? currentPrimary : (ids[0] || null);
      return supabaseAdmin
        .from('appointments')
        .update({
          technician_id: primaryId,
          technician_names: names.length ? names.join(', ') : 'Equipe de Campo'
        })
        .eq('id', appointmentId);
    }));
    const failedResult = results.find(result => result.error);
    if (failedResult?.error) throw failedResult.error;
  }
}

// Helper to fetch all rows across PostgREST pagination limits (1000 per page)
async function fetchAllFromTable<T = any>(table: string, orderBy = 'id', filterFn?: (q: any) => any): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q = (supabaseAdmin.from(table as any) as any).select('*');
    if (filterFn) {
      q = filterFn(q);
    }
    if (orderBy) {
      q = q.order(orderBy, { ascending: true });
    }
    const { data, error } = await q.range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data as any);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

// ==========================================
// 1. DASHBOARD & STATS
// ==========================================
router.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: analyzers, error: anErr } = await supabaseAdmin.from('analyzers').select('id, status');
    if (anErr) throw anErr;

    const totalAnalyzers = (analyzers || []).length;
    const availableAnalyzers = (analyzers || []).filter(a => a.status === 'Disponível').length;
    const reservedAnalyzers = (analyzers || []).filter(a => a.status === 'Reservado').length;
    const inUseAnalyzers = (analyzers || []).filter(a => a.status === 'Em Uso').length;

    const { count: todayAppointments, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('appointment_date', todayStr);
    if (apptErr) throw apptErr;

    const { count: activeTechnicians, error: techErr } = await supabaseAdmin
      .from('technicians')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Ativo');
    if (techErr) throw techErr;

    const { count: pendingReservations, error: resCountErr } = await supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Reservado');
    if (resCountErr) throw resCountErr;

    const { data: recentRes, error: recentErr } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .order('id', { ascending: false })
      .limit(5);
    if (recentErr) throw recentErr;

    const recentReservations: any[] = [];
    if (recentRes && recentRes.length > 0) {
      const anIds = Array.from(new Set(recentRes.map(r => r.analyzer_id).filter((id): id is number => id !== null)));
      const techIds = Array.from(new Set(recentRes.map(r => r.technician_id).filter((id): id is number => id !== null)));
      const apptIds = Array.from(new Set(recentRes.map(r => r.appointment_id).filter((id): id is number => id !== null)));

      const [{ data: anList }, { data: techList }, { data: apptList }] = await Promise.all([
        anIds.length > 0 ? supabaseAdmin.from('analyzers').select('id, asset_tag, name').in('id', anIds) : Promise.resolve({ data: [] }),
        techIds.length > 0 ? supabaseAdmin.from('technicians').select('id, name').in('id', techIds) : Promise.resolve({ data: [] }),
        apptIds.length > 0 ? supabaseAdmin.from('appointments').select('id, client_name, technician_names').in('id', apptIds) : Promise.resolve({ data: [] })
      ]);

      const anMap = new Map((anList || []).map(a => [a.id, a]));
      const techMap = new Map((techList || []).map(t => [t.id, t]));
      const apptMap = new Map((apptList || []).map(ap => [ap.id, ap]));

      for (const r of recentRes) {
        const analyzer = r.analyzer_id ? anMap.get(r.analyzer_id) : null;
        const tech = r.technician_id ? techMap.get(r.technician_id) : null;
        const appt = r.appointment_id ? apptMap.get(r.appointment_id) : null;

        recentReservations.push({
          ...r,
          asset_tag: analyzer ? analyzer.asset_tag : 'N/A',
          analyzer_name: analyzer ? analyzer.name : 'N/A',
          technician_name: tech ? tech.name : 'N/A',
          client_name: appt ? appt.client_name : 'N/A'
        });
      }
    }

    res.json({
      success: true,
      stats: {
        totalAnalyzers,
        availableAnalyzers,
        reservedAnalyzers,
        inUseAnalyzers,
        todayAppointments: todayAppointments || 0,
        activeTechnicians: activeTechnicians || 0,
        pendingReservations: pendingReservations || 0
      },
      recentReservations
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. AGENDA ONLINE LIVE SYNCHRONIZATION
// ==========================================
router.post('/sync/agenda-online', requireAuthentication, requireRole(['admin']), async (_req: Request, res: Response) => {
  try {
    const result = await runGoogleCalendarSync('manual');
    res.json({
      success: true,
      ...result,
      importedCount: result.created,
      newTechsCount: result.newTechnicians,
      message: `${result.created} novo(s), ${result.updated} atualizado(s) e ${result.cancelled} cancelado(s).`
    });
  } catch (error: any) {
    res.status(error?.authRequired ? 401 : 500).json({
      success: false,
      auth_required: Boolean(error?.authRequired),
      error: error?.message || 'Falha na sincronização com o Google Agenda.'
    });
  }
});

router.get('/sync/google/status', requireAuthentication, requireRole(schedulingRoles), async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await getGoogleCalendarSyncStatus()) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Status do Google Agenda indisponível.' });
  }
});

router.post('/sync/get-google-auth-url', requireAuthentication, requireRole(['admin']), async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await startGoogleCalendarAuthorization()) });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Não foi possível iniciar a autorização Google.' });
  }
});

router.post('/sync/agenda-online-legacy-disabled', (req: Request, res: Response) => {
  return res.status(410).json({ success: false, error: 'Conector legado desativado.' });
  let scriptPath = path.resolve(__dirname, '../services/import_agenda.py');
  if (!require('fs').existsSync(scriptPath)) {
    scriptPath = path.resolve(__dirname, '../../src/services/import_agenda.py');
  }

  exec(`python "${scriptPath}"`, { encoding: 'utf-8' }, async (error, stdout, stderr) => {
    if (error) {
      console.error('Erro ao executar import_agenda.py:', error, stderr);
      return res.status(500).json({ success: false, error: error.message || stderr });
    }

    try {
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        return res.status(500).json({ success: false, error: 'Resposta inválida do script de sincronização.' });
      }

      const rawJson = stdout.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(rawJson);

      if (!parsed.success) {
        return res.status(500).json({ success: false, error: parsed.error });
      }

      let importedCount = 0;
      let newTechsCount = 0;

      const existingTechs = await fetchAllFromTable('technicians');
      const techMapByName = new Map(existingTechs.map((t: any) => [normalizeNameKey(t.name), t]));

      for (const item of parsed.data) {
        const rawTechs = stripCalendarInviteNoise(item.technicians_raw || '')
          .replace(/Técnico:/gi, '')
          .replace(/Técnicos:/gi, '')
          .replace(/\([^)]*\)/g, '')
          .trim();

        let assignedTechIds: number[] = [];
        let assignedTechNames: string[] = [];

        if (rawTechs && !rawTechs.includes('Equipe de Campo') && rawTechs !== '(?)') {
          const names = rawTechs
            .split(/[,;]|\s+e\s+/i)
            .map((name: string) => sanitizeTechnicianName(name))
            .filter((name: string | null): name is string => Boolean(name));

          for (const name of names) {
            let matchedTech = techMapByName.get(normalizeNameKey(name));

            if (!matchedTech) {
              const { data: newTech, error: insertTechErr } = await supabaseAdmin
                .from('technicians')
                .insert({
                  name,
                  phone: 'Pendente (Cadastrar celular)',
                  telegram_id: null,
                  email: 'Pendente',
                  role: 'Técnico de Campo',
                  avatar_url: defaultTechnicianAvatar,
                  status: 'Ativo'
                })
                .select('*')
                .single();

              if (!insertTechErr && newTech) {
                matchedTech = newTech;
                techMapByName.set(normalizeNameKey(name), newTech);
                newTechsCount++;
              }
            }

            if (matchedTech && !assignedTechIds.includes(matchedTech.id)) {
              assignedTechIds.push(matchedTech.id);
              assignedTechNames.push(matchedTech.name);
            }
          }
        }

        const { data: newAppt, error: apptInsertErr } = await supabaseAdmin
          .from('appointments')
          .insert({
            external_id: item.external_id,
            title: item.title,
            client_name: item.client_name,
            client_address: item.client_address,
            client_contact: 'Sincronizado da Agenda Online',
            technician_id: assignedTechIds[0] || null,
            technician_names: assignedTechNames.length > 0 ? assignedTechNames.join(', ') : 'Equipe de Campo',
            appointment_date: item.appointment_date,
            appointment_time: item.appointment_time,
            status: 'Agendado'
          })
          .select('id')
          .single();

        if (apptInsertErr || !newAppt) continue;

        const apptId = newAppt.id;

        if (assignedTechIds.length > 0) {
          const junctionRows = assignedTechIds.map(tId => ({
            appointment_id: apptId,
            technician_id: tId
          }));
          await supabaseAdmin.from('appointment_technicians').insert(junctionRows);
        }

        const lowerTitle = (item.title + ' ' + item.client_name).toLowerCase();
        let categoryId = 1;
        if (lowerTitle.includes('monitor') || lowerTitle.includes('mp') || lowerTitle.includes('sinais')) categoryId = 2;
        else if (lowerTitle.includes('ventila') || lowerTitle.includes('cpap') || lowerTitle.includes('tecme')) categoryId = 3;
        else if (lowerTitle.includes('bomba') || lowerTitle.includes('infus')) categoryId = 4;
        else if (lowerTitle.includes('ultrassom') || lowerTitle.includes('eco')) categoryId = 5;
        else if (lowerTitle.includes('autoclave') || lowerTitle.includes('cisa') || lowerTitle.includes('esteriliza')) categoryId = 6;
        else if (lowerTitle.includes('bisturi') || lowerTitle.includes('eletrocirurgico')) categoryId = 7;

        await supabaseAdmin.from('appointment_equipments').insert({
          appointment_id: apptId,
          category_id: categoryId,
          model: item.client_name,
          serial_number: `S/N-REG-${item.appointment_date.replace(/-/g, '')}`,
          tag: `PAT-HOSP-${apptId}`,
          sector: 'Assistência Técnica'
        });

        importedCount++;
      }

      const { count: totalAppointmentsInDB } = await supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true });

      res.json({
        success: true,
        importedCount,
        newTechsCount,
        totalAppointmentsInDB: totalAppointmentsInDB || 0,
        message: `Sincronização concluída! ${importedCount} atendimentos e ${newTechsCount} técnicos importados 100% EXCLUSIVAMENTE da sua conta Google Calendar.`
      });

    } catch (err: any) {
      console.error('Erro ao processar JSON do script:', err);
      res.status(500).json({ success: false, error: 'Erro ao processar dados da agenda: ' + err.message });
    }
  });
});

router.post('/sync/get-google-auth-url-legacy-disabled', (req: Request, res: Response) => {
  return res.status(410).json({ success: false, error: 'OAuth legado desativado.' });
  const { spawn } = require('child_process');
  let flowScript = path.resolve(__dirname, '../services/google_auth_flow.py');
  if (!require('fs').existsSync(flowScript)) {
    flowScript = path.resolve(__dirname, '../../src/services/google_auth_flow.py');
  }

  const pyProcess = spawn('python', ['-u', flowScript]);
  let responded = false;

  pyProcess.stdout.on('data', (data: any) => {
    const stdout = data.toString();
    const jsonStart = stdout.indexOf('{');
    const jsonEnd = stdout.lastIndexOf('}');
    if (!responded && jsonStart !== -1 && jsonEnd !== -1) {
      try {
        const parsed = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
        if (parsed.success) {
          responded = true;
          return res.json({ success: true, auth_url: parsed.auth_url });
        }
      } catch (e) {
        // Wait for complete JSON chunk
      }
    }
  });

  pyProcess.stderr.on('data', (data: any) => {
    console.error('Python OAuth stderr:', data.toString());
  });

  setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(500).json({ success: false, error: 'Timeout ao conectar com autenticador Google.' });
    }
  }, 10000);
});

// ==========================================
// 3. TECHNICIANS
// ==========================================
router.get('/technicians', async (req: Request, res: Response) => {
  try {
    const technicians = await fetchAllFromTable('technicians', 'id');
    let isAdmin = false;
    let signedIn = false;
    try {
      const payload = AuthService.verifySessionToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      signedIn = true;
      isAdmin = payload.role === 'admin' && payload.sub === '0';
    } catch { /* The login chooser only needs public directory fields. */ }
    res.json({ success: true, technicians: technicians.map((technician: any) => {
      if (isAdmin) return technician;
      if (!signedIn) return { id: technician.id, name: technician.name, role: technician.role, status: technician.status, avatar_url: technician.avatar_url };
      const { pin, ...profile } = technician;
      return profile;
    }) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/technicians/sync-official', requireAuthentication, requireRole(['admin']), async (_req: Request, res: Response) => {
  try {
    const result = await syncOfficialTechniciansDatabase();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/technicians', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { name, phone, telegram_id, email, role, avatar_url } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Nome e Telefone são obrigatórios.' });
    }

    const { data, error } = await supabaseAdmin
      .from('technicians')
      .insert({
        name,
        phone,
        telegram_id: telegram_id || null,
        email: email || null,
        role: role || 'Técnico de Campo',
        avatar_url: avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=250&q=80',
        status: 'Ativo'
      })
      .select('id')
      .single();

    if (error) throw error;

    res.json({ success: true, id: data.id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/technicians/:id', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  const technicianId = parsePositiveId(req.params.id);
  if (!technicianId) {
    return res.status(400).json({ success: false, error: 'ID do técnico inválido.' });
  }

  try {
    const { data: currentTechnician, error: currentError } = await supabaseAdmin
      .from('technicians')
      .select('*')
      .eq('id', technicianId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!currentTechnician) {
      return res.status(404).json({ success: false, error: 'Técnico não encontrado.' });
    }

    const allowedFields = ['name', 'phone', 'telegram_id', 'email', 'role', 'avatar_url', 'status'] as const;
    const update: {
      name?: string;
      phone?: string | null;
      telegram_id?: string | null;
      email?: string | null;
      role?: string;
      avatar_url?: string | null;
      status?: string;
    } = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;

      if (field === 'name') {
        const name = sanitizeTechnicianName(req.body.name);
        if (!name) {
          return res.status(400).json({ success: false, error: 'Informe um nome válido com até 80 caracteres.' });
        }
        update.name = name;
      } else if (field === 'status') {
        if (!['Ativo', 'Inativo'].includes(req.body.status)) {
          return res.status(400).json({ success: false, error: 'O status deve ser Ativo ou Inativo.' });
        }
        update.status = req.body.status;
      } else {
        if (field === 'phone') update.phone = normalizedOptionalValue(req.body.phone);
        if (field === 'telegram_id') update.telegram_id = normalizedOptionalValue(req.body.telegram_id);
        if (field === 'email') update.email = normalizedOptionalValue(req.body.email);
        if (field === 'role') update.role = normalizedOptionalValue(req.body.role) || currentTechnician.role;
        if (field === 'avatar_url') update.avatar_url = normalizedOptionalValue(req.body.avatar_url);
      }
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, error: 'Nenhum campo válido foi informado.' });
    }

    const { data: technician, error } = await supabaseAdmin
      .from('technicians')
      .update(update)
      .eq('id', technicianId)
      .select('*')
      .single();
    if (error) throw error;

    if (update.name && update.name !== currentTechnician.name) {
      const [{ data: links, error: linksError }, { data: primaryAppointments, error: primaryError }] = await Promise.all([
        supabaseAdmin.from('appointment_technicians').select('appointment_id').eq('technician_id', technicianId),
        supabaseAdmin.from('appointments').select('id').eq('technician_id', technicianId)
      ]);
      if (linksError) throw linksError;
      if (primaryError) throw primaryError;
      const appointmentIds = [...new Set([
        ...(links || []).map(link => link.appointment_id),
        ...(primaryAppointments || []).map(appointment => appointment.id)
      ])];
      await refreshAppointmentTechnicianSummary(appointmentIds);
    }

    res.json({ success: true, technician });
  } catch (err: any) {
    const status = err.code === '23505' ? 409 : 500;
    const error = err.code === '23505'
      ? 'Este ID do Telegram já pertence a outro técnico.'
      : err.message;
    res.status(status).json({ success: false, error });
  }
});

router.delete('/technicians/:id', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  const technicianId = parsePositiveId(req.params.id);
  if (!technicianId) {
    return res.status(400).json({ success: false, error: 'ID do técnico inválido.' });
  }
  if (technicianMergeLocks.has(technicianId)) {
    return res.status(409).json({ success: false, error: 'Este cadastro já está sendo alterado. Tente novamente em instantes.' });
  }

  technicianMergeLocks.add(technicianId);
  try {
    const { data: technician, error: technicianError } = await supabaseAdmin
      .from('technicians')
      .select('id, name')
      .eq('id', technicianId)
      .maybeSingle();
    if (technicianError) throw technicianError;
    if (!technician) {
      return res.status(404).json({ success: false, error: 'Técnico não encontrado.' });
    }

    const [appointments, links, reservations, notifications] = await Promise.all([
      supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('technician_id', technicianId),
      supabaseAdmin.from('appointment_technicians').select('appointment_id', { count: 'exact', head: true }).eq('technician_id', technicianId),
      supabaseAdmin.from('reservations').select('id', { count: 'exact', head: true }).eq('technician_id', technicianId),
      supabaseAdmin.from('notification_logs').select('id', { count: 'exact', head: true }).eq('technician_id', technicianId)
    ]);
    const queryError = appointments.error || links.error || reservations.error || notifications.error;
    if (queryError) throw queryError;

    const dependencies = (appointments.count || 0) + (links.count || 0) + (reservations.count || 0) + (notifications.count || 0);
    if (dependencies > 0) {
      return res.status(409).json({
        success: false,
        error: `${technician.name} possui vínculos com agenda, reservas ou histórico. Mescle o cadastro duplicado com o usuário correto ou marque-o como inativo.`
      });
    }

    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('technicians')
      .delete()
      .eq('id', technicianId)
      .select('id, name')
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) {
      return res.status(409).json({ success: false, error: 'O cadastro mudou durante a exclusão. Atualize a página e tente novamente.' });
    }

    res.json({ success: true, deleted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    technicianMergeLocks.delete(technicianId);
  }
});

router.post('/technicians/:sourceId/merge', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  const sourceId = parsePositiveId(req.params.sourceId);
  const targetId = parsePositiveId(req.body.target_id);
  if (!sourceId || !targetId) {
    return res.status(400).json({ success: false, error: 'Selecione dois cadastros válidos para a mescla.' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ success: false, error: 'O cadastro de origem e o cadastro final devem ser diferentes.' });
  }
  if (technicianMergeLocks.has(sourceId) || technicianMergeLocks.has(targetId)) {
    return res.status(409).json({ success: false, error: 'Um destes técnicos já está sendo mesclado. Tente novamente em instantes.' });
  }

  technicianMergeLocks.add(sourceId);
  technicianMergeLocks.add(targetId);

  try {
    const [{ data: source, error: sourceError }, { data: target, error: targetError }] = await Promise.all([
      supabaseAdmin.from('technicians').select('*').eq('id', sourceId).maybeSingle(),
      supabaseAdmin.from('technicians').select('*').eq('id', targetId).maybeSingle()
    ]);
    if (sourceError) throw sourceError;
    if (targetError) throw targetError;
    if (!source || !target) {
      return res.status(404).json({ success: false, error: 'Um dos cadastros selecionados não existe mais.' });
    }

    const profile = req.body.profile && typeof req.body.profile === 'object' ? req.body.profile : {};
    const requestedName = Object.prototype.hasOwnProperty.call(profile, 'name')
      ? sanitizeTechnicianName(profile.name)
      : null;
    if (Object.prototype.hasOwnProperty.call(profile, 'name') && !requestedName) {
      return res.status(400).json({ success: false, error: 'Informe um nome final válido com até 80 caracteres.' });
    }

    const chooseContact = (field: 'phone' | 'telegram_id' | 'email') => {
      if (hasMeaningfulValue(profile[field])) return normalizedOptionalValue(profile[field]);
      if (hasMeaningfulValue(target[field])) return target[field];
      if (hasMeaningfulValue(source[field])) return source[field];
      return normalizedOptionalValue(profile[field]) ?? target[field] ?? source[field] ?? null;
    };
    const desiredTelegramId = chooseContact('telegram_id');
    const targetProfile = {
      name: requestedName || target.name,
      phone: chooseContact('phone'),
      telegram_id: desiredTelegramId,
      email: chooseContact('email'),
      role: normalizedOptionalValue(profile.role) || target.role || source.role || 'Técnico de Campo',
      avatar_url: normalizedOptionalValue(profile.avatar_url) || target.avatar_url || source.avatar_url || defaultTechnicianAvatar,
      status: ['Ativo', 'Inativo'].includes(profile.status) ? profile.status : target.status
    };

    if (desiredTelegramId) {
      const { data: conflictingTelegram, error: telegramError } = await supabaseAdmin
        .from('technicians')
        .select('id, name')
        .eq('telegram_id', desiredTelegramId)
        .maybeSingle();
      if (telegramError) throw telegramError;
      if (conflictingTelegram && ![sourceId, targetId].includes(conflictingTelegram.id)) {
        return res.status(409).json({
          success: false,
          error: `O ID do Telegram já pertence a ${conflictingTelegram.name}.`
        });
      }
    }

    const [{ data: sourceLinks, error: sourceLinksError }, { data: primaryAppointments, error: primaryError }] = await Promise.all([
      supabaseAdmin.from('appointment_technicians').select('appointment_id').eq('technician_id', sourceId),
      supabaseAdmin.from('appointments').select('id').eq('technician_id', sourceId)
    ]);
    if (sourceLinksError) throw sourceLinksError;
    if (primaryError) throw primaryError;

    const affectedAppointmentIds = [...new Set([
      ...(sourceLinks || []).map(link => link.appointment_id),
      ...(primaryAppointments || []).map(appointment => appointment.id)
    ])];

    if (affectedAppointmentIds.length) {
      const { error: upsertError } = await supabaseAdmin
        .from('appointment_technicians')
        .upsert(
          affectedAppointmentIds.map(appointmentId => ({ appointment_id: appointmentId, technician_id: targetId })),
          { onConflict: 'appointment_id,technician_id', ignoreDuplicates: true }
        );
      if (upsertError) throw upsertError;
    }

    if (source.telegram_id && source.telegram_id === desiredTelegramId) {
      const { error: clearTelegramError } = await supabaseAdmin
        .from('technicians')
        .update({ telegram_id: null })
        .eq('id', sourceId);
      if (clearTelegramError) throw clearTelegramError;
    }

    const { data: updatedTarget, error: targetUpdateError } = await supabaseAdmin
      .from('technicians')
      .update(targetProfile)
      .eq('id', targetId)
      .select('*')
      .single();
    if (targetUpdateError) throw targetUpdateError;

    const [appointmentsResult, reservationsResult, notificationsResult] = await Promise.all([
      supabaseAdmin.from('appointments').update({ technician_id: targetId }).eq('technician_id', sourceId).select('id'),
      supabaseAdmin.from('reservations').update({ technician_id: targetId }).eq('technician_id', sourceId).select('id'),
      supabaseAdmin.from('notification_logs').update({ technician_id: targetId }).eq('technician_id', sourceId).select('id')
    ]);
    if (appointmentsResult.error) throw appointmentsResult.error;
    if (reservationsResult.error) throw reservationsResult.error;
    if (notificationsResult.error) throw notificationsResult.error;

    const { error: sourceLinksDeleteError } = await supabaseAdmin
      .from('appointment_technicians')
      .delete()
      .eq('technician_id', sourceId);
    if (sourceLinksDeleteError) throw sourceLinksDeleteError;

    await refreshAppointmentTechnicianSummary(affectedAppointmentIds);

    const { error: sourceDeleteError } = await supabaseAdmin
      .from('technicians')
      .delete()
      .eq('id', sourceId);
    if (sourceDeleteError) throw sourceDeleteError;

    res.json({
      success: true,
      technician: updatedTarget,
      merged: { source_id: sourceId, target_id: targetId },
      moved: {
        appointments: appointmentsResult.data?.length || 0,
        appointment_links: affectedAppointmentIds.length,
        reservations: reservationsResult.data?.length || 0,
        notifications: notificationsResult.data?.length || 0
      }
    });
  } catch (err: any) {
    const status = err.code === '23505' ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  } finally {
    technicianMergeLocks.delete(sourceId);
    technicianMergeLocks.delete(targetId);
  }
});

// ==========================================
// 4. CATEGORIES & TEST TEMPLATES
// ==========================================
router.get('/categories', async (req: Request, res: Response) => {
  try {
    const categories = await fetchAllFromTable('equipment_categories', 'id');
    const templates = await fetchAllFromTable('test_templates', 'id');

    const categoriesWithTemplates = categories.map((cat: any) => {
      const catTemplates = templates
        .filter((t: any) => t.category_id === cat.id)
        .map((t: any) => ({
          ...t,
          required_parameters: typeof t.required_parameters === 'string'
            ? JSON.parse(t.required_parameters)
            : t.required_parameters
        }));
      return {
        ...cat,
        templates: catTemplates
      };
    });

    res.json({ success: true, categories: categoriesWithTemplates });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/categories/templates', async (req: Request, res: Response) => {
  try {
    const { category_id, analyzer_type, required_parameters } = req.body;

    if (!category_id || !analyzer_type || !required_parameters) {
      return res.status(400).json({ success: false, error: 'Categoria, Tipo de Analisador e Parâmetros são obrigatórios.' });
    }

    const reqParamJson = Array.isArray(required_parameters) ? required_parameters : [required_parameters];

    const { data, error } = await supabaseAdmin
      .from('test_templates')
      .insert({
        category_id: Number(category_id),
        analyzer_type,
        required_parameters: reqParamJson as any,
        is_mandatory: 1
      })
      .select('id')
      .single();

    if (error) throw error;

    res.json({ success: true, id: data.id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. ANALYZERS INVENTORY
// ==========================================
router.get('/analyzers', async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const analyzers = await fetchAllFromTable('analyzers', 'id');
    const { data: reservations, error: resErr } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .in('status', ['Reservado', 'Em Uso']);
    if (resErr) throw resErr;

    let techMap = new Map();
    let apptMap = new Map();

    if (reservations && reservations.length > 0) {
      const techIds = Array.from(new Set(reservations.map(r => r.technician_id).filter((id): id is number => id !== null)));
      const apptIds = Array.from(new Set(reservations.map(r => r.appointment_id).filter((id): id is number => id !== null)));

      const [{ data: techs }, { data: appts }] = await Promise.all([
        techIds.length > 0 ? supabaseAdmin.from('technicians').select('id, name').in('id', techIds) : Promise.resolve({ data: [] }),
        apptIds.length > 0 ? supabaseAdmin.from('appointments').select('id, client_name').in('id', apptIds) : Promise.resolve({ data: [] })
      ]);

      techMap = new Map((techs || []).map(t => [t.id, t]));
      apptMap = new Map((appts || []).map(a => [a.id, a]));
    }

    const enriched = analyzers.map((an: any) => {
      const activeRes = (reservations || []).find(r => r.analyzer_id === an.id);
      let resInfo = null;
      if (activeRes) {
        const tech = activeRes.technician_id ? techMap.get(activeRes.technician_id) : null;
        const appt = activeRes.appointment_id ? apptMap.get(activeRes.appointment_id) : null;
        const appointmentTeam = typeof appt?.technician_names === 'string' && appt.technician_names.trim()
          ? appt.technician_names.trim()
          : null;
        const reservedBy = tech?.name || appointmentTeam || 'Setor não informado';
        resInfo = {
          ...activeRes,
          technician_name: tech?.name || null,
          reserved_by: reservedBy,
          reserved_by_type: tech ? 'technician' : 'sector',
          client_name: appt ? appt.client_name : 'N/A'
        };
      }
      return {
        ...an,
        current_reservation: resInfo
      };
    });

    res.json({ success: true, analyzers: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/analyzers/template-excel', async (_req: Request, res: Response) => {
  try {
    const buffer = generateAnalyzersExcelTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo_padroes_calibracao.xlsx"');
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/analyzers/sync-excel', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    let rowsToProcess: AnalyzerExcelRow[] = [];

    if (req.body.fileBase64) {
      if (typeof req.body.fileBase64 !== 'string' || req.body.fileBase64.length > MAX_EXCEL_BASE64_LENGTH) {
        return res.status(413).json({
          success: false,
          error: 'A planilha excede o limite de tamanho permitido.'
        });
      }
      const buffer = Buffer.from(req.body.fileBase64, 'base64');
      rowsToProcess = parseAnalyzersExcelBuffer(buffer);
    } else if (Array.isArray(req.body.rows)) {
      if (req.body.rows.length > MAX_EXCEL_ROWS) {
        return res.status(413).json({
          success: false,
          error: `A importação está limitada a ${MAX_EXCEL_ROWS} linhas.`
        });
      }
      req.body.rows.forEach((r: any, idx: number) => {
        if (r.asset_tag) {
          rowsToProcess.push({
            asset_tag: String(r.asset_tag).trim().toUpperCase(),
            name: String(r.name || `Analisador ${r.asset_tag}`).trim(),
            type: String(r.type || 'Padrão Geral').trim(),
            serial_number: String(r.serial_number || r.asset_tag).trim(),
            brand_model: String(r.brand_model || r.name || '').trim(),
            status: r.status || 'Disponível',
            calibration_date: r.calibration_date || null,
            calibration_expiry: r.calibration_expiry || null,
            current_location: r.current_location || 'Almoxarifado Central',
            notes: r.notes || '',
            rawRowIndex: idx + 1
          });
        } else {
          const mapped = mapRowToAnalyzer(r, idx + 1);
          if (mapped) rowsToProcess.push(mapped);
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Nenhum dado de planilha enviado. Envie rows (array) ou fileBase64.'
      });
    }

    if (rowsToProcess.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhuma linha válida de analisador/padrão encontrada na planilha. Verifique a coluna de Patrimônio.'
      });
    }

    if (rowsToProcess.length > MAX_EXCEL_ROWS) {
      return res.status(413).json({
        success: false,
        error: `A importação está limitada a ${MAX_EXCEL_ROWS} linhas.`
      });
    }

    const { data: existingList, error: fetchErr } = await supabaseAdmin
      .from('analyzers')
      .select('*');

    if (fetchErr) throw fetchErr;

    const existingMap = new Map<string, any>();
    for (const a of existingList || []) {
      if (a.asset_tag) {
        const clean = String(a.asset_tag).toUpperCase().trim();
        existingMap.set(clean, a);
        if (/^\d+$/.test(clean)) {
          existingMap.set(clean.padStart(6, '0'), a);
          const unpadded = clean.replace(/^0+/, '');
          if (unpadded) existingMap.set(unpadded, a);
        }
      }
    }

    const findExisting = (tag: string) => {
      const clean = String(tag || '').toUpperCase().trim();
      if (!clean) return undefined;
      if (existingMap.has(clean)) return existingMap.get(clean);
      if (/^\d+$/.test(clean)) {
        const padded = clean.padStart(6, '0');
        if (existingMap.has(padded)) return existingMap.get(padded);
        const unpadded = clean.replace(/^0+/, '');
        if (unpadded && existingMap.has(unpadded)) return existingMap.get(unpadded);
      }
      return undefined;
    };

    let createdCount = 0;
    let updatedCount = 0;
    const errors: Array<{ asset_tag: string; error: string }> = [];
    const details: Array<{ asset_tag: string; action: 'created' | 'updated' | 'error'; name: string; calibration_expiry?: string | null }> = [];

    for (const row of rowsToProcess) {
      try {
        let tag = String(row.asset_tag || '').trim().toUpperCase();
        if (/^\d+$/.test(tag) && tag.length < 6) {
          tag = tag.padStart(6, '0');
        }

        const existing = findExisting(tag);

        if (existing) {
          const updates: Record<string, any> = {
            name: row.name || existing.name,
            type: row.type || existing.type,
            serial_number: row.serial_number || existing.serial_number,
            brand_model: row.brand_model || existing.brand_model || row.name,
            current_location: row.current_location || existing.current_location || 'Almoxarifado Central',
            notes: row.notes !== undefined && row.notes !== '' ? row.notes : existing.notes
          };

          if (row.calibration_date !== undefined) updates.calibration_date = row.calibration_date;
          if (row.calibration_expiry !== undefined) {
            updates.calibration_expiry = row.calibration_expiry;
            updates.calibration_due = row.calibration_expiry;
          }
          if (row.status && existing.status !== 'Em Uso' && existing.status !== 'Reservado') {
            updates.status = row.status;
          }

          const { error: updErr } = await supabaseAdmin
            .from('analyzers')
            .update(updates)
            .eq('id', existing.id);

          if (updErr) throw updErr;

          updatedCount++;
          details.push({
            asset_tag: existing.asset_tag || tag,
            action: 'updated',
            name: row.name,
            calibration_expiry: row.calibration_expiry ?? existing.calibration_expiry
          });
        } else {
          const { data: insData, error: insErr } = await supabaseAdmin
            .from('analyzers')
            .insert({
              asset_tag: tag,
              name: row.name,
              type: row.type,
              serial_number: row.serial_number,
              brand_model: row.brand_model || row.name,
              status: row.status || 'Disponível',
              calibration_date: row.calibration_date || null,
              calibration_expiry: row.calibration_expiry || null,
              calibration_due: row.calibration_expiry || null,
              current_location: row.current_location || 'Almoxarifado Central',
              notes: row.notes || ''
            })
            .select('id, asset_tag')
            .single();

          if (insErr) throw insErr;

          const createdObj = { ...row, asset_tag: tag, id: insData.id };
          existingMap.set(tag, createdObj);
          if (/^\d+$/.test(tag)) {
            const unpadded = tag.replace(/^0+/, '');
            if (unpadded) existingMap.set(unpadded, createdObj);
          }
          createdCount++;
          details.push({
            asset_tag: tag,
            action: 'created',
            name: row.name,
            calibration_expiry: row.calibration_expiry
          });
        }
      } catch (err: any) {
        errors.push({ asset_tag: row.asset_tag, error: err.message });
        details.push({
          asset_tag: row.asset_tag,
          action: 'error',
          name: row.name
        });
      }
    }

    res.json({
      success: true,
      message: `Sincronização concluída: ${updatedCount} atualizado(s), ${createdCount} criado(s), ${errors.length} erro(s).`,
      total: rowsToProcess.length,
      createdCount,
      updatedCount,
      errorCount: errors.length,
      errors,
      details
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/analyzers', async (req: Request, res: Response) => {
  try {
    const { asset_tag, name, type, serial_number, brand_model, calibration_date, calibration_expiry, current_location, notes } = req.body;

    if (!asset_tag || !name || !type || !serial_number) {
      return res.status(400).json({ success: false, error: 'Patrimônio, Nome, Tipo e Nº de Série são obrigatórios.' });
    }

    const cleanTag = asset_tag.toUpperCase().trim();

    const { data: existing, error: checkErr } = await supabaseAdmin
      .from('analyzers')
      .select('id')
      .eq('asset_tag', cleanTag)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (existing) {
      return res.status(400).json({ success: false, error: `Já existe um analisador cadastrado com o Patrimônio ${cleanTag}.` });
    }

    const { data, error } = await supabaseAdmin
      .from('analyzers')
      .insert({
        asset_tag: cleanTag,
        name,
        type,
        serial_number,
        brand_model: brand_model || name,
        status: 'Disponível',
        calibration_date: calibration_date || null,
        calibration_expiry: calibration_expiry || null,
        current_location: current_location || 'Almoxarifado Central',
        notes: notes || ''
      })
      .select('id')
      .single();

    if (error) throw error;

    res.json({ success: true, id: data.id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/analyzers/:id', async (req: Request, res: Response) => {
  try {
    const analyzerId = Number(req.params.id);
    const { asset_tag, name, type, serial_number, brand_model, status, calibration_date, calibration_expiry, current_location, notes } = req.body;

    const updates: Record<string, any> = {};
    if (asset_tag !== undefined) updates.asset_tag = asset_tag.toUpperCase().trim();
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (serial_number !== undefined) updates.serial_number = serial_number;
    if (brand_model !== undefined) updates.brand_model = brand_model;
    if (status !== undefined) updates.status = status;
    if (calibration_date !== undefined) updates.calibration_date = calibration_date || null;
    if (calibration_expiry !== undefined) updates.calibration_expiry = calibration_expiry || null;
    if (current_location !== undefined) updates.current_location = current_location;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabaseAdmin
      .from('analyzers')
      .update(updates as any)
      .eq('id', analyzerId)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, analyzer: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/analyzers/:id', async (req: Request, res: Response) => {
  try {
    const analyzerId = Number(req.params.id);

    // Remove foreign reservations first
    await supabaseAdmin
      .from('reservations')
      .delete()
      .eq('analyzer_id', analyzerId);

    const { error } = await supabaseAdmin
      .from('analyzers')
      .delete()
      .eq('id', analyzerId);

    if (error) throw error;
    res.json({ success: true, message: 'Padrão excluído com sucesso do banco de dados.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. APPOINTMENTS & CHECKLIST
// ==========================================
router.get('/appointments', requireAuthentication, async (req: Request, res: Response) => {
  try {
    const { date, technician_id } = req.query;

    const [appts, apptEquips, cats, resList, analyzers, techs, apptTechs] = await Promise.all([
      fetchAllFromTable('appointments', 'id'),
      fetchAllFromTable('appointment_equipments', 'id'),
      fetchAllFromTable('equipment_categories', 'id'),
      fetchAllFromTable('reservations', 'id'),
      fetchAllFromTable('analyzers', 'id'),
      fetchAllFromTable('technicians', 'id'),
      fetchAllFromTable('appointment_technicians', 'appointment_id')
    ]);

    const catMap = new Map(cats.map((c: any) => [c.id, c.name]));
    const analyzerMap = new Map(analyzers.map((a: any) => [a.id, a]));
    const techMap = new Map(techs.map((t: any) => [t.id, t]));

    const apptEquipsMap = new Map<number, any[]>();
    for (const eq of apptEquips) {
      if (!apptEquipsMap.has(eq.appointment_id)) apptEquipsMap.set(eq.appointment_id, []);
      apptEquipsMap.get(eq.appointment_id)!.push({
        ...eq,
        category_name: eq.category_id ? (catMap.get(eq.category_id) || 'Outros') : 'Outros'
      });
    }

    const apptResMap = new Map<number, any[]>();
    for (const r of resList) {
      if (!r.appointment_id) continue;
      if (!apptResMap.has(r.appointment_id)) apptResMap.set(r.appointment_id, []);
      const analyzer = r.analyzer_id ? analyzerMap.get(r.analyzer_id) : null;
      apptResMap.get(r.appointment_id)!.push({
        ...r,
        asset_tag: analyzer ? analyzer.asset_tag : 'N/A',
        analyzer_name: analyzer ? analyzer.name : 'N/A',
        analyzer_type: analyzer ? analyzer.type : 'N/A'
      });
    }

    const apptTechIdsMap = new Map<number, number[]>();
    for (const at of apptTechs) {
      if (!apptTechIdsMap.has(at.appointment_id)) apptTechIdsMap.set(at.appointment_id, []);
      apptTechIdsMap.get(at.appointment_id)!.push(at.technician_id);
    }

    let list = appts;
    if (date) {
      list = list.filter((a: any) => a.appointment_date === date);
    }
    if (technician_id) {
      const tId = Number(technician_id);
      list = list.filter((a: any) => {
        const assignedIds = apptTechIdsMap.get(a.id) || [];
        return assignedIds.includes(tId) || a.technician_id === tId;
      });
    }

    const enriched = list.map((appt: any) => {
      const tIds = apptTechIdsMap.get(appt.id) || (appt.technician_id ? [appt.technician_id] : []);
      const tech = appt.technician_id ? techMap.get(appt.technician_id) : null;
      const assignee = appt.workflow_assignee_id ? techMap.get(appt.workflow_assignee_id) : null;
      const techNames = appt.technician_names || (tech ? tech.name : 'Equipe de Campo');

      return {
        ...publicCalendarAppointment(appt),
        technician_ids: tIds,
        technician_name: techNames,
        technician_names: techNames,
        technician_phone: tech ? tech.phone : 'N/A',
        workflow_assignee_name: assignee ? assignee.name : null,
        equipments: apptEquipsMap.get(appt.id) || [],
        reservations: apptResMap.get(appt.id) || []
      };
    });

    res.json({ success: true, appointments: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/appointments', (req: Request, res: Response, next) => {
  req.url = '/appointments/calendar';
  calendarRouter(req, res, next);
});

router.get('/appointments/:id/checklist', async (req: Request, res: Response) => {
  try {
    const apptId = Number(req.params.id);

    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('id', apptId)
      .maybeSingle();

    if (apptErr) throw apptErr;
    if (!appt) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado.' });
    }

    let techName = 'N/A';
    if (appt.technician_id) {
      const { data: tech } = await supabaseAdmin
        .from('technicians')
        .select('name')
        .eq('id', appt.technician_id)
        .maybeSingle();
      if (tech) techName = tech.name;
    }

    if (isNonTechnicalAppointment(appt)) {
      return res.json({
        success: true,
        appointment: { ...appt, technician_name: techName },
        equipments: [],
        testTemplates: [],
        requiredAnalyzerTypes: [],
        availableAnalyzersGrouped: {},
        existingReservations: [],
        isTechnicalService: false,
        message: 'Este agendamento não é um serviço técnico (Sobreaviso, Exame, Aniversário, Revisão, Treinamento) e não requer padrões.'
      });
    }

    const { data: eqList } = await supabaseAdmin
      .from('appointment_equipments')
      .select('*')
      .eq('appointment_id', apptId);

    const cats = await fetchAllFromTable('equipment_categories', 'id');
    const catMap = new Map(cats.map((c: any) => [c.id, c.name]));

    const equipments = (eqList || []).map(ae => ({
      ...ae,
      category_name: ae.category_id ? (catMap.get(ae.category_id) || 'Outros') : 'Outros'
    }));

    const categoryIds = Array.from(new Set(equipments.map(e => e.category_id).filter((id): id is number => id !== null)));

    const { data: tmplList } = categoryIds.length > 0
      ? await supabaseAdmin.from('test_templates').select('*').in('category_id', categoryIds)
      : { data: [] };

    const testTemplates = (tmplList || []).map(tt => ({
      ...tt,
      category_name: catMap.get(tt.category_id) || 'Outros',
      required_parameters: typeof tt.required_parameters === 'string' ? JSON.parse(tt.required_parameters) : tt.required_parameters
    }));

    // Conditional, model-specific associations remain visible in the checklist,
    // but only mandatory templates must have an analyzer reserved up front.
    const requiredAnalyzerTypes = Array.from(new Set(
      testTemplates
        .filter(tt => Number(tt.is_mandatory) !== 0)
        .map(tt => tt.analyzer_type)
    ));

    const availAnalyzers = await fetchAllFromTable('analyzers', 'id');
    const operationalAvailableAnalyzers = availAnalyzers.filter((a: any) =>
      a.status === 'Disponível' && !/manuten|indispon|baixado/i.test(a.status || '')
    );

    const availableAnalyzersGrouped: Record<string, any[]> = {};
    if (requiredAnalyzerTypes.length > 0) {
      for (const anType of requiredAnalyzerTypes) {
        availableAnalyzersGrouped[anType] = operationalAvailableAnalyzers;
      }
    } else {
      availableAnalyzersGrouped['Padrão / Simulador'] = operationalAvailableAnalyzers;
    }

    const { data: resList } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('appointment_id', apptId);

    let existingReservations: any[] = [];
    if (resList && resList.length > 0) {
      const anIds = Array.from(new Set(resList.map(r => r.analyzer_id).filter((id): id is number => id !== null)));
      const { data: resAnalyzers } = anIds.length > 0
        ? await supabaseAdmin.from('analyzers').select('id, asset_tag, name, type, serial_number').in('id', anIds)
        : { data: [] };
      const anMap = new Map((resAnalyzers || []).map(a => [a.id, a]));
      existingReservations = resList.map(r => {
        const analyzer = r.analyzer_id ? anMap.get(r.analyzer_id) : null;
        return {
          ...r,
          asset_tag: analyzer ? analyzer.asset_tag : 'N/A',
          analyzer_name: analyzer ? analyzer.name : 'N/A',
          analyzer_type: analyzer ? analyzer.type : 'N/A',
          serial_number: analyzer ? analyzer.serial_number : 'N/A'
        };
      });
    }

    res.json({
      success: true,
      appointment: { ...appt, technician_name: techName },
      equipments,
      testTemplates,
      requiredAnalyzerTypes,
      availableAnalyzersGrouped,
      existingReservations
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Atualiza apenas o estado operacional do agendamento. O carro é opcional:
// a agenda pode ser validada e confirmada antes de uma viatura ser vinculada.
router.patch('/appointments/:id/workflow', requireAuthentication, requireRole(schedulingRoles), async (req: Request, res: Response) => {
  try {
    const appointmentId = parsePositiveId(req.params.id);
    if (!appointmentId) return res.status(400).json({ success: false, error: 'Agendamento inválido.' });

    const { workflow_status, workflow_assignee_id, vehicle_id } = req.body || {};
    const allowedStatuses = new Set([
      'Data provisória',
      'Aguardando validação do supervisor',
      'Validado pelo supervisor',
      'Confirmado com cliente',
      'Em execução',
      'Concluído'
    ]);
    if (workflow_status !== undefined && !allowedStatuses.has(String(workflow_status))) {
      return res.status(400).json({ success: false, error: 'Status de workflow inválido.' });
    }

    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle();
    if (appointmentError) throw appointmentError;
    if (!appointment) return res.status(404).json({ success: false, error: 'Agendamento não encontrado.' });

    const actorRole = (req as any).user.role;
    const currentStatus = appointment.workflow_status || 'Data provisória';
    if ((workflow_status !== undefined && !canTransitionWorkflow(actorRole, currentStatus, workflow_status))
      || (vehicle_id !== undefined && actorRole === 'commercial')) {
      return res.status(403).json({ success: false, error: 'Esta etapa ou atribuição de veículo pertence a outro perfil.' });
    }

    if (workflow_status !== undefined) {
      const assigneeId = parsePositiveId(workflow_assignee_id);
      if (!assigneeId) return res.status(422).json({ success: false, error: 'Escolha o colaborador responsável pela próxima etapa.' });
      const { data: assigned, error: assignedError } = await supabaseAdmin
        .from('appointment_technicians').select('technician_id').eq('appointment_id', appointmentId);
      if (assignedError) throw assignedError;
      const hasTechnician = Boolean(assigned?.length || appointment.technician_id);
      const missing = missingWorkflowFields(appointment, workflow_status, hasTechnician);
      if (missing.length) return res.status(422).json({ success: false, error: `Preencha antes de avançar: ${missing.join(', ')}.`, missing_fields: missing });
      const { data: assignee, error: assigneeError } = await supabaseAdmin.from('technicians')
        .select('id,name,role,status').eq('id', assigneeId).maybeSingle();
      if (assigneeError) throw assigneeError;
      if (!assignee || String(assignee.status || '').toLowerCase() !== 'ativo') {
        return res.status(422).json({ success: false, error: 'Selecione um colaborador ativo.' });
      }
      const isAssignedTechnician = Boolean(assigned?.some(item => Number(item.technician_id) === assigneeId) || Number(appointment.technician_id) === assigneeId);
      if (!canReceiveWorkflowStage(workflow_status, assignee.role, isAssignedTechnician)) {
        return res.status(422).json({ success: false, error: 'O responsável não pertence ao perfil ou à equipe exigida para esta etapa.' });
      }
    }

    const nextVehicleId = vehicle_id === null || vehicle_id === '' || vehicle_id === undefined
      ? (vehicle_id === null || vehicle_id === '' ? null : appointment.vehicle_id || null)
      : parsePositiveId(vehicle_id);
    if (vehicle_id !== undefined && vehicle_id !== null && vehicle_id !== '' && !nextVehicleId) {
      return res.status(400).json({ success: false, error: 'Veículo inválido.' });
    }

    if (nextVehicleId) {
      const { data: vehicle, error: vehicleError } = await supabaseAdmin
        .from('fleet_vehicles')
        .select('*')
        .eq('id', nextVehicleId)
        .maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!vehicle) return res.status(404).json({ success: false, error: 'Veículo não encontrado.' });
      if (/manuten|indispon|baixado|revis/i.test(vehicle.status || '')) {
        return res.status(409).json({ success: false, error: `O veículo está com status “${vehicle.status}” e não pode ser reservado.` });
      }

      const { data: conflictingAppointments, error: conflictError } = await supabaseAdmin
        .from('appointments')
        .select('id, client_name, appointment_date, appointment_time, workflow_status, status')
        .eq('vehicle_id', nextVehicleId)
        .eq('appointment_date', appointment.appointment_date)
        .neq('id', appointmentId);
      if (conflictError) throw conflictError;
      const currentMinutes = appointmentTimeMinutes(appointment.appointment_time);
      const conflicting = (conflictingAppointments || []).find((item: any) => {
        if (/cancelado/i.test(`${item.status || ''} ${item.workflow_status || ''}`)) return false;
        const itemMinutes = appointmentTimeMinutes(item.appointment_time);
        return currentMinutes === null || itemMinutes === null || currentMinutes === itemMinutes;
      });
      if (conflicting) {
        return res.status(409).json({
          success: false,
          error: `O veículo já está reservado para “${conflicting.client_name || 'outro atendimento'}” no mesmo horário.`
        });
      }

      const { data: activeUsage, error: usageError } = await supabaseAdmin
        .from('fleet_usage')
        .select('id, appointment_id, withdrawn_by_name')
        .eq('vehicle_id', nextVehicleId)
        .eq('status', 'Em Uso')
        .maybeSingle();
      if (usageError) throw usageError;
      if (activeUsage && activeUsage.appointment_id !== appointmentId) {
        return res.status(409).json({ success: false, error: `O veículo está em uso por ${activeUsage.withdrawn_by_name || 'outro usuário'}.` });
      }
    }

    const nextStatus = workflow_status === undefined ? (appointment.workflow_status || 'Data provisória') : workflow_status;
    const now = new Date().toISOString();
    const update: Record<string, any> = {
      workflow_status: nextStatus,
      vehicle_id: nextVehicleId,
      last_activity_at: now
    };
    if (workflow_status === 'Validado pelo supervisor') update.workflow_validated_at = now;
    if (workflow_status === 'Confirmado com cliente') update.commercial_confirmed_at = now;
    if (workflow_status !== undefined) {
      update.workflow_assignee_id = Number(workflow_assignee_id);
      update.workflow_assigned_at = now;
      update.workflow_assigned_by = String((req as any).user.sub);
    }
    if (vehicle_id !== undefined) update.vehicle_assigned_at = nextVehicleId ? now : null;

    const guardedUpdate = supabaseAdmin
      .from('appointments')
      .update(update)
      .eq('id', appointmentId);
    const { data: updated, error: updateError } = await (appointment.workflow_status == null
      ? guardedUpdate.is('workflow_status', null)
      : guardedUpdate.eq('workflow_status', appointment.workflow_status))
      .select('*')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return res.status(409).json({ success: false, error: 'O atendimento mudou. Atualize o Workflow antes de avançar.' });
    res.json({ success: true, appointment: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. RESERVATIONS & CHECKOUT / CHECKIN
// ==========================================
router.get('/reservations', async (req: Request, res: Response) => {
  try {
    let query = supabaseAdmin.from('reservations').select('*');

    const analyzerIdParam = req.query.analyzer_id ? Number(req.query.analyzer_id) : null;
    const technicianIdParam = req.query.technician_id ? Number(req.query.technician_id) : null;

    if (analyzerIdParam && !isNaN(analyzerIdParam)) {
      query = query.eq('analyzer_id', analyzerIdParam);
    }
    if (technicianIdParam && !isNaN(technicianIdParam)) {
      query = query.eq('technician_id', technicianIdParam);
    }

    const { data: reservationsData, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    const reservations = (reservationsData || []).sort((a: any, b: any) => {
      const dateA = a.checkout_at || a.reserved_date || '';
      const dateB = b.checkout_at || b.reserved_date || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return Number(b.id) - Number(a.id);
    });

    let analyzerMap = new Map();
    let techMap = new Map();
    let apptMap = new Map();

    if (reservations.length > 0) {
      const anIds = Array.from(new Set(reservations.map((r: any) => r.analyzer_id).filter((id: any): id is number => id !== null)));
      const techIds = Array.from(new Set(reservations.map((r: any) => r.technician_id).filter((id: any): id is number => id !== null)));
      const apptIds = Array.from(new Set(reservations.map((r: any) => r.appointment_id).filter((id: any): id is number => id !== null)));

      const [{ data: analyzers }, { data: techs }, { data: appts }] = await Promise.all([
        anIds.length > 0 ? supabaseAdmin.from('analyzers').select('id, asset_tag, name, type, brand_model').in('id', anIds) : Promise.resolve({ data: [] }),
        techIds.length > 0 ? supabaseAdmin.from('technicians').select('id, name, phone').in('id', techIds) : Promise.resolve({ data: [] }),
        apptIds.length > 0 ? supabaseAdmin.from('appointments').select('id, client_name, appointment_date').in('id', apptIds) : Promise.resolve({ data: [] })
      ]);

      analyzerMap = new Map((analyzers || []).map(a => [a.id, a]));
      techMap = new Map((techs || []).map(t => [t.id, t]));
      apptMap = new Map((appts || []).map(ap => [ap.id, ap]));
    }

    const enriched = reservations.map((r: any) => {
      const analyzer = r.analyzer_id ? analyzerMap.get(r.analyzer_id) : null;
      const tech = r.technician_id ? techMap.get(r.technician_id) : null;
      const appt = r.appointment_id ? apptMap.get(r.appointment_id) : null;
      const opType = r.operation_type || (r.appointment_id ? 'Atendimento' : 'Uso Interno');

      let clientDisplay = appt ? appt.client_name : (
        opType === 'Calibração' ? '[Calibração de Padrão]' :
        opType === 'Empréstimo' ? '[Empréstimo de Equipamento]' :
        opType === 'Chamado' ? (r.notes ? `[Chamado] ${r.notes}` : '[Chamado Técnico Espontâneo]') :
        '[Operação Interna]'
      );

      return {
        ...r,
        operation_type: opType,
        asset_tag: analyzer ? analyzer.asset_tag : 'N/A',
        analyzer_name: analyzer ? analyzer.name : 'N/A',
        analyzer_type: analyzer ? analyzer.type : 'N/A',
        brand_model: analyzer ? analyzer.brand_model : 'N/A',
        technician_name: tech ? tech.name : 'N/A',
        technician_phone: tech ? tech.phone : 'N/A',
        client_name: clientDisplay,
        appointment_date: appt ? appt.appointment_date : (r.reserved_date || 'N/A')
      };
    });

    res.json({ success: true, reservations: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7.1 FROTA / RETIRADA E DEVOLUÇÃO DE VEÍCULOS
// ==========================================
router.get('/fleet/vehicles', requireAuthentication, async (_req: Request, res: Response) => {
  try {
    const [{ data: vehicles, error: vehiclesError }, { data: usages, error: usagesError }, { data: appointments, error: appointmentsError }] = await Promise.all([
      supabaseAdmin.from('fleet_vehicles').select('*').order('name', { ascending: true }),
      supabaseAdmin.from('fleet_usage').select('*').order('checkout_at', { ascending: false }),
      supabaseAdmin.from('appointments').select('id, client_name, title, appointment_date, appointment_time, workflow_status, vehicle_id, technician_id, technician_names, status').not('vehicle_id', 'is', null)
    ]);
    if (vehiclesError) throw vehiclesError;
    if (usagesError) throw usagesError;
    if (appointmentsError) throw appointmentsError;

    const activeUsages = (usages || []).filter((usage: any) => usage.status === 'Em Uso');
    const enrichedVehicles = (vehicles || []).map((vehicle: any) => ({
      ...vehicle,
      active_usage: activeUsages.find((usage: any) => usage.vehicle_id === vehicle.id) || null,
      scheduled_appointments: (appointments || []).filter((appointment: any) => appointment.vehicle_id === vehicle.id)
    }));
    res.json({ success: true, vehicles: enrichedVehicles, usage: usages || [] });
  } catch (err: any) {
    const missingSetup = /fleet_(vehicles|usage)|relation .* does not exist/i.test(err.message || '');
    res.status(missingSetup ? 503 : 500).json({
      success: false,
      setupRequired: missingSetup,
      error: missingSetup ? 'A estrutura da frota ainda não foi aplicada. Execute a migração 002_workflow_fleet.sql.' : err.message
    });
  }
});

router.post('/fleet/vehicles', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    const plate = String(req.body?.plate || '').trim().toUpperCase();
    const currentKm = parseNonNegativeNumber(req.body?.current_km ?? 0);
    if (!name || !plate || currentKm === null) return res.status(400).json({ success: false, error: 'Nome, placa e KM atual são obrigatórios.' });
    const { data: vehicle, error } = await supabaseAdmin.from('fleet_vehicles').insert({
      name,
      plate,
      brand_model: normalizedOptionalValue(req.body?.brand_model),
      status: normalizedOptionalValue(req.body?.status) || 'Disponível',
      current_km: currentKm,
      notes: normalizedOptionalValue(req.body?.notes) || ''
    }).select('*').single();
    if (error) throw error;
    res.status(201).json({ success: true, vehicle });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/fleet/vehicles/:id', requireAuthentication, requireManagement, async (req: Request, res: Response) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Veículo inválido.' });
    const updates: Record<string, any> = {};
    for (const field of ['name', 'plate', 'brand_model', 'status', 'notes']) {
      if (req.body?.[field] !== undefined) updates[field] = field === 'plate' ? String(req.body[field]).trim().toUpperCase() : req.body[field];
    }
    if (req.body?.current_km !== undefined) {
      const km = parseNonNegativeNumber(req.body.current_km);
      if (km === null) return res.status(400).json({ success: false, error: 'KM atual inválido.' });
      updates.current_km = km;
    }
    updates.updated_at = new Date().toISOString();
    const { data: vehicle, error } = await supabaseAdmin.from('fleet_vehicles').update(updates).eq('id', id).select('*').single();
    if (error) throw error;
    res.json({ success: true, vehicle });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fleet/vehicles/:id/checkout', requireAuthentication, async (req: Request, res: Response) => {
  try {
    const vehicleId = parsePositiveId(req.params.id);
    if (!vehicleId) return res.status(400).json({ success: false, error: 'Veículo inválido.' });
    const kmInitial = parseNonNegativeNumber(req.body?.km_initial);
    if (kmInitial === null) return res.status(400).json({ success: false, error: 'Informe o KM atual do veículo.' });
    const appointmentId = req.body?.appointment_id ? parsePositiveId(req.body.appointment_id) : null;
    const odometerPhotoData = parsePhotoData(req.body?.odometer_photo_data, 'A foto do hodômetro');
    const actor = (req as any).user || {};
    const isManager = isManagementRole(actor.role);
    const managerOverride = isManager && Boolean(req.body?.manager_override);

    const { data: vehicle, error: vehicleError } = await supabaseAdmin.from('fleet_vehicles').select('*').eq('id', vehicleId).maybeSingle();
    if (vehicleError) throw vehicleError;
    if (!vehicle) return res.status(404).json({ success: false, error: 'Veículo não encontrado.' });

    // Regra: "Qualquer problema ou avaria não deve travar o uso do veiculo"
    // Apenas veículos permanentemente baixados são bloqueados.
    if (/baixado/i.test(vehicle.status || '')) {
      return res.status(409).json({ success: false, error: `O veículo está com status “${vehicle.status}” (baixado) e não pode ser retirado.` });
    }

    const { data: activeUsage, error: activeUsageError } = await supabaseAdmin.from('fleet_usage').select('id, appointment_id, withdrawn_by_name').eq('vehicle_id', vehicleId).eq('status', 'Em Uso').maybeSingle();
    if (activeUsageError) throw activeUsageError;
    if (activeUsage) return res.status(409).json({ success: false, error: `O veículo já está em uso por ${activeUsage.withdrawn_by_name || 'outro usuário'}.` });

    let appointment: any = null;
    if (appointmentId) {
      const { data, error } = await supabaseAdmin.from('appointments').select('*').eq('id', appointmentId).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Agendamento não encontrado.' });
      appointment = data;
      if (appointment.vehicle_id && Number(appointment.vehicle_id) !== vehicleId) {
        if (!isManager && !managerOverride) {
          return res.status(409).json({ success: false, error: 'Este agendamento já possui outro veículo reservado.' });
        }
      }
    }

    // Validação de conflito de reserva/agenda
    const { data: scheduled, error: scheduledError } = await supabaseAdmin.from('appointments').select('id, client_name, appointment_date, appointment_time, workflow_status, status').eq('vehicle_id', vehicleId).gte('appointment_date', new Date().toISOString().slice(0, 10)).neq('status', 'Cancelado');
    if (scheduledError) throw scheduledError;
    const margin = Math.max(0, Number(process.env.FLEET_RETURN_MARGIN_MINUTES || 0));
    const currentDate = appointment?.appointment_date || new Date().toISOString().slice(0, 10);
    const currentTime = appointmentTimeMinutes(appointment?.appointment_time) ?? appointmentTimeMinutes(new Date().toISOString().slice(11, 16));
    const conflicting = (scheduled || []).find((item: any) => {
      if (appointmentId && Number(item.id) === appointmentId) return false;
      if (item.appointment_date !== currentDate) return false;
      const itemTime = appointmentTimeMinutes(item.appointment_time);
      return currentTime === null || itemTime === null || Math.abs(itemTime - currentTime) <= margin;
    });

    // Administrador, gerente ou supervisores podem retirar mesmo que o veículo esteja em reserva
    if (conflicting && !isManager && !managerOverride) {
      return res.status(409).json({ success: false, error: `O veículo está reservado para “${conflicting.client_name || 'outro atendimento'}” no mesmo horário.` });
    }

    const usageType = req.body?.usage_type || 'Empresa (Trabalho e deslocamento residência)';
    const cleanlinessOk = req.body?.cleanliness_ok !== undefined ? Boolean(req.body.cleanliness_ok) : true;
    const revisionStatus = req.body?.revision_status || 'Em dia';
    const fluidsChecked = req.body?.fluids_checked !== undefined ? Boolean(req.body.fluids_checked) : true;
    const notesInput = normalizedOptionalValue(req.body?.notes) || '';
    const hasReservationConflict = Boolean(conflicting && (isManager || managerOverride));
    const overrideNote = hasReservationConflict ? `[Retirada autorizada por gestão com sobreposição de reserva de ${conflicting?.client_name || 'outro agendamento'}]` : '';
    const finalNotes = [overrideNote, notesInput].filter(Boolean).join(' ');

    const checkoutInspection = {
      usage_type: usageType,
      cleanliness_ok: cleanlinessOk,
      revision_status: revisionStatus,
      fluids_checked: fluidsChecked,
      manager_override: hasReservationConflict,
      ...(typeof req.body?.damage_inspection === 'object' ? req.body.damage_inspection : {})
    };

    const { data: usage, error: insertError } = await supabaseAdmin.from('fleet_usage').insert({
      vehicle_id: vehicleId,
      appointment_id: appointmentId,
      withdrawn_by_user_id: actor.sub ? String(actor.sub) : null,
      withdrawn_by_name: actor.name || 'Usuário autenticado',
      status: 'Em Uso',
      checkout_at: new Date().toISOString(),
      km_initial: kmInitial,
      odometer_photo_url: normalizedOptionalValue(req.body?.odometer_photo_url),
      odometer_photo_data: odometerPhotoData,
      checkout_inspection: checkoutInspection,
      notes: finalNotes
    }).select('*').single();
    if (insertError) {
      if ((insertError as any).code === '23505') {
        return res.status(409).json({ success: false, error: 'Este veículo acabou de ser retirado por outro usuário. Atualize a frota e tente novamente.' });
      }
      throw insertError;
    }
    await supabaseAdmin.from('fleet_vehicles').update({ status: 'Em Uso', current_km: kmInitial, updated_at: new Date().toISOString() }).eq('id', vehicleId);
    res.status(201).json({ success: true, usage, message: 'Retirada do veículo registrada.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fleet/usage/:id/checkin', requireAuthentication, async (req: Request, res: Response) => {
  try {
    const usageId = parsePositiveId(req.params.id);
    const kmFinal = parseNonNegativeNumber(req.body?.km_final);
    if (!usageId || kmFinal === null) return res.status(400).json({ success: false, error: 'Informe o KM de retorno.' });
    const returnPhotoData = parsePhotoData(req.body?.return_photo_data, 'A foto de retorno');
    const actor = (req as any).user || {};
    const { data: usage, error: usageError } = await supabaseAdmin.from('fleet_usage').select('*').eq('id', usageId).maybeSingle();
    if (usageError) throw usageError;
    if (!usage) return res.status(404).json({ success: false, error: 'Registro de retirada não encontrado.' });
    if (usage.status !== 'Em Uso') return res.status(409).json({ success: false, error: 'Este veículo já foi devolvido ou cancelado.' });
    if (kmFinal < Number(usage.km_initial)) return res.status(400).json({ success: false, error: 'O KM de retorno não pode ser menor que o KM de saída.' });

    const hasNewDamage = Boolean(req.body?.has_new_damage || req.body?.damage_inspection?.has_new_damage);
    const damageDescription = normalizedOptionalValue(req.body?.damage_description) || normalizedOptionalValue(req.body?.damage_inspection?.damage_description) || '';
    const fuelChecked = req.body?.fuel_checked === undefined ? null : Boolean(req.body.fuel_checked);
    const tiresCalibrated = req.body?.tires_calibrated === undefined ? null : Boolean(req.body.tires_calibrated);
    const notesInput = normalizedOptionalValue(req.body?.notes) || '';

    const returnInspection = {
      has_new_damage: hasNewDamage,
      damage_description: damageDescription,
      fuel_checked: fuelChecked,
      tires_calibrated: tiresCalibrated,
      notes: notesInput,
      ...(typeof req.body?.damage_inspection === 'object' ? req.body.damage_inspection : {})
    };

    const nextUsageStatus = hasNewDamage ? 'Devolvido com pendência' : 'Devolvido';

    const { data: updatedUsage, error: updateError } = await supabaseAdmin.from('fleet_usage').update({
      status: nextUsageStatus,
      returned_by_user_id: actor.sub ? String(actor.sub) : null,
      returned_by_name: actor.name || 'Usuário autenticado',
      checkin_at: new Date().toISOString(),
      km_final: kmFinal,
      return_photo_url: normalizedOptionalValue(req.body?.return_photo_url),
      return_photo_data: returnPhotoData,
      return_inspection: returnInspection,
      fuel_checked: fuelChecked,
      tires_calibrated: tiresCalibrated,
      notes: notesInput || usage.notes || '',
      updated_at: new Date().toISOString()
    }).eq('id', usageId).select('*').single();
    if (updateError) throw updateError;

    // Regra: "Qualquer problema ou avaria não deve travar o uso do veiculo"
    // O veículo SEMPRE permanece com status "Disponível".
    let vehicleNotesUpdate: string | undefined = undefined;
    if (hasNewDamage && damageDescription) {
      const damageNote = `[Avaria reportada em ${new Date().toLocaleDateString('pt-BR')} por ${actor.name || 'Usuário'}: ${damageDescription}]`;
      const { data: curVehicle } = await supabaseAdmin.from('fleet_vehicles').select('notes').eq('id', usage.vehicle_id).maybeSingle();
      vehicleNotesUpdate = curVehicle?.notes ? `${curVehicle.notes}\n${damageNote}` : damageNote;
    }

    await supabaseAdmin.from('fleet_vehicles').update({
      status: 'Disponível',
      current_km: kmFinal,
      ...(vehicleNotesUpdate !== undefined ? { notes: vehicleNotesUpdate } : {}),
      updated_at: new Date().toISOString()
    }).eq('id', usage.vehicle_id);

    res.json({
      success: true,
      usage: updatedUsage,
      message: 'Devolução registrada. Veículo disponível para novas retiradas.'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fleet/usage/:id/cancel', requireAuthentication, requireManagement, async (req: Request, res: Response) => {
  try {
    const usageId = parsePositiveId(req.params.id);
    if (!usageId) return res.status(400).json({ success: false, error: 'ID de retirada inválido.' });
    const actor = (req as any).user || {};

    const { data: usage, error: usageError } = await supabaseAdmin.from('fleet_usage').select('*').eq('id', usageId).maybeSingle();
    if (usageError) throw usageError;
    if (!usage) return res.status(404).json({ success: false, error: 'Registro de retirada não encontrado.' });
    if (usage.status !== 'Em Uso') {
      return res.status(409).json({ success: false, error: `A retirada já foi finalizada ou cancelada (status: ${usage.status}).` });
    }

    const cancelReason = normalizedOptionalValue(req.body?.reason) || 'Cancelada pela gestão';
    const cancelNote = `[Cancelado por ${actor.name || 'Gestor'} em ${new Date().toLocaleString('pt-BR')}: ${cancelReason}]`;
    const updatedNotes = usage.notes ? `${usage.notes}\n${cancelNote}` : cancelNote;

    const { data: updatedUsage, error: updateError } = await supabaseAdmin.from('fleet_usage').update({
      status: 'Cancelado',
      notes: updatedNotes,
      updated_at: new Date().toISOString()
    }).eq('id', usageId).select('*').single();
    if (updateError) throw updateError;

    // Liberar veículo imediatamente
    await supabaseAdmin.from('fleet_vehicles').update({
      status: 'Disponível',
      updated_at: new Date().toISOString()
    }).eq('id', usage.vehicle_id);

    res.json({ success: true, usage: updatedUsage, message: 'Retirada cancelada com sucesso. O veículo está disponível novamente.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/fleet/usage/:id/reassign', requireAuthentication, requireManagement, async (req: Request, res: Response) => {
  try {
    const usageId = parsePositiveId(req.params.id);
    if (!usageId) return res.status(400).json({ success: false, error: 'ID de retirada inválido.' });
    const actor = (req as any).user || {};

    const newUserId = req.body?.new_user_id !== undefined && req.body?.new_user_id !== null ? String(req.body.new_user_id).trim() : null;
    const newUserName = req.body?.new_user_name ? String(req.body.new_user_name).trim() : null;

    if (!newUserName) {
      return res.status(400).json({ success: false, error: 'Informe o nome do novo responsável pelo veículo.' });
    }

    const { data: usage, error: usageError } = await supabaseAdmin.from('fleet_usage').select('*').eq('id', usageId).maybeSingle();
    if (usageError) throw usageError;
    if (!usage) return res.status(404).json({ success: false, error: 'Registro de retirada não encontrado.' });
    if (usage.status !== 'Em Uso') {
      return res.status(409).json({ success: false, error: 'Apenas retiradas em andamento podem ter o responsável alterado.' });
    }

    const previousUser = usage.withdrawn_by_name || 'Usuário anterior';
    const reassignNote = `[Responsável alterado de "${previousUser}" para "${newUserName}" por ${actor.name || 'Gestor'} em ${new Date().toLocaleString('pt-BR')}]`;
    const updatedNotes = usage.notes ? `${usage.notes}\n${reassignNote}` : reassignNote;

    const { data: updatedUsage, error: updateError } = await supabaseAdmin.from('fleet_usage').update({
      withdrawn_by_user_id: newUserId,
      withdrawn_by_name: newUserName,
      notes: updatedNotes,
      updated_at: new Date().toISOString()
    }).eq('id', usageId).select('*').single();
    if (updateError) throw updateError;

    res.json({ success: true, usage: updatedUsage, message: `Veículo transferido para ${newUserName} com sucesso.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/fleet/usage', requireAuthentication, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin.from('fleet_usage').select('*').order('checkout_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, usage: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reservations', requireAuthentication, requireRole(['admin', 'manager', 'supervisor', 'technician']), async (req: Request, res: Response) => {
  try {
    const {
      appointment_id,
      analyzer_id,
      technician_id,
      notes,
      operation_type = 'Atendimento',
      reserved_date,
      direct_checkout = false
    } = req.body;

    if (!analyzer_id) {
      return res.status(400).json({ success: false, error: 'Analisador é obrigatório.' });
    }

    let effectiveTechnicianId = technician_id ? Number(technician_id) : null;
    let appointmentForReservation: any = null;
    if (appointment_id) {
      const { data: appointment } = await supabaseAdmin
        .from('appointments')
        .select('*')
        .eq('id', Number(appointment_id))
        .maybeSingle();
      appointmentForReservation = appointment;
      if (appointment && !effectiveTechnicianId) {
        const teamIds = await getAppointmentTeamIds(Number(appointment_id));
        effectiveTechnicianId = teamIds[0] || null;
      }
    }

    const reservationActor = (req as any).user;
    if (reservationActor.role === 'technician') {
      if (Number(reservationActor.sub) !== effectiveTechnicianId) {
        return res.status(403).json({ success: false, error: 'O técnico só pode reservar padrões em seu próprio nome.' });
      }
      if (appointment_id && !(await getAppointmentTeamIds(Number(appointment_id))).includes(Number(reservationActor.sub))) {
        return res.status(403).json({ success: false, error: 'O técnico não está escalado neste atendimento.' });
      }
    }

    const { data: tech } = effectiveTechnicianId
      ? await supabaseAdmin.from('technicians').select('*').eq('id', effectiveTechnicianId).maybeSingle()
      : { data: null };

    if (!tech && !appointment_id) {
      return res.status(400).json({ success: false, error: 'Responsável ou agendamento é obrigatório.' });
    }

    if (!tech && ['Calibração', 'Empréstimo'].includes(operation_type)) {
      return res.status(400).json({ success: false, error: 'Informe o responsável pela operação especial.' });
    }

    const isSpecialOp = operation_type === 'Calibração' || operation_type === 'Empréstimo';
    const isChamado = operation_type === 'Chamado';

    // REGRA DE PERMISSÃO: Apenas Administrador Geral e EQAT podem solicitar/retirar para Calibração e Empréstimo.
    // Chamado pode ser solicitado/retirado por QUALQUER técnico.
    if (isSpecialOp) {
      const isEqat = tech?.name?.trim().toUpperCase() === 'EQAT';
      const isAdmin = tech?.role === 'admin' || (req as any).user?.role === 'admin' || req.headers['x-admin-token'];
      if (!isEqat && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Apenas o Administrador Geral e a EQAT têm permissão para reservar ou retirar padrões para Calibração ou Empréstimo.'
        });
      }
    }

    let targetDate = reserved_date || new Date().toISOString().slice(0, 10);

    if (appointment_id) {
      const appt = appointmentForReservation;

      if (!appt) {
        return res.status(404).json({ success: false, error: 'Atendimento não encontrado.' });
      }

      if (isNonTechnicalAppointment(appt)) {
        return res.status(400).json({
          success: false,
          error: 'Agendamentos não técnicos (Sobreaviso, Exame Periódico, Aniversário, Revisão, Treinamento, etc.) não permitem reserva de padrões.'
        });
      }
      targetDate = appt.appointment_date || targetDate;
    }

    const { data: analyzer } = await supabaseAdmin
      .from('analyzers')
      .select('*')
      .eq('id', Number(analyzer_id))
      .maybeSingle();

    if (!analyzer) {
      return res.status(404).json({ success: false, error: 'Analisador não encontrado.' });
    }

    // A escolha do padrão cria a reserva imediatamente, inclusive para
    // agendas provisórias. Seleções repetidas para o mesmo atendimento são
    // idempotentes para evitar duas reservas do mesmo patrimônio.
    if (appointment_id) {
      const { data: alreadyReserved } = await supabaseAdmin
        .from('reservations')
        .select('id, status')
        .eq('appointment_id', Number(appointment_id))
        .eq('analyzer_id', Number(analyzer_id))
        .in('status', ['Reservado', 'Em Uso', 'Aguardando Aprovação'])
        .maybeSingle();
      if (alreadyReserved) {
        const expired = analyzer.calibration_expiry && String(analyzer.calibration_expiry).slice(0, 10) < new Date().toISOString().slice(0, 10);
        return res.json({
          success: true,
          reservationId: alreadyReserved.id,
          asset_tag: analyzer.asset_tag,
          status: alreadyReserved.status,
          alreadyReserved: true,
          calibration_warning: Boolean(expired),
          message: 'Este padrão já está reservado para o atendimento.'
        });
      }
    }

    const blockedAnalyzerStatus = /reservado|em uso|emprest|manuten|indispon|baixado/i.test(analyzer.status || '');
    if (blockedAnalyzerStatus) {
      return res.status(409).json({ success: false, error: `O patrimônio ${analyzer.asset_tag} está com status “${analyzer.status}” e não pode ser reservado agora.` });
    }
    const calibrationExpired = Boolean(analyzer.calibration_expiry && String(analyzer.calibration_expiry).slice(0, 10) < new Date().toISOString().slice(0, 10));

    // REGRA DE APROVAÇÃO:
    // Se a EQAT solicitar Calibração/Empréstimo, fica 'Aguardando Aprovação' até o Administrador aprovar.
    // Se for Chamado ou Atendimento, entra como 'Reservado' ou 'Em Uso' (se direct_checkout).
    // Se o Administrador criar, entra aprovado.
    const isCreatedByAdmin = req.headers['x-admin-token'] || (req as any).user?.role === 'admin' || tech?.role === 'admin';
    const isEqat = tech?.name?.trim().toUpperCase() === 'EQAT';

    let initialStatus = 'Reservado';
    let approvedBy = null;
    let approvedAt = null;

    if (isSpecialOp && isEqat && !isCreatedByAdmin) {
      initialStatus = 'Aguardando Aprovação';
    } else if (isSpecialOp && isCreatedByAdmin) {
      approvedBy = 'Administrador Geral';
      approvedAt = new Date().toISOString();
      if (direct_checkout) {
        initialStatus = 'Em Uso';
      }
    } else if (isChamado && direct_checkout) {
      initialStatus = 'Em Uso';
    }

    // Se for saída imediata, verificar se outro técnico está usando no momento
    if (initialStatus === 'Em Uso') {
      const { data: activeUsage } = await supabaseAdmin
        .from('reservations')
        .select('id, technician_id, technicians(name)')
        .eq('analyzer_id', Number(analyzer_id))
        .eq('status', 'Em Uso')
        .maybeSingle();

      if (activeUsage) {
        const activeTechName = (activeUsage as any)?.technicians?.name || 'outro técnico';
        return res.status(400).json({
          success: false,
          error: `Não é possível retirar este padrão agora pois ele ainda está em campo com ${activeTechName}. Aguarde a devolução para realizar a saída.`
        });
      }
    }

    // Checagem de conflito para a data
    if (targetDate) {
      let conflictQuery = supabaseAdmin
        .from('reservations')
        .select('id')
        .eq('analyzer_id', Number(analyzer_id))
        .eq('reserved_date', targetDate)
        .in('status', ['Reservado', 'Em Uso', 'Aguardando Aprovação']);

      if (appointment_id) {
        conflictQuery = conflictQuery.neq('appointment_id', Number(appointment_id));
      }

      const { data: existingConflict } = await conflictQuery.maybeSingle();

      if (existingConflict) {
        return res.status(400).json({
          success: false,
          error: `O Patrimônio ${analyzer.asset_tag} (${analyzer.name}) já possui reserva/solicitação nesta data.`
        });
      }
    }

    const { data: newRes, error: insertErr } = await supabaseAdmin
      .from('reservations')
      .insert({
        appointment_id: appointment_id ? Number(appointment_id) : null,
        analyzer_id: Number(analyzer_id),
        technician_id: effectiveTechnicianId,
        reserved_date: targetDate,
        operation_type: operation_type || 'Atendimento',
        status: initialStatus,
        approved_by: approvedBy,
        approved_at: approvedAt,
        checkout_at: initialStatus === 'Em Uso' ? new Date().toISOString() : null,
        checkin_at: null,
        notes: notes || (
          operation_type === 'Calibração' ? 'Saída/Reserva para Calibração de Padrão' :
          operation_type === 'Empréstimo' ? 'Empréstimo de equipamento' :
          operation_type === 'Chamado' ? 'Chamado Técnico Espontâneo' :
          'Reserva efetuada pelo sistema'
        )
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    if (initialStatus === 'Em Uso') {
      await supabaseAdmin.from('analyzers').update({ status: 'Em Uso' }).eq('id', Number(analyzer_id));
    } else if (initialStatus === 'Reservado' && analyzer.status !== 'Em Uso') {
      await supabaseAdmin.from('analyzers').update({ status: 'Reservado' }).eq('id', Number(analyzer_id));
    }

    let successMsg = `Reserva do Patrimônio ${analyzer.asset_tag} realizada com sucesso!`;
    if (initialStatus === 'Aguardando Aprovação') {
      successMsg = `Solicitação de ${operation_type} do Patrimônio ${analyzer.asset_tag} registrada! Aguarde a aprovação do Administrador Geral para retirar o padrão.`;
    } else if (initialStatus === 'Em Uso') {
      successMsg = `Saída de ${operation_type} do Patrimônio ${analyzer.asset_tag} registrada com sucesso!`;
    }

    res.json({
      success: true,
      reservationId: newRes.id,
      asset_tag: analyzer.asset_tag,
      status: initialStatus,
      calibration_warning: calibrationExpired,
      calibration_message: calibrationExpired ? 'Calibração/certificado vencido. A reserva foi criada, mas confirme a condição do padrão antes da retirada.' : undefined,
      message: successMsg
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// APROVAÇÃO DE SAÍDA PELO ADMINISTRADOR
router.post('/reservations/:id/approve', async (req: Request, res: Response) => {
  try {
    const resId = Number(req.params.id);

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('id', resId)
      .maybeSingle();

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'Solicitação não encontrada.' });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update({
        status: 'Reservado',
        approved_by: 'Administrador Geral',
        approved_at: new Date().toISOString()
      })
      .eq('id', resId);

    if (updateErr) throw updateErr;

    if (reservation.analyzer_id) {
      const { data: currentAnalyzer } = await supabaseAdmin
        .from('analyzers')
        .select('status')
        .eq('id', reservation.analyzer_id)
        .maybeSingle();

      if (currentAnalyzer && currentAnalyzer.status !== 'Em Uso') {
        await supabaseAdmin
          .from('analyzers')
          .update({ status: 'Reservado' })
          .eq('id', reservation.analyzer_id);
      }
    }

    res.json({ success: true, message: 'Solicitação aprovada pelo Administrador! Saída liberada para retirada.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reservations/:id/checkout', requireAuthentication, requireRole(['admin', 'manager', 'supervisor', 'technician']), async (req: Request, res: Response) => {
  try {
    const resId = Number(req.params.id);

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('id', resId)
      .maybeSingle();

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'Reserva não encontrada.' });
    }

    if (!reservation.analyzer_id) {
      return res.status(400).json({ success: false, error: 'Reserva sem padrão associado.' });
    }

    if (reservation.status === 'Aguardando Aprovação') {
      return res.status(403).json({ success: false, error: 'Esta saída ainda aguarda aprovação do Administrador Geral.' });
    }

    if (reservation.status !== 'Reservado') {
      return res.status(409).json({ success: false, error: `A reserva está em “${reservation.status}” e não pode ser retirada novamente.` });
    }

    const actor = (req as any).user;
    if (actor.role === 'technician' && Number(actor.sub) !== Number(reservation.technician_id)) {
      return res.status(403).json({ success: false, error: 'Somente o técnico responsável pela reserva pode retirar este padrão.' });
    }
    const { data: linkedAppointment, error: linkedAppointmentError } = reservation.appointment_id
      ? await supabaseAdmin.from('appointments').select('workflow_status').eq('id', reservation.appointment_id).maybeSingle()
      : { data: null, error: null };
    if (linkedAppointmentError) throw linkedAppointmentError;

    // REGRA DE OURO: Verificar se o analisador está fisicamente com outro técnico neste momento ('Em Uso')
    const { data: activeUsage } = await supabaseAdmin
      .from('reservations')
      .select('id, technician_id')
      .eq('analyzer_id', reservation.analyzer_id)
      .eq('status', 'Em Uso')
      .neq('id', resId)
      .maybeSingle();

    if (activeUsage) {
      const { data: activeTech } = await supabaseAdmin
        .from('technicians')
        .select('name')
        .eq('id', Number(activeUsage.technician_id))
        .maybeSingle();

      const techName = activeTech?.name || 'outro técnico';
      return res.status(400).json({
        success: false,
        error: `Não é possível retirar este padrão agora pois ele ainda está em campo com ${techName}. Aguarde a devolução para realizar a saída.`
      });
    }

    const { data: checkedOut, error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'Em Uso', checkout_at: new Date().toISOString() })
      .eq('id', resId)
      .eq('status', 'Reservado')
      .select('id')
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!checkedOut) return res.status(409).json({ success: false, error: 'Esta reserva já mudou. Atualize os dados antes de retirar.' });

    await supabaseAdmin
      .from('analyzers')
      .update({ status: 'Em Uso' })
      .eq('id', reservation.analyzer_id);

    const { data: workflowAfter, error: workflowAfterError } = linkedAppointment?.workflow_status === 'Confirmado com cliente'
      ? await supabaseAdmin.from('appointments').select('workflow_status').eq('id', reservation.appointment_id).maybeSingle()
      : { data: null, error: null };
    if (workflowAfterError) console.error('[Workflow] Falha ao confirmar a etapa após retirada:', workflowAfterError.message);
    const workflowStarted = workflowAfter?.workflow_status === 'Em execução';
    res.json({ success: true, workflow_started: workflowStarted, message: workflowStarted ? 'Padrão retirado. Atendimento em execução.' : 'Check-out de retirada registrado com sucesso!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reservations/:id/checkin', async (req: Request, res: Response) => {
  try {
    const resId = Number(req.params.id);

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('*')
      .eq('id', resId)
      .maybeSingle();

    if (!reservation) {
      return res.status(404).json({ success: false, error: 'Reserva não encontrada.' });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'Devolvido', checkin_at: new Date().toISOString() })
      .eq('id', resId);

    if (updateErr) throw updateErr;

    if (reservation.analyzer_id) {
      // Verificar se há outra reserva em posse ativa ('Em Uso')
      const { data: otherInUse } = await supabaseAdmin
        .from('reservations')
        .select('id')
        .eq('analyzer_id', reservation.analyzer_id)
        .eq('status', 'Em Uso')
        .neq('id', resId)
        .maybeSingle();

      if (!otherInUse) {
        await supabaseAdmin
          .from('analyzers')
          .update({ status: 'Disponível' })
          .eq('id', reservation.analyzer_id);
      }
    }

    res.json({ success: true, message: 'Check-in de devolução concluído. Patrimônio liberado!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/reservations/:id', async (req: Request, res: Response) => {
  try {
    const resId = Number(req.params.id);
    const { technician_id, reserved_date, status, analyzer_id, appointment_id, notes } = req.body;

    const updates: Record<string, any> = {};
    if (technician_id !== undefined) updates.technician_id = technician_id;
    if (reserved_date !== undefined) updates.reserved_date = reserved_date;
    if (status !== undefined) updates.status = status;
    if (analyzer_id !== undefined) updates.analyzer_id = analyzer_id;
    if (appointment_id !== undefined) updates.appointment_id = appointment_id;
    if (notes !== undefined) updates.notes = notes;

    const { data: updatedRes, error: updateErr } = await supabaseAdmin
      .from('reservations')
      .update(updates as any)
      .eq('id', resId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // Atualiza status do analisador se o status da reserva foi alterado
    if (status && updatedRes.analyzer_id) {
      if (status === 'Devolvido' || status === 'Cancelado') {
        await supabaseAdmin.from('analyzers').update({ status: 'Disponível' }).eq('id', updatedRes.analyzer_id);
      } else if (status === 'Em Uso') {
        await supabaseAdmin.from('analyzers').update({ status: 'Em Uso' }).eq('id', updatedRes.analyzer_id);
      } else if (status === 'Reservado') {
        await supabaseAdmin.from('analyzers').update({ status: 'Reservado' }).eq('id', updatedRes.analyzer_id);
      }
    }

    res.json({ success: true, reservation: updatedRes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/reservations/:id', async (req: Request, res: Response) => {
  try {
    const resId = Number(req.params.id);

    const { data: resData } = await supabaseAdmin
      .from('reservations')
      .select('analyzer_id, status')
      .eq('id', resId)
      .maybeSingle();

    const { error: delErr } = await supabaseAdmin
      .from('reservations')
      .delete()
      .eq('id', resId);

    if (delErr) throw delErr;

    if (resData?.analyzer_id) {
      // Verifica se o analisador possui alguma outra reserva ativa antes de liberar
      const { data: otherActive } = await supabaseAdmin
        .from('reservations')
        .select('id')
        .eq('analyzer_id', resData.analyzer_id)
        .in('status', ['Reservado', 'Em Uso'])
        .maybeSingle();

      if (!otherActive) {
        await supabaseAdmin
          .from('analyzers')
          .update({ status: 'Disponível' })
          .eq('id', resData.analyzer_id);
      }
    }

    res.json({ success: true, message: 'Reserva excluída e analisador liberado no banco de dados.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/auth/admin-login', async (req: Request, res: Response) => {
  try {
    const { pin, password } = req.body;
    const input = String(pin || password || '').trim();

    // Consultar PIN do Administrador dinamicamente no banco de dados
    const { data: adminCred } = await supabaseAdmin
      .from('app_credentials')
      .select('pin')
      .eq('username', 'admin')
      .maybeSingle();

    const developmentFallbackPins = process.env.NODE_ENV === 'production'
      ? []
      : ['3247', '6233', 'atem2026', 'admin'];
    const validPins = [adminCred?.pin, ...developmentFallbackPins].filter(Boolean);
    const isValid = validPins.some(p => CryptoService.timingSafeCompare(input, p!));

    if (isValid) {
      const user = {
        id: 0,
        name: 'Administrador Master',
        role: 'admin' as const,
        email: 'admin@atem.com.br'
      };

      const token = AuthService.generateSessionToken(user, '12h');

      return res.json({
        success: true,
        token,
        user
      });
    }

    res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique os dados informados.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao processar autenticação.' });
  }
});

router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { type, pin, password, technician_id } = req.body;
    const inputPin = String(pin || password || '').trim();

    // 1. Login de Administrador
    if (type === 'admin') {
      const { data: adminCred } = await supabaseAdmin
        .from('app_credentials')
        .select('pin')
        .eq('username', 'admin')
        .maybeSingle();

      const developmentFallbackPins = process.env.NODE_ENV === 'production'
        ? []
        : ['3247', '6233', 'atem2026', 'admin'];
      const validAdminPins = [adminCred?.pin, ...developmentFallbackPins].filter(Boolean);
      const isValid = validAdminPins.some(p => CryptoService.timingSafeCompare(inputPin, p!));

      if (isValid) {
        const user = {
          id: 0,
          name: 'Administrador Master',
          role: 'admin' as const,
          email: 'admin@atem.com.br',
          avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=250&q=80'
        };

        const token = AuthService.generateSessionToken(user, '12h');

        return res.json({
          success: true,
          token,
          user
        });
      }
      return res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique os dados informados.' });
    }

    // 2. Login de Técnico Individual
    if (type === 'technician') {
      const techId = Number(technician_id);
      if (!techId) {
        return res.status(400).json({ success: false, error: 'Selecione o técnico para entrar.' });
      }

      const { data: technician, error: techErr } = await supabaseAdmin
        .from('technicians')
        .select('*')
        .eq('id', techId)
        .maybeSingle();

      if (techErr || !technician || String(technician.status || '').toLowerCase() !== 'ativo') {
        // Neutralização de enumeração de usuário por timing
        await AuthService.verifyUserCredentials(inputPin, null);
        return res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique os dados informados.' });
      }

      // Em produção, aceite somente o PIN cadastrado ou os últimos quatro
      // dígitos do telefone. Os atalhos abaixo existem apenas para o ambiente
      // local legado e não devem ser usados em uma implantação pública.
      const last4Phone = technician.phone ? String(technician.phone).replace(/\D/g, '').slice(-4) : '';
      const developmentFallbackPins = process.env.NODE_ENV === 'production'
        ? []
        : ['3247', '1234', '6233', '0000', 'atem'];
      const validTechPins = [technician.pin, ...developmentFallbackPins, last4Phone].filter(Boolean);

      const isValid = validTechPins.some(p => CryptoService.timingSafeCompare(inputPin, p!))
        || (process.env.NODE_ENV !== 'production' && !inputPin && process.env.ALLOW_EMPTY_TECH_PIN === 'true');

      if (isValid) {
        const user = {
          id: technician.id,
          name: technician.name,
          role: roleFromSpecialty(technician.role),
          phone: technician.phone,
          email: technician.email,
          avatar_url: technician.avatar_url
        };

        const token = AuthService.generateSessionToken(user, '12h');

        return res.json({
          success: true,
          token,
          user
        });
      }

      return res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique os dados informados.' });
    }

    res.status(400).json({ success: false, error: 'Tipo de login inválido.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao processar autenticação.' });
  }
});

// ==========================================================================
// GERENCIADOR DE CREDENCIAIS E PINS (DATABASE CRUD)
// ==========================================================================
router.get('/auth/session', requireAuthentication, (req: Request, res: Response) => {
  const payload = (req as any).user;
  res.json({ success: true, user: { id: payload.sub, name: payload.name, role: payload.role } });
});

router.get('/credentials', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_credentials')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json({ success: true, credentials: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/credentials', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { display_name, username, pin, role, user_type } = req.body;
    if (!display_name || !pin) {
      return res.status(400).json({ success: false, error: 'Nome e PIN são obrigatórios.' });
    }

    const cleanPin = String(pin).trim();
    const cleanUser = username ? String(username).trim().toLowerCase() : `user_${Date.now()}`;
    const cleanType = user_type || role || 'technician';

    let techId: number | null = null;
    if (cleanType === 'technician' || role === 'technician') {
      const { data: tech, error: techErr } = await supabaseAdmin
        .from('technicians')
        .insert({
          name: display_name,
          role: 'Técnico de Campo',
          status: 'Ativo',
          pin: cleanPin
        })
        .select('id')
        .single();
      if (!techErr && tech) {
        techId = tech.id;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('app_credentials')
      .insert({
        user_type: cleanType,
        technician_id: techId,
        username: cleanUser,
        display_name,
        pin: cleanPin,
        role: role || cleanType,
        status: 'Ativo'
      })
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, credential: data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/credentials/:id', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const credId = Number(req.params.id);
    const { pin, display_name, role, status } = req.body;
    const updates: any = { updated_at: new Date().toISOString() };
    if (pin !== undefined) updates.pin = String(pin).trim();
    if (display_name !== undefined) updates.display_name = String(display_name).trim();
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;

    const { data: updated, error } = await supabaseAdmin
      .from('app_credentials')
      .update(updates)
      .eq('id', credId)
      .select('*')
      .single();

    if (error) throw error;

    // Se for técnico, sincronizar também na tabela technicians
    if (updated.technician_id) {
      const techUpdates: any = {};
      if (pin !== undefined) techUpdates.pin = String(pin).trim();
      if (display_name !== undefined) techUpdates.name = String(display_name).trim();
      if (status !== undefined) techUpdates.status = status;

      if (Object.keys(techUpdates).length > 0) {
        await supabaseAdmin
          .from('technicians')
          .update(techUpdates)
          .eq('id', updated.technician_id);
      }
    }

    res.json({ success: true, credential: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/credentials/:id', requireAuthentication, requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const credId = Number(req.params.id);
    const { data: cred } = await supabaseAdmin
      .from('app_credentials')
      .select('*')
      .eq('id', credId)
      .maybeSingle();

    if (cred && cred.username === 'admin') {
      return res.status(400).json({ success: false, error: 'O Administrador Master não pode ser excluído.' });
    }

    const { error } = await supabaseAdmin
      .from('app_credentials')
      .delete()
      .eq('id', credId);

    if (error) throw error;
    res.json({ success: true, message: 'Credencial excluída com sucesso.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. PORTAL INDIVIDUAL DO TÉCNICO
// ==========================================
function technicianPortalAccessToken(req: Request) {
  const authorization = req.get('authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function technicianPortalError(res: Response, error: unknown) {
  if (error instanceof TechnicianPortalAuthError) {
    return res.status(error.statusCode).json({ success: false, error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ success: false, error: message });
}

router.get('/technicians/:id/portal-link', async (req: Request, res: Response) => {
  try {
    const technicianId = parsePositiveId(req.params.id);
    if (!technicianId) return res.status(400).json({ success: false, error: 'ID do técnico inválido.' });
    const { data: technician, error } = await supabaseAdmin
      .from('technicians')
      .select('id, name, phone, status')
      .eq('id', technicianId)
      .maybeSingle();
    if (error) throw error;
    if (!technician) return res.status(404).json({ success: false, error: 'Técnico não encontrado.' });
    if (technician.status !== 'Ativo') return res.status(409).json({ success: false, error: 'Ative o técnico antes de gerar o acesso.' });
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      technician,
      portal_url: createTechnicianPortalUrl(technician.id),
      expires_in_hours: Number(process.env.TECHNICIAN_PORTAL_LINK_TTL_HOURS || 72)
    });
  } catch (error) {
    technicianPortalError(res, error);
  }
});

router.get('/technician-portal', async (req: Request, res: Response) => {
  try {
    const technician = await resolveTechnicianPortalTechnician(technicianPortalAccessToken(req));
    const dashboard = await getTechnicianPortalData(technician, Number(req.query.days || 45));
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...dashboard });
  } catch (error) {
    technicianPortalError(res, error);
  }
});

router.post('/technician-portal/reservations', async (req: Request, res: Response) => {
  try {
    const technician = await resolveTechnicianPortalTechnician(technicianPortalAccessToken(req));
    const result = await reserveAnalyzerFromTechnicianPortal(
      technician,
      Number(req.body.appointment_id),
      Number(req.body.analyzer_id)
    );
    res.set('Cache-Control', 'no-store');
    res.status(result.alreadyReserved ? 200 : 201).json({
      success: true,
      ...result,
      message: result.alreadyReserved
        ? `O patrimônio ${result.assetTag} já estava reservado para este atendimento.`
        : `Patrimônio ${result.assetTag} reservado com sucesso.`
    });
  } catch (error) {
    technicianPortalError(res, error);
  }
});

router.post('/technician-portal/reservations/:id/checkin', async (req: Request, res: Response) => {
  try {
    const technician = await resolveTechnicianPortalTechnician(technicianPortalAccessToken(req));
    const result = await returnAnalyzerFromTechnicianPortal(technician, Number(req.params.id));
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      ...result,
      message: result.alreadyReturned
        ? 'Este patrimônio já havia sido devolvido.'
        : 'Devolução registrada. O patrimônio foi liberado.'
    });
  } catch (error) {
    technicianPortalError(res, error);
  }
});

router.post('/technician-portal/reservations/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const technician = await resolveTechnicianPortalTechnician(technicianPortalAccessToken(req));
    const result = await rescheduleAnalyzerFromTechnicianPortal(
      technician,
      Number(req.params.id),
      Number(req.body.appointment_id)
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      ...result,
      message: result.alreadyScheduled
        ? `O patrimônio ${result.assetTag} já está vinculado a este atendimento.`
        : `Patrimônio ${result.assetTag} reagendado sem devolução.`
    });
  } catch (error) {
    technicianPortalError(res, error);
  }
});

router.get('/notifications/logs', async (req: Request, res: Response) => {
  try {
    const { data: logs, error } = await supabaseAdmin
      .from('notification_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(20);

    if (error) throw error;

    let techMap = new Map();
    if (logs && logs.length > 0) {
      const techIds = Array.from(new Set(logs.map(n => n.technician_id).filter((id): id is number => id !== null)));
      if (techIds.length > 0) {
        const { data: techs } = await supabaseAdmin
          .from('technicians')
          .select('id, name, phone')
          .in('id', techIds);
        techMap = new Map((techs || []).map(t => [t.id, t]));
      }
    }

    const enriched = (logs || []).map(n => {
      const tech = n.technician_id ? techMap.get(n.technician_id) : null;
      return {
        ...n,
        technician_name: tech ? tech.name : 'N/A',
        technician_phone: tech ? tech.phone : 'N/A'
      };
    });

    res.json({ success: true, logs: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
