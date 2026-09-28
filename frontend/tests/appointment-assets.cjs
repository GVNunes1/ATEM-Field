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
      await context.addInitScript(() => {
        localStorage.setItem('atem.auth.user', JSON.stringify({ id: 4, name: 'Ana Técnica', role: 'technician' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
        localStorage.setItem('atem_agenda_view_mode', 'spreadsheet');
      });
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: { id: 4, name: 'Ana Técnica', role: 'technician' } } });
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
          if (url.pathname === '/api/fleet/vehicles/11/checkout') return route.fulfill({ status: 201, json: { success: true, usage: { id: 51 } } });
        }
        if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { success: false } });
        if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments: [appointment] } });
        if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians: [{ id: 4, name: 'Ana Técnica', role: 'Técnico de Campo', status: 'Ativo' }] } });
        if (url.pathname === '/api/analyzers') return route.fulfill({ json: { success: true, analyzers: [{ id: 31, asset_tag: 'QA-31', name: 'Simulador', status: 'Disponível' }] } });
        if (url.pathname === '/api/fleet/vehicles') return route.fulfill({ json: { success: true, vehicles: [{ id: 11, name: 'Carro 11', plate: 'ABC-1234', status: 'Disponível' }] } });
        return route.fulfill({ json: { success: true, stats: {}, recentReservations: [], categories: [] } });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/agenda`);
      await page.getByLabel('Selecionar mês').fill('2026-09');
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
      await page.locator(selector).filter({ hasText: 'Hospital Central' }).first().click();
      const unassignedDialog = page.getByRole('dialog', { name: 'Hospital Central' });
      await unassignedDialog.getByRole('button', { name: 'Registrar retirada do carro' }).waitFor();
      assert.equal(await unassignedDialog.getByRole('button', { name: 'Reservar padrão' }).count(), 0);
      console.log(`PASS appointment assets ${width}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
