const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Appointment asset fixtures require a local Vite server.');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const appointment = { id: 901, title: 'Visita técnica', client_name: 'Hospital Central', client_address: 'Rua A, 100', appointment_date: '2026-09-28', appointment_time: '08:00', appointment_end_date: '2026-09-28', appointment_end_time: '17:00', workflow_status: 'Confirmado com cliente', technician_id: 4, technician_ids: [4], technician_names: 'Ana Técnica', vehicle_id: 11, reservations: [] };
      const requests = [];
      let authUser = { id: 4, name: 'Ana Técnica', role: 'technician' };
      let fleetActiveUsage = null;
      await context.addInitScript(() => {
        if (!localStorage.getItem('atem.auth.user')) localStorage.setItem('atem.auth.user', JSON.stringify({ id: 4, name: 'Ana Técnica', role: 'technician' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
        localStorage.setItem('atem_agenda_view_mode', 'spreadsheet');
      });
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: authUser } });
        if (request.method() === 'PATCH' && url.pathname === '/api/appointments/901/workflow') {
          const body = request.postDataJSON();
          requests.push({ path: url.pathname, body });
          appointment.vehicle_id = body.vehicle_id;
          return route.fulfill({ json: { success: true, appointment } });
        }
        if (request.method() === 'POST') {
          const body = request.postDataJSON();
          requests.push({ path: url.pathname, body });
          if (url.pathname === '/api/reservations') {
            // The agenda GET can lag behind a successful reservation POST.
            return route.fulfill({ json: { success: true, reservationId: 77, message: 'Reservado' } });
          }
          if (url.pathname === '/api/reservations/77/checkout') {
            appointment.reservations.push({ id: 77, analyzer_id: 31, technician_id: 4, status: 'Em Uso', asset_tag: 'QA-31', analyzer_name: 'Simulador' });
            appointment.workflow_status = 'Em execução';
            return route.fulfill({ json: { success: true, workflow_started: true, message: 'Padrão retirado. Atendimento em execução.' } });
          }
          if (url.pathname === '/api/reservations/78/checkout') return route.fulfill({ json: { success: true, message: 'Retirada pela equipe registrada.' } });
          if (url.pathname === '/api/fleet/vehicles/11/checkout') return route.fulfill({ status: 201, json: { success: true, usage: { id: 51 } } });
        }
        if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { success: false } });
        if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments: [appointment] } });
        if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians: [{ id: 4, name: 'Ana Técnica', role: 'Técnico de Campo', status: 'Ativo' }, { id: 8, name: 'Bruno Técnico', role: 'Técnico de Campo', status: 'Ativo' }] } });
        if (url.pathname === '/api/analyzers') return route.fulfill({ json: { success: true, analyzers: [{ id: 31, asset_tag: 'QA-31', name: 'Simulador', status: 'Disponível' }] } });
        if (url.pathname === '/api/fleet/vehicles') return route.fulfill({ json: { success: true, vehicles: [{ id: 11, name: 'Carro 11', plate: 'ABC-1234', status: fleetActiveUsage ? 'Em Uso' : 'Disponível', active_usage: fleetActiveUsage }], usage: fleetActiveUsage ? [fleetActiveUsage] : [] } });
        if (url.pathname === '/api/fleet/history' && url.searchParams.get('offset') === '100') return route.fulfill({ json: { success: true, has_more: false, movements: [
          { id: 'usage-2', kind: 'usage', vehicle_id: 11, vehicle_name: 'Carro 11', plate: 'ABC-1234', appointment_id: 901, client_name: 'Hospital Central', responsible_name: 'Ana Técnica', status: 'Cancelado', occurred_at: '2026-09-27T11:00:00Z', checkout_at: '2026-09-27T11:00:00Z', km_initial: 11900 }
        ] } });
        if (url.pathname === '/api/fleet/history') return route.fulfill({ json: { success: true, has_more: true, movements: [
          { id: 'reservation-1', kind: 'reservation', vehicle_id: 11, vehicle_name: 'Carro 11', plate: 'ABC-1234', appointment_id: 901, client_name: 'Hospital Central', responsible_name: 'Gerente', status: 'Reserva cancelada', occurred_at: '2026-09-28T10:00:00Z' },
          { id: 'usage-1', kind: 'usage', vehicle_id: 11, vehicle_name: 'Carro 11', plate: 'ABC-1234', appointment_id: 901, client_name: 'Hospital Central', responsible_name: 'Bruno Técnico', returned_by_name: 'Supervisor', status: 'Devolvido', occurred_at: '2026-09-28T11:00:00Z', checkout_at: '2026-09-28T11:00:00Z', checkin_at: '2026-09-28T14:00:00Z', km_initial: 12000, km_final: 12042 }
        ] } });
        if (url.pathname === '/api/reservations') return route.fulfill({ json: { success: true, reservations: [] } });
        return route.fulfill({ json: { success: true, stats: {}, recentReservations: [], categories: [] } });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/agenda`);
      await page.getByLabel('Selecionar mês').fill('2026-09');
      if (width < 960) await page.locator('.month-cell[data-date="2026-09-28"] .month-date').click();
      const selector = width < 960 ? '.month-calendar__mobile-agenda .month-day-event' : '.framework-event';
      await page.locator(selector).filter({ hasText: 'Hospital Central' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Hospital Central' });
      await dialog.getByLabel('Padrão disponível').selectOption('31');
      await dialog.getByRole('button', { name: 'Reservar padrão' }).click();
      await dialog.getByText('QA-31 · Simulador').waitFor();
      await dialog.getByRole('button', { name: 'Registrar retirada', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Registrar retirada', exact: true }).click();
      await dialog.getByText('Padrão retirado. Atendimento em execução.').waitFor();
      await dialog.getByRole('button', { name: 'Registrar retirada do carro' }).click();
      await dialog.getByLabel('KM atual').fill('12345.6');
      await dialog.getByLabel('Foto do hodômetro').setInputFiles({ name: 'hodometro.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64') });
      await dialog.getByRole('button', { name: 'Confirmar retirada' }).click();
      await dialog.getByText('Carro retirado e associado a este atendimento.').waitFor();
      assert.equal(requests.length, 3);
      assert.deepEqual(requests.map(item => item.path), ['/api/reservations', '/api/reservations/77/checkout', '/api/fleet/vehicles/11/checkout']);
      assert.equal(requests[0].body.appointment_id, 901);
      assert.equal(requests[0].body.technician_id, 4);
      assert.equal(requests[2].body.appointment_id, 901);
      assert.equal(requests[2].body.km_initial, 12345.6);
      assert.ok(requests[2].body.odometer_photo_data.startsWith('data:image/png;base64,'));
      appointment.technician_id = 8;
      appointment.technician_ids = [8];
      await page.reload();
      await page.getByLabel('Selecionar mês').fill('2026-09');
      if (width < 960) await page.locator('.month-cell[data-date="2026-09-28"] .month-date').click();
      await page.locator(selector).filter({ hasText: 'Hospital Central' }).first().click();
      const unassignedDialog = page.getByRole('dialog', { name: 'Hospital Central' });
      await unassignedDialog.getByRole('button', { name: 'Registrar retirada do carro' }).waitFor();
      assert.equal(await unassignedDialog.getByRole('button', { name: 'Reservar padrão' }).count(), 0);
      appointment.vehicle_id = null;
      authUser = { id: 99, name: 'Gerente', role: 'manager' };
      await page.evaluate(() => localStorage.setItem('atem.auth.user', JSON.stringify({ id: 99, name: 'Gerente', role: 'manager' })));
      await page.reload();
      await page.getByLabel('Selecionar mês').fill('2026-09');
      if (width < 960) await page.locator('.month-cell[data-date="2026-09-28"] .month-date').click();
      await page.locator(selector).filter({ hasText: 'Hospital Central' }).first().click();
      const managerDialog = page.getByRole('dialog', { name: 'Hospital Central' });
      await managerDialog.getByLabel('Carro disponível').selectOption('11');
      await managerDialog.getByRole('button', { name: 'Reservar carro' }).click();
      await managerDialog.getByText('Carro reservado para a equipe deste atendimento.').waitFor();
      assert.equal(requests.at(-1).path, '/api/appointments/901/workflow');
      assert.deepEqual(requests.at(-1).body, { vehicle_id: 11 });
      await managerDialog.getByRole('button', { name: 'Cancelar reserva do carro' }).click();
      await managerDialog.getByRole('button', { name: 'Confirmar cancelamento' }).click();
      await managerDialog.getByText('Reserva do carro cancelada. O atendimento permanece agendado.').waitFor();
      assert.deepEqual(requests.at(-1).body, { vehicle_id: null });
      assert.equal(appointment.vehicle_id, null);
      appointment.technician_ids = [4, 8];
      appointment.reservations.push({ id: 78, analyzer_id: 32, technician_id: 4, status: 'Reservado', asset_tag: 'QA-32', analyzer_name: 'Segundo padrão' });
      authUser = { id: 8, name: 'Bruno Técnico', role: 'technician' };
      await page.evaluate(() => localStorage.setItem('atem.auth.user', JSON.stringify({ id: 8, name: 'Bruno Técnico', role: 'technician' })));
      await page.reload();
      await page.getByLabel('Selecionar mês').fill('2026-09');
      if (width < 960) await page.locator('.month-cell[data-date="2026-09-28"] .month-date').click();
      await page.locator(selector).filter({ hasText: 'Hospital Central' }).first().click();
      const teammateDialog = page.getByRole('dialog', { name: 'Hospital Central' });
      await teammateDialog.locator('li').filter({ hasText: 'QA-32' }).getByRole('button', { name: 'Registrar retirada' }).click();
      await teammateDialog.getByText('Retirada pela equipe registrada.').waitFor();
      assert.equal(requests.at(-1).path, '/api/reservations/78/checkout');
      await page.goto(`${baseUrl}/historico`);
      await page.getByRole('tab', { name: 'Frota' }).click();
      await page.getByRole('heading', { name: 'Histórico da frota' }).waitFor();
      await page.getByRole('table').getByText('Reserva cancelada', { exact: true }).waitFor();
      await page.getByText('12.000 / 12.042').waitFor();
      await page.getByRole('button', { name: 'Carregar mais movimentações' }).click();
      await page.getByRole('table').getByText('Cancelado', { exact: true }).waitFor();
      fleetActiveUsage = { id: 52, vehicle_id: 11, withdrawn_by_user_id: '4', withdrawn_by_name: 'Ana Técnica', status: 'Em Uso', checkout_inspection: { actor_role: 'technician' }, km_initial: 12000, checkout_at: '2026-09-28T11:00:00Z' };
      await page.goto(`${baseUrl}/frota`);
      await page.getByText('Em uso por').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Registrar devolução' }).count(), 0);
      authUser = { id: 99, name: 'Gerente', role: 'manager' };
      await page.evaluate(() => localStorage.setItem('atem.auth.user', JSON.stringify({ id: 99, name: 'Gerente', role: 'manager' })));
      await page.reload();
      await page.getByRole('button', { name: 'Registrar devolução' }).waitFor();
      fleetActiveUsage = { ...fleetActiveUsage, withdrawn_by_user_id: '99', withdrawn_by_name: 'Gerente', checkout_inspection: { actor_role: 'manager' } };
      authUser = { id: 100, name: 'Administrador', role: 'admin' };
      await page.evaluate(() => localStorage.setItem('atem.auth.user', JSON.stringify({ id: 100, name: 'Administrador', role: 'admin' })));
      await page.reload();
      await page.getByRole('button', { name: 'Registrar devolução' }).waitFor();
      console.log(`PASS appointment assets ${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
