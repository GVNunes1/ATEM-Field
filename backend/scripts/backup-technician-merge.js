const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const backendDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendDir, '.env') });

const technicianIds = (process.argv[2] || '')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(id => Number.isInteger(id) && id > 0);

if (technicianIds.length < 2) {
  throw new Error('Informe ao menos dois IDs separados por vírgula. Ex.: node scripts/backup-technician-merge.js 45,60,82');
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em backend/.env.');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function requireResult(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data || [];
}

async function selectInBatches(table, column, ids, select = '*') {
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) {
    batches.push(ids.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map(batch => supabase.from(table).select(select).in(column, batch)));
  return results.flatMap((result, index) => requireResult(result, `Leitura em lote ${index + 1} de ${table}`));
}

async function main() {
  const technicians = requireResult(
    await supabase.from('technicians').select('*').in('id', technicianIds).order('id'),
    'Leitura dos técnicos'
  );
  if (technicians.length !== technicianIds.length) {
    throw new Error(`Esperados ${technicianIds.length} técnicos, encontrados ${technicians.length}.`);
  }

  const primaryAppointments = requireResult(
    await supabase.from('appointments').select('*').in('technician_id', technicianIds),
    'Leitura dos atendimentos principais'
  );
  const appointmentLinks = requireResult(
    await supabase.from('appointment_technicians').select('*').in('technician_id', technicianIds),
    'Leitura dos vínculos de atendimentos'
  );
  const affectedAppointmentIds = [...new Set([
    ...primaryAppointments.map(row => row.id),
    ...appointmentLinks.map(row => row.appointment_id)
  ])];
  const appointments = affectedAppointmentIds.length
    ? await selectInBatches('appointments', 'id', affectedAppointmentIds)
    : [];
  const reservations = requireResult(
    await supabase.from('reservations').select('*').in('technician_id', technicianIds),
    'Leitura das reservas'
  );
  const notificationLogs = requireResult(
    await supabase.from('notification_logs').select('*').in('technician_id', technicianIds),
    'Leitura das notificações'
  );

  const dbPath = path.join(backendDir, 'data', 'db.json');
  const localDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const idSet = new Set(technicianIds);
  const localAppointments = (localDb.appointments || []).filter(row => {
    const ids = Array.isArray(row.technician_ids) ? row.technician_ids : [row.technician_id];
    return ids.some(id => idSet.has(id));
  });

  const backup = {
    createdAt: new Date().toISOString(),
    reason: 'Backup anterior à mescla manual de técnicos',
    technicianIds,
    remote: { technicians, appointments, appointmentLinks, reservations, notificationLogs },
    local: {
      technicians: (localDb.technicians || []).filter(row => idSet.has(row.id)),
      appointments: localAppointments,
      reservations: (localDb.reservations || []).filter(row => idSet.has(row.technician_id)),
      notificationLogs: (localDb.notification_logs || []).filter(row => idSet.has(row.technician_id))
    }
  };

  const backupDir = path.join(backendDir, 'data', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `technician-merge-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify(backup, null, 2)}\n`);

  console.log(JSON.stringify({
    success: true,
    backupPath,
    technicians: technicians.map(({ id, name }) => ({ id, name })),
    affectedAppointments: affectedAppointmentIds.length,
    reservations: reservations.length,
    notificationLogs: notificationLogs.length
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
