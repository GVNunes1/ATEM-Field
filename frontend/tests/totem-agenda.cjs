const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Totem fixture requires a local Vite server.');
const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const technicians = [
  { id: 2, name: 'Beatriz Técnica', role: 'Técnico de Campo', status: 'Ativo' },
  { id: 3, name: 'Carlos Técnico', role: 'Técnico de Campo', status: 'Ativo' }
];
const appointments = [
  { id: 701, client_name: 'Hospital Alfa', appointment_date: future, appointment_time: '08:00', technician_ids: [2], technician_names: '', status: 'Agendado', client_address: 'Rua Central, 25' },
  { id: 702, client_name: 'Hospital de Carlos', appointment_date: future, appointment_time: '09:00', technician_ids: [3], technician_names: '', status: 'Agendado' }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
    let logins = 0;
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/auth/login') {
        logins++;
        assert.deepEqual(request.postDataJSON(), { type: 'technician', technician_id: 2, pin: '2468' });
        return route.fulfill({ json: { success: true, token: 'totem-fixture-token', user: { id: 2, name: 'Beatriz Técnica', role: 'technician' } } });
      }
      if (url.pathname === '/api/appointments' && request.headers().authorization !== 'Bearer totem-fixture-token') {
        return route.fulfill({ status: 401, json: { success: false, error: 'Autenticação necessária.' } });
      }
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: { id: 2, name: 'Beatriz Técnica', role: 'technician' } } });
      if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments } });
      if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians } });
      if (url.pathname === '/api/reservations') return route.fulfill({ json: { success: true, reservations: [] } });
      return route.fulfill({ json: { success: true, analyzers: [], categories: [], stats: {}, recentReservations: [] } });
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/totem`);
    await page.locator('.tablet-tech-card').filter({ hasText: 'Beatriz Técnica' }).click();
    for (const digit of '2468') await page.getByRole('dialog', { name: 'PIN do técnico' }).getByRole('button', { name: digit, exact: true }).click();
    await page.getByRole('dialog', { name: 'PIN do técnico' }).getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByText('Hospital Alfa').waitFor();
    assert.equal(logins, 1, 'Totem authenticates through the backend');
    assert.equal(await page.getByText('Hospital de Carlos').count(), 0, 'Only the selected technician’s appointments appear');
    await page.getByText('Rua Central, 25').waitFor();
    appointments.push({ id: 703, client_name: 'Hospital Novo', appointment_date: future, appointment_time: '14:00', technician_ids: [2], technician_names: '', status: 'Agendado' });
    await page.getByTitle('Atualizar').click();
    await page.getByText('Hospital Novo').waitFor();
    console.log('PASS totem agenda authentication, team IDs and refresh');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
