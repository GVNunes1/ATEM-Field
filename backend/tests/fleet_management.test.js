const { apiFetch, getSupabaseClient, assert, assertEqual, assertNotNull, ensureServerRunning, stopServer } = require('./helpers');

async function runFleetTests() {
  console.log('\n--- Testes de Gestão e Checklist da Frota ---');
  const client = getSupabaseClient();

  // 1. Criar ou obter veículo para teste
  const testPlate = `TST${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: testVehicle, error: vehicleErr } = await client.from('fleet_vehicles').insert({
    name: 'Viatura E2E Checklist',
    plate: testPlate,
    brand_model: 'Duster Tech 2026',
    status: 'Disponível',
    current_km: 25000,
    notes: 'Veículo criado para testes automatizados'
  }).select('*').single();

  if (vehicleErr) throw new Error(`Falha ao criar veículo de teste: ${vehicleErr.message}`);
  const vehicleId = testVehicle.id;

  try {
    // 2. Retirada com novos campos do checklist
    console.log('1. Testando Retirada com novo checklist...');
    const checkoutRes = await apiFetch(`/api/fleet/vehicles/${vehicleId}/checkout`, {
      method: 'POST',
      body: {
        km_initial: 25010,
        usage_type: 'Empresa (Trabalho e deslocamento residência)',
        cleanliness_ok: true,
        revision_status: 'Em dia',
        fluids_checked: true,
        notes: 'Saída para atendimento em campo'
      }
    });

    assertEqual(checkoutRes.status, 201, `Checkout status esperado 201, obtido ${checkoutRes.status}`);
    assert(checkoutRes.data.success === true, 'Checkout deve retornar success: true');
    const usage = checkoutRes.data.usage;
    assertNotNull(usage, 'Uso criado não pode ser nulo');
    assertEqual(usage.checkout_inspection.usage_type, 'Empresa (Trabalho e deslocamento residência)');
    assertEqual(usage.checkout_inspection.cleanliness_ok, true);
    assertEqual(usage.checkout_inspection.revision_status, 'Em dia');
    assertEqual(usage.checkout_inspection.fluids_checked, true);
    console.log('   ✔ Retirada com novo checklist concluída com sucesso.');

    // 3. Gestão: Reatribuir responsável (tirar do nome de usuário)
    console.log('2. Testando Reatribuição de Responsável por Gestão...');
    const reassignRes = await apiFetch(`/api/fleet/usage/${usage.id}/reassign`, {
      method: 'PATCH',
      body: {
        new_user_id: '999',
        new_user_name: 'Técnico Reatribuído Gestão'
      }
    });
    assertEqual(reassignRes.status, 200, `Reassign status esperado 200, obtido ${reassignRes.status}`);
    assertEqual(reassignRes.data.usage.withdrawn_by_name, 'Técnico Reatribuído Gestão');
    console.log('   ✔ Responsável reatribuído com sucesso para "Técnico Reatribuído Gestão".');

    // 4. Devolução com novas avarias relatadas - Validação da regra de Não-Bloqueio
    console.log('3. Testando Devolução com avaria e regra de não-bloqueio do veículo...');
    const checkinRes = await apiFetch(`/api/fleet/usage/${usage.id}/checkin`, {
      method: 'POST',
      body: {
        km_final: 25150,
        has_new_damage: true,
        damage_description: 'Riscos na lateral direita',
        fuel_checked: true,
        tires_calibrated: true,
        notes: 'Devolvido após missão com chuva'
      }
    });
    assertEqual(checkinRes.status, 200, `Checkin status esperado 200, obtido ${checkinRes.status}`);
    assert(checkinRes.data.success === true, 'Checkin deve retornar success: true');

    // Verificar se o veículo NÃO TRAVOU (status permanece "Disponível")
    const { data: vehicleAfterReturn } = await client.from('fleet_vehicles').select('*').eq('id', vehicleId).single();
    assertEqual(vehicleAfterReturn.status, 'Disponível', `O veículo deve permanecer "Disponível", obtido "${vehicleAfterReturn.status}"`);
    console.log('   ✔ Regra de não travamento validada: Veículo permaneceu "Disponível" mesmo com avarias.');

    // 5. Nova Retirada para verificar que o veículo não está bloqueado
    console.log('4. Testando nova Retirada imediata após devolução com avaria...');
    const secondCheckoutRes = await apiFetch(`/api/fleet/vehicles/${vehicleId}/checkout`, {
      method: 'POST',
      body: {
        km_initial: 25150,
        usage_type: 'Particular',
        cleanliness_ok: true,
        revision_status: 'Próxima',
        fluids_checked: true,
        notes: 'Segunda saída'
      }
    });
    assertEqual(secondCheckoutRes.status, 201, `Segunda retirada esperada 201, obtida ${secondCheckoutRes.status}`);
    const secondUsage = secondCheckoutRes.data.usage;
    console.log('   ✔ Nova retirada autorizada sem bloqueios por avarias anteriores.');

    // 6. Gestão: Cancelar retirada ativa
    console.log('5. Testando Cancelamento de Retirada por Gestão...');
    const cancelRes = await apiFetch(`/api/fleet/usage/${secondUsage.id}/cancel`, {
      method: 'POST',
      body: { reason: 'Saída abortada pela supervisão' }
    });
    assertEqual(cancelRes.status, 200, `Cancel status esperado 200, obtido ${cancelRes.status}`);
    assertEqual(cancelRes.data.usage.status, 'Cancelado');

    const { data: vehicleAfterCancel } = await client.from('fleet_vehicles').select('status').eq('id', vehicleId).single();
    assertEqual(vehicleAfterCancel.status, 'Disponível', `Após cancelamento, veículo deve voltar para "Disponível", obtido "${vehicleAfterCancel.status}"`);
    console.log('   ✔ Retirada cancelada com sucesso e veículo liberado imediatamente.');

    console.log('\n✅ TODOS OS TESTES DA FROTA PASSARAM COM SUCESSO!\n');
  } finally {
    // Cleanup
    await client.from('fleet_usage').delete().eq('vehicle_id', vehicleId);
    await client.from('fleet_vehicles').delete().eq('id', vehicleId);
  }
}

if (require.main === module) {
  (async () => {
    let server = null;
    try {
      server = await ensureServerRunning();
      await runFleetTests();
    } catch (err) {
      console.error('❌ Erro no teste de frota:', err);
      process.exitCode = 1;
    } finally {
      if (server) await stopServer();
    }
  })();
}

module.exports = { runFleetTests };
