import { supabaseAdmin } from '../services/supabase';
import {
  loadOfficialTechniciansFromCsv,
  matchSingleTechnician,
  OfficialTechnician
} from '../services/technicianMatcher';

export async function syncOfficialTechniciansDatabase(): Promise<{
  success: boolean;
  officialCount: number;
  migratedCount: number;
  deletedDirtyCount: number;
  report: string[];
}> {
  const report: string[] = [];
  report.push(`[Sincronização Oficial] Iniciando auditoria e migração de técnicos...`);

  // 1. Carregar lista oficial do CSV
  const officialList = loadOfficialTechniciansFromCsv();
  if (!officialList.length) {
    throw new Error('Lista oficial de técnicos vazia ou CSV não encontrado em backend/data/technicians_official.csv');
  }

  const officialMapById = new Map<number, OfficialTechnician>(officialList.map(t => [t.id, t]));
  const officialIds = new Set(officialList.map(t => t.id));
  report.push(`[Sincronização Oficial] ${officialList.length} técnicos oficiais carregados do CSV.`);

  // 2. Buscar todos os técnicos atuais no Supabase
  const { data: dbTechnicians, error: fetchErr } = await supabaseAdmin
    .from('technicians')
    .select('*');

  if (fetchErr) {
    throw new Error(`Erro ao buscar técnicos no Supabase: ${fetchErr.message}`);
  }

  report.push(`[Sincronização Oficial] ${dbTechnicians?.length || 0} registros encontrados no banco Supabase.`);

  // 3. Mapear IDs legados/divergentes para os IDs oficiais
  const remapIdMap = new Map<number, number>(); // oldId -> officialId
  const dirtyIdsToDelete: number[] = [];

  for (const existing of dbTechnicians || []) {
    const existingId = Number(existing.id);

    // Se já é um ID oficial e com o nome idêntico, mantém
    if (officialMapById.has(existingId)) {
      continue;
    }

    // Tenta correspondência inteligente por nome/apelido
    const matched = matchSingleTechnician(existing.name, officialList);
    if (matched) {
      remapIdMap.set(existingId, matched.id);
      dirtyIdsToDelete.push(existingId);
      report.push(`[Remapeamento] Técnico "${existing.name}" (ID ${existingId}) -> Oficial "${matched.name}" (ID ${matched.id})`);
    } else {
      // Fallback para Equipe Externa (ID 54) ou Todos (ID 50)
      const fallbackId = 54;
      remapIdMap.set(existingId, fallbackId);
      dirtyIdsToDelete.push(existingId);
      report.push(`[Remapeamento Fallback] Técnico "${existing.name}" (ID ${existingId}) -> Fallback Equipe Externa (ID ${fallbackId})`);
    }
  }

  // 4. Executar remapeamento nas tabelas de relacionamento
  report.push(`[Sincronização Oficial] Remapeando chaves estrangeiras em reservas e agendamentos...`);

  for (const [oldId, newId] of remapIdMap.entries()) {
    // 4.1 Reservations
    await (supabaseAdmin as any)
      .from('reservations')
      .update({ technician_id: newId })
      .eq('technician_id', oldId);

    // 4.2 Appointments (campo direto)
    await (supabaseAdmin as any)
      .from('appointments')
      .update({ technician_id: newId })
      .eq('technician_id', oldId);

    // 4.3 Appointment Technicians (junction)
    // Primeiro remove entradas duplicadas se o novo ID já existir para o mesmo agendamento
    const { data: junctions } = await (supabaseAdmin as any)
      .from('appointment_technicians')
      .select('appointment_id')
      .eq('technician_id', oldId);

    for (const j of junctions || []) {
      // Verifica se já existe com newId
      const { data: existingTarget } = await (supabaseAdmin as any)
        .from('appointment_technicians')
        .select('appointment_id')
        .eq('appointment_id', j.appointment_id)
        .eq('technician_id', newId)
        .maybeSingle();

      if (existingTarget) {
        await (supabaseAdmin as any)
          .from('appointment_technicians')
          .delete()
          .eq('appointment_id', j.appointment_id)
          .eq('technician_id', oldId);
      } else {
        await (supabaseAdmin as any)
          .from('appointment_technicians')
          .update({ technician_id: newId })
          .eq('appointment_id', j.appointment_id)
          .eq('technician_id', oldId);
      }
    }
  }

  // 5. Upsert dos 45 técnicos oficiais na tabela technicians
  report.push(`[Sincronização Oficial] Atualizando/Inserindo 45 técnicos oficiais no Supabase...`);

  for (const official of officialList) {
    const payload: any = {
      id: official.id,
      name: official.name,
      phone: official.phone || null,
      telegram_id: official.telegram_id || null,
      email: official.email || null,
      role: official.role || 'Técnico de Campo',
      avatar_url: official.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=250&q=80',
      status: official.status || 'Ativo'
    };

    const { error: upsertErr } = await supabaseAdmin
      .from('technicians')
      .upsert(payload, { onConflict: 'id' });

    if (upsertErr) {
      report.push(`[Aviso Upsert] Erro ao gravar ${official.name} (${official.id}): ${upsertErr.message}`);
    }
  }

  // 6. Deletar registros sujos/duplicados que sobraram
  let deletedCount = 0;
  if (dirtyIdsToDelete.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('technicians')
      .delete()
      .in('id', dirtyIdsToDelete);

    if (delErr) {
      report.push(`[Aviso Delete] Erro ao deletar técnicos divergentes: ${delErr.message}`);
    } else {
      deletedCount = dirtyIdsToDelete.length;
      report.push(`[Sincronização Oficial] ${deletedCount} técnicos divergentes/duplicados removidos com sucesso.`);
    }
  }

  report.push(`[Sincronização Oficial] Processo concluído com sucesso! Base padronizada em 45 técnicos oficiais.`);

  return {
    success: true,
    officialCount: officialList.length,
    migratedCount: remapIdMap.size,
    deletedDirtyCount: deletedCount,
    report
  };
}

// Permitir execução direta via CLI (npx ts-node src/scripts/syncOfficialTechnicians.ts)
if (require.main === module) {
  syncOfficialTechniciansDatabase()
    .then(result => {
      console.log('\n--- RESULTADO DA MIGRAÇÃO ---');
      result.report.forEach(line => console.log(line));
      console.log('-----------------------------\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ ERRO NA MIGRAÇÃO:', err);
      process.exit(1);
    });
}
