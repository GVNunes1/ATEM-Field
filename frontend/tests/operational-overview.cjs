const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Use somente o servidor local.');
const appointmentDate = new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE');
const appointment = {
  id: 501, title: 'Preventiva', client_name: 'Hospital de teste',
  client_address: 'Rua A, 100', appointment_date: appointmentDate,
  appointment_time: '08:00', workflow_status: 'Confirmado com cliente',
  status: 'Agendado', technician_id: 4, technician_ids: [4],
  technician_names: 'Ana Técnica', vehicle_id: 3, reservations: []
};
const readiness = {
  appointment_id: 501, state: 'attention', missing: ['Padrões reservados'],
  checks: [
    { key: 'client', label: 'Cliente confirmou', ok: true, detail: 'Confirmado' },
    { key: 'pattern', label: 'Padrões reservados', ok: false, detail: 'Nenhum padrão reservado' }
  ]
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      let writes = 0;
      const errors = [];
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        localStorage.setItem('atem.auth.user', JSON.stringify({ id: 0, name: 'Administrador', role: 'admin' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
      });
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 403, json: { success: false } }); }
        if (url.pathname.endsWith('/operational-insights')) return route.fulfill({ json: {
          success: true, available: true, readiness: [readiness],
          alerts: [{ id: '501:pattern', appointment_id: 501, severity: 'warning', kind: 'pattern', message: 'Nenhum padrão reservado' }]
        } });
        if (url.pathname.endsWith('/timeline')) return route.fulfill({ json: { success: true, events: [
          { id: 1, event_type: 'workflow', actor_name: 'Lia Supervisora', occurred_at: new Date().toISOString(),
            details: { from: 'Validado pelo supervisor', to: 'Confirmado com cliente', assignee_name: 'Ana Técnica' } }
        ] } });
        if (url.pathname.endsWith('/readiness')) return route.fulfill({ json: { success: true, readiness } });
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: { id: 0, name: 'Administrador', role: 'admin' } } });
        if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments: [appointment] } });
        if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians: [{ id: 4, name: 'Ana Técnica', role: 'Técnico de Campo', status: 'Ativo' }] } });
        if (url.pathname === '/api/analyzers') return route.fulfill({ json: { success: true, analyzers: [] } });
        if (url.pathname === '/api/fleet/vehicles') return route.fulfill({ json: { success: true, vehicles: [] } });
        if (url.pathname === '/api/dashboard/stats') return route.fulfill({ json: { success: true, stats: {}, recentReservations: [] } });
        return route.fulfill({ json: { success: true, categories: [], appointments: [], technicians: [], analyzers: [] } });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.getByRole('heading', { name: 'Prontidão e exceções' }).waitFor();
      const alert = page.getByRole('button', { name: /Hospital de teste · Nenhum padrão reservado/ });
      await alert.click();
      await page.getByRole('heading', { name: 'Pronto para sair' }).waitFor();
      await page.getByText(/Lia Supervisora/).waitFor();
      assert.equal(await page.getByText('Lia Supervisora').count(), 1);
      assert.equal(await page.getByText('Nenhum padrão reservado').count() > 0, true);
      const overflow = await page.locator('.month-dialog').evaluate(element => element.scrollWidth - element.clientWidth);
      assert.ok(overflow <= 2, `dialog overflow at ${viewport.width}px: ${overflow}`);
      assert.equal(writes, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS operational overview ${viewport.width}x${viewport.height}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
