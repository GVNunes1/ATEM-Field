const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const sourceIds = (process.argv[2] || '')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(id => Number.isInteger(id) && id > 0);
const targetId = Number(process.argv[3]);
const finalName = (process.argv.slice(4).join(' ') || '').trim();

if (!sourceIds.length || !Number.isInteger(targetId) || targetId <= 0 || !finalName) {
  throw new Error('Uso: node scripts/merge-technicians-local.js <origens> <destino> <nome final>');
}
if (sourceIds.includes(targetId)) {
  throw new Error('O destino não pode estar na lista de origens.');
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized && normalized !== 'pendente' && !normalized.startsWith('pendente ('));
}

const dbPath = path.join(backendDir, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const target = (db.technicians || []).find(row => row.id === targetId);
const sources = (db.technicians || []).filter(row => sourceIds.includes(row.id));

if (!target) throw new Error(`Técnico final ${targetId} não encontrado no banco local.`);
if (sources.length !== sourceIds.length) {
  throw new Error(`Esperadas ${sourceIds.length} origens, encontradas ${sources.length}.`);
}

const chooseValue = field => {
  if (hasValue(target[field])) return target[field];
  const source = sources.find(row => hasValue(row[field]));
  return source ? source[field] : (target[field] ?? sources[0]?.[field] ?? null);
};
const mergedTarget = {
  ...target,
  name: finalName,
  phone: chooseValue('phone'),
  telegram_id: chooseValue('telegram_id'),
  email: chooseValue('email'),
  role: chooseValue('role') || 'Técnico de Campo',
  avatar_url: chooseValue('avatar_url') || target.avatar_url,
  status: target.status === 'Inativo' && sources.some(row => row.status !== 'Inativo') ? 'Ativo' : target.status
};

const sourceIdSet = new Set(sourceIds);
const technicians = (db.technicians || [])
  .filter(row => !sourceIdSet.has(row.id))
  .map(row => row.id === targetId ? mergedTarget : row);
const nameById = new Map(technicians.map(row => [row.id, row.name]));
let affectedAppointments = 0;

const appointments = (db.appointments || []).map(appointment => {
  const existingIds = Array.isArray(appointment.technician_ids)
    ? appointment.technician_ids
    : (appointment.technician_id ? [appointment.technician_id] : []);
  const hasSource = existingIds.some(id => sourceIdSet.has(id)) || sourceIdSet.has(appointment.technician_id);
  if (!hasSource) return appointment;

  affectedAppointments++;
  const mergedIds = [...new Set(existingIds.map(id => sourceIdSet.has(id) ? targetId : id))]
    .filter(id => nameById.has(id));
  if (!mergedIds.includes(targetId)) mergedIds.push(targetId);
  const primaryId = sourceIdSet.has(appointment.technician_id)
    ? targetId
    : (appointment.technician_id || mergedIds[0] || null);

  return {
    ...appointment,
    technician_id: primaryId,
    technician_ids: mergedIds,
    technician_names: mergedIds.length
      ? mergedIds.map(id => nameById.get(id)).join(', ')
      : 'Equipe de Campo'
  };
});

const reservations = (db.reservations || []).map(row => sourceIdSet.has(row.technician_id)
  ? { ...row, technician_id: targetId }
  : row);
const notificationLogs = (db.notification_logs || []).map(row => sourceIdSet.has(row.technician_id)
  ? { ...row, technician_id: targetId }
  : row);

fs.writeFileSync(dbPath, `${JSON.stringify({
  ...db,
  technicians,
  appointments,
  reservations,
  notification_logs: notificationLogs
}, null, 2)}\n`);

console.log(JSON.stringify({
  success: true,
  merged: sourceIds,
  target: { id: targetId, name: finalName },
  affectedAppointments,
  technicianCount: technicians.length
}, null, 2));
