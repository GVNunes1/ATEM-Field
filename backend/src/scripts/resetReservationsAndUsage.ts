import { supabaseAdmin } from '../services/supabase';

async function resetAllReservationsAndUsage() {
  console.log('🔄 Iniciando limpeza e reset total de reservas e status dos analisadores...');

  // 1. Limpar tabela de reservas
  const { error: resErr, count: resCount } = await (supabaseAdmin as any)
    .from('reservations')
    .delete()
    .neq('id', 0); // deleta todas as linhas

  if (resErr) {
    console.error('❌ Erro ao limpar tabela reservations:', resErr);
  } else {
    console.log('✅ Tabela reservations zerada com sucesso.');
  }

  // 2. Resetar status dos analisadores para 'Disponível'
  const { data: updatedAnalyzers, error: anErr } = await (supabaseAdmin as any)
    .from('analyzers')
    .update({ status: 'Disponível' })
    .neq('status', 'Em Manutenção')
    .select('id, asset_tag, name, status');

  if (anErr) {
    console.error('❌ Erro ao atualizar status dos analisadores:', anErr);
  } else {
    console.log(`✅ ${updatedAnalyzers?.length || 0} analisadores redefinidos para o status "Disponível".`);
  }

  // 3. Verificar estado final
  const { data: allAnalyzers } = await supabaseAdmin.from('analyzers').select('id, asset_tag, name, status');
  const { data: remainingReservations } = await supabaseAdmin.from('reservations').select('id');

  console.log('\n📊 ESTADO ATUAL DO SISTEMA:');
  console.log(`- Reservas ativas no banco: ${remainingReservations?.length || 0}`);
  console.log(`- Total de analisadores: ${allAnalyzers?.length || 0}`);
  console.log(`- Analisadores disponíveis: ${allAnalyzers?.filter(a => a.status === 'Disponível').length || 0}`);
  console.log(`- Analisadores em manutenção: ${allAnalyzers?.filter(a => a.status === 'Em Manutenção').length || 0}`);
}

resetAllReservationsAndUsage()
  .then(() => {
    console.log('\n✨ Operação de reset concluída com sucesso!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Falha no reset:', err);
    process.exit(1);
  });
