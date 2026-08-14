const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const backendDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendDir, '.env') });

const badIds = Array.from({ length: 38 }, (_, index) => index + 83);
const applyChanges = process.argv.includes('--apply');
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em backend/.env.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function requireResult(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data || [];
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function loadAudit() {
  const technicians = requireResult(
    await supabase.from('technicians').select('*').in('id', badIds).order('id'),
    'Leitura dos técnicos inválidos'
  );
  const primaryAppointments = requireResult(
    await supabase.from('appointments').select('*').in('technician_id', badIds).order('id'),
    'Leitura dos atendimentos principais'
  );
  const badLinks = requireResult(
    await supabase.from('appointment_technicians').select('*').in('technician_id', badIds),
    'Leitura dos vínculos de atendimentos'
  );
  const reservations = requireResult(
    await supabase.from('reservations').select('*').in('technician_id', badIds),
    'Leitura das reservas'
  );
  const notificationLogs = requireResult(
    await supabase.from('notification_logs').select('*').in('technician_id', badIds),
    'Leitura dos logs de notificação'
  );

  const appointmentIds = [...new Set([
    ...primaryAppointments.map(row => row.id),
    ...badLinks.map(row => row.appointment_id)
  ])];
  const allAppointmentLinks = appointmentIds.length
    ? requireResult(
      await supabase.from('appointment_technicians').select('*').in('appointment_id', appointmentIds),
      'Leitura de todos os vínculos afetados'
    )
    : [];

  return {
    technicians,
    primaryAppointments,
    badLinks,
    reservations,
    notificationLogs,
    appointmentIds,
    allAppointmentLinks
  };
}

async function rebuildAffectedAppointments(audit) {
  const badIdSet = new Set(badIds);
  const remainingLinks = audit.allAppointmentLinks.filter(link => !badIdSet.has(link.technician_id));
  const remainingTechnicianIds = [...new Set(remainingLinks.map(link => link.technician_id))];
  const remainingTechnicians = remainingTechnicianIds.length
    ? requireResult(
      await supabase.from('technicians').select('id, name').in('id', remainingTechnicianIds),
      'Leitura dos técnicos válidos restantes'
    )
    : [];
  const nameById = new Map(remainingTechnicians.map(row => [row.id, row.name]));

  for (const appointmentId of audit.appointmentIds) {
    const ids = remainingLinks
      .filter(link => link.appointment_id === appointmentId)
      .map(link => link.technician_id);
    const names = ids.map(id => nameById.get(id)).filter(Boolean);
    const result = await supabase
      .from('appointments')
      .update({
        technician_id: ids[0] || null,
        technician_names: names.length ? names.join(', ') : 'Equipe de Campo'
      })
      .eq('id', appointmentId);
    requireResult(result, `Reconstrução do atendimento ${appointmentId}`);
  }
}

function cleanupLocalDatabase() {
  const dbPath = path.join(backendDir, 'data', 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const badIdSet = new Set(badIds);
  const validTechnicians = (db.technicians || []).filter(row => !badIdSet.has(row.id));
  const validNameById = new Map(validTechnicians.map(row => [row.id, row.name]));

  const appointments = (db.appointments || []).map(appointment => {
    const existingIds = Array.isArray(appointment.technician_ids)
      ? appointment.technician_ids
      : (appointment.technician_id ? [appointment.technician_id] : []);
    const validIds = [...new Set(existingIds.filter(id => !badIdSet.has(id) && validNameById.has(id)))];
    const hadInvalidReference = existingIds.some(id => badIdSet.has(id));

    if (!hadInvalidReference) return appointment;

    return {
      ...appointment,
      technician_id: validIds[0] || null,
      technician_ids: validIds,
      technician_names: validIds.length
        ? validIds.map(id => validNameById.get(id)).join(', ')
        : 'Equipe de Campo'
    };
  });

  fs.writeFileSync(dbPath, `${JSON.stringify({ ...db, technicians: validTechnicians, appointments }, null, 2)}\n`);
  return { before: (db.technicians || []).length, after: validTechnicians.length };
}

async function main() {
  const audit = await loadAudit();
  const summary = {
    mode: applyChanges ? 'apply' : 'dry-run',
    techniciansToDelete: audit.technicians.length,
    affectedAppointments: audit.appointmentIds.length,
    appointmentLinksToDelete: audit.badLinks.length,
    reservations: audit.reservations.length,
    notificationLogs: audit.notificationLogs.length
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!applyChanges) {
    console.log('Nenhuma alteração realizada. Execute novamente com --apply para confirmar.');
    return;
  }

  if (audit.reservations.length || audit.notificationLogs.length) {
    throw new Error('Limpeza interrompida: existem reservas ou notificações que exigem revisão manual.');
  }

  if (!audit.technicians.length) {
    console.log('Os técnicos inválidos já foram removidos; nenhuma alteração necessária.');
    return;
  }

  const backupDir = path.join(backendDir, 'data', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const localDb = JSON.parse(fs.readFileSync(path.join(backendDir, 'data', 'db.json'), 'utf8'));
  const localBadIdSet = new Set(badIds);
  const backup = {
    createdAt: new Date().toISOString(),
    reason: 'Remoção dos cadastros inválidos derivados de convites do Microsoft Teams',
    remote: audit,
    local: {
      technicians: (localDb.technicians || []).filter(row => localBadIdSet.has(row.id)),
      appointments: (localDb.appointments || []).filter(row => {
        const ids = Array.isArray(row.technician_ids) ? row.technician_ids : [row.technician_id];
        return ids.some(id => localBadIdSet.has(id));
      })
    }
  };
  const backupPath = path.join(backupDir, `technician-cleanup-${timestamp()}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

  requireResult(
    await supabase.from('appointment_technicians').delete().in('technician_id', badIds),
    'Exclusão dos vínculos inválidos'
  );
  requireResult(
    await supabase.from('appointments').update({ technician_id: null }).in('technician_id', badIds),
    'Remoção das referências principais inválidas'
  );
  requireResult(
    await supabase.from('technicians').delete().in('id', badIds),
    'Exclusão dos técnicos inválidos'
  );
  await rebuildAffectedAppointments(audit);

  const local = cleanupLocalDatabase();
  const verification = await loadAudit();
  if (verification.technicians.length || verification.badLinks.length || verification.primaryAppointments.length) {
    throw new Error('A verificação final encontrou referências inválidas remanescentes.');
  }

  console.log(JSON.stringify({
    success: true,
    deleted: audit.technicians.length,
    rebuiltAppointments: audit.appointmentIds.length,
    local,
    backupPath
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
