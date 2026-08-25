const fs = require('fs');
const https = require('https');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('./supabase-env');

const config = getSupabaseConfig({ requireAccessToken: true });
const supabaseAdmin = createClient(config.url, config.serviceRoleKey);

function chunk(items, size = 200) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_value, index) => items.slice(index * size, (index + 1) * size));
}

async function upsertInChunks(table, records, onConflict) {
  for (const recordsChunk of chunk(records)) {
    const { error } = await supabaseAdmin.from(table).upsert(recordsChunk, { onConflict });
    if (error) throw new Error(`Could not migrate ${table}: ${error.message}`);
  }
  console.log(`✔ ${table}: ${records.length} records migrated`);
}

function runManagementSql(query) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      `https://api.supabase.com/v1/projects/${config.projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.accessToken}`
        }
      },
      (response) => {
        let body = '';
        response.on('data', (part) => { body += part; });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(body);
          else reject(new Error(`Supabase Management API returned ${response.statusCode}: ${body}`));
        });
      }
    );
    request.on('error', reject);
    request.end(JSON.stringify({ query }));
  });
}

async function resetIdentitySequences() {
  await runManagementSql(`
    SELECT setval(pg_get_serial_sequence('public.equipment_categories', 'id'), COALESCE((SELECT MAX(id) FROM public.equipment_categories), 1));
    SELECT setval(pg_get_serial_sequence('public.test_templates', 'id'), COALESCE((SELECT MAX(id) FROM public.test_templates), 1));
    SELECT setval(pg_get_serial_sequence('public.technicians', 'id'), COALESCE((SELECT MAX(id) FROM public.technicians), 1));
    SELECT setval(pg_get_serial_sequence('public.analyzers', 'id'), COALESCE((SELECT MAX(id) FROM public.analyzers), 1));
    SELECT setval(pg_get_serial_sequence('public.appointments', 'id'), COALESCE((SELECT MAX(id) FROM public.appointments), 1));
    SELECT setval(pg_get_serial_sequence('public.appointment_equipments', 'id'), COALESCE((SELECT MAX(id) FROM public.appointment_equipments), 1));
    SELECT setval(pg_get_serial_sequence('public.reservations', 'id'), COALESCE((SELECT MAX(id) FROM public.reservations), 1));
  `);
}

async function migrate() {
  const dbPath = path.resolve(__dirname, '../data/db.json');
  if (!fs.existsSync(dbPath)) throw new Error(`Data file not found: ${dbPath}`);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  const categoryMap = new Map((db.equipment_categories || []).map((item) => [item.id, item]));
  categoryMap.set(6, categoryMap.get(6) || { id: 6, name: 'Autoclave / Esterilização', description: 'Equipamentos de esterilização e autoclaves hospitalares' });
  categoryMap.set(7, categoryMap.get(7) || { id: 7, name: 'Bisturi Eletrônico', description: 'Unidades eletrocirúrgicas e geradores de radiofrequência' });
  await upsertInChunks('equipment_categories', [...categoryMap.values()], 'id');

  const templates = (db.test_templates || []).map((item) => ({
    id: item.id,
    category_id: item.category_id,
    name: item.analyzer_type || `Template ${item.id}`,
    analyzer_type: item.analyzer_type || '',
    description: item.description || null,
    required_parameters: typeof item.required_parameters === 'string' ? JSON.parse(item.required_parameters) : (item.required_parameters || []),
    is_mandatory: item.is_mandatory ?? 1
  }));
  await upsertInChunks('test_templates', templates, 'id');

  await upsertInChunks('technicians', (db.technicians || []).map((item) => ({
    id: item.id,
    name: item.name,
    phone: item.phone || 'Pendente (Cadastrar via Telegram)',
    telegram_id: item.telegram_id || null,
    email: item.email || 'Pendente',
    role: item.role || 'Técnico de Campo',
    status: item.status || 'Ativo',
    created_at: item.created_at || new Date().toISOString()
  })), 'id');

  await upsertInChunks('analyzers', (db.analyzers || []).map((item) => ({
    id: item.id,
    asset_tag: item.asset_tag,
    name: item.name,
    type: item.type || null,
    serial_number: item.serial_number || null,
    brand_model: item.brand_model || null,
    calibration_date: item.calibration_date || null,
    calibration_expiry: item.calibration_expiry || null,
    status: item.status || 'Disponível',
    current_location: item.current_location || 'Almoxarifado Central',
    notes: item.notes || ''
  })), 'id');

  await upsertInChunks('appointments', (db.appointments || []).map((item) => ({
    id: item.id,
    external_id: item.external_id || null,
    title: item.title,
    client_name: item.client_name || null,
    client_address: item.client_address || null,
    client_contact: item.client_contact || 'Sincronizado da Agenda Online',
    appointment_date: item.appointment_date || null,
    appointment_time: item.appointment_time || '08:00',
    status: item.status || 'Agendado',
    technician_names: item.technician_names || 'Equipe de Campo',
    technician_id: item.technician_id || null,
    created_at: item.created_at || new Date().toISOString()
  })), 'id');

  await upsertInChunks('appointment_equipments', (db.appointment_equipments || []).map((item) => ({
    id: item.id,
    appointment_id: item.appointment_id,
    category_id: item.category_id || null,
    model: item.model || null,
    serial_number: item.serial_number || null,
    tag: item.tag || null,
    sector: item.sector || 'Assistência Técnica'
  })), 'id');

  const appointmentTechnicians = [];
  const uniqueLinks = new Set();
  for (const appointment of db.appointments || []) {
    for (const technicianId of appointment.technician_ids || []) {
      const key = `${appointment.id}:${technicianId}`;
      if (technicianId != null && !uniqueLinks.has(key)) {
        uniqueLinks.add(key);
        appointmentTechnicians.push({ appointment_id: appointment.id, technician_id: technicianId });
      }
    }
  }
  await upsertInChunks('appointment_technicians', appointmentTechnicians, 'appointment_id,technician_id');

  await resetIdentitySequences();
  console.log('✔ Identity sequences reset');
}

migrate().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
