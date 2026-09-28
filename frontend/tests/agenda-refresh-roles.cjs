const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Agenda role fixture requires a local Vite server.');
const date = new Date().toLocaleDateString('sv-SE');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const role of ['technician', 'commercial', 'supervisor', 'manager']) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
      const user = { id: 4, name: `Usuário ${role}`, role };
      const appointments = [{ id: 901, client_name: 'Hospital Inicial', appointment_date: date, appointment_time: '08:00', technician_ids: [4], technician_names: user.name, status: 'Agendado', workflow_status: 'Confirmado com cliente', reservations: [] }];
      let authenticatedAgendaReads = 0;
      await context.addInitScript(({ user }) => {
        localStorage.setItem('atem.auth.user', JSON.stringify(user));
        localStorage.setItem('atem.auth.token', 'role-fixture-token');
      }, { user });
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { success: false } });
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user } });
        if (url.pathname === '/api/appointments') {
          assert.equal(request.headers().authorization, 'Bearer role-fixture-token');
          authenticatedAgendaReads++;
          return route.fulfill({ json: { success: true, appointments } });
        }
        if (url.pathname === '/api/sync/google/status') {
          assert.equal(request.headers().authorization, 'Bearer role-fixture-token');
          return route.fulfill({ json: { success: true, authenticated: true, write_authorized: true, bidirectional: true, pending: 0, conflicts: 0, errors: 0 } });
        }
        return route.fulfill({ json: { success: true, technicians: [{ id: 4, name: user.name, role: 'Técnico de Campo', status: 'Ativo' }], analyzers: [], categories: [], reservations: [], stats: {}, recentReservations: [] } });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/agenda`);
      await page.getByText('Google Agenda · duas vias').waitFor();
      await page.getByText('Hospital Inicial').first().waitFor();
      const canCreate = await page.getByRole('button', { name: 'Novo Atendimento' }).count();
      assert.equal(canCreate, role === 'technician' ? 0 : 1, `${role} creation permission remains unchanged`);
      appointments.push({ ...appointments[0], id: 902, client_name: 'Hospital Atualizado' });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByText('Hospital Atualizado').first().waitFor();
      assert.ok(authenticatedAgendaReads >= 2, `${role} refreshed appointments without an admin session`);
      console.log(`PASS agenda refresh ${role}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
