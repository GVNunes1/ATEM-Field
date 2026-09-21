const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Calendar fixtures require a local Vite server.');
const outputDir = path.join(__dirname, '..', 'test-results', 'calendar-sync');
fs.mkdirSync(outputDir, { recursive: true });
const today = new Date().toLocaleDateString('sv-SE');
const nextDay = new Date(`${today}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const tomorrow = nextDay.toISOString().slice(0, 10);
const technicians = [{ id: 1, name: 'Técnica de teste', status: 'Ativo' }, { id: 2, name: 'Técnico de apoio', status: 'Ativo' }];
const baseAppointment = {
  id: 201, external_id: 'google-fixture', google_calendar_id: 'isolated', google_event_id: 'event-fixture',
  title: 'Manutenção preventiva', client_name: 'Cliente de teste', client_address: 'Unidade de teste',
  appointment_date: today, appointment_time: '09:00', appointment_end_date: today, appointment_end_time: '10:00', all_day: false,
  status: 'Agendado', workflow_status: 'Data provisória', technician_ids: [1], technician_names: technicians[0].name,
  google_sync_status: 'synced', google_sync_revision: 3, calendar_writable: true, reservations: []
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let checks = 0;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      let appointment = { ...baseAppointment };
      let mode = 'reject';
      let writeAuthorized = true;
      const writes = [];
      const unexpectedRequests = [];
      const errors = [];
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
          if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) unexpectedRequests.push(request.url());
          return route.abort();
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') {
          const body = request.postDataJSON();
          writes.push({ path: url.pathname, body });
          if (url.pathname === '/api/appointments/201/calendar') {
            if (mode === 'reject') return route.fulfill({ status: 409, json: { success: false, error: 'O técnico está reservado para outro atendimento.' } });
            appointment = { ...appointment, ...body, google_sync_revision: 4, google_sync_status: 'pending' };
            return route.fulfill({ json: { success: true, appointment, sync_status: 'pending', message: 'Alterações salvas. Envio ao Google pendente.' } });
          }
          if (url.pathname === '/api/appointments/201/calendar/resolve') {
            appointment = { ...appointment, title: 'Título atualizado no Google', google_sync_status: 'synced', google_sync_conflict: null, google_sync_revision: 5 };
            return route.fulfill({ json: { success: true, appointment, sync_status: 'synced', message: 'Versão do Google aplicada.' } });
          }
          throw new Error(`Unexpected write: ${url.pathname}`);
        }
        if (url.pathname === '/api/sync/google/status') return route.fulfill({ json: { success: true, authenticated: true, write_authorized: writeAuthorized, bidirectional: true, pending: appointment.google_sync_status === 'pending' ? 1 : 0, conflicts: appointment.google_sync_status === 'conflict' ? 1 : 0, errors: 0 } });
        return route.fulfill({ json: { success: true, technicians, appointments: [appointment], categories: [], analyzers: [], reservations: [], stats: {}, recentReservations: [] } });
      });
      await context.addInitScript(() => {
        localStorage.setItem('atem.auth.user', JSON.stringify({ id: 1, name: 'Teste isolado', role: localStorage.getItem('fixture.role') || 'admin' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseUrl}/agenda`);
      const edit = page.getByRole('button', { name: 'Editar atendimento de Cliente de teste', exact: true });
      await edit.click();
      const dialog = page.getByRole('dialog', { name: 'Editar atendimento', exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.evaluate(el => el.parentElement.parentElement === document.body), true);
      assert.equal(await page.locator('#root').evaluate(el => el.inert), true);
      const rect = await dialog.boundingBox();
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, 'Dialog fits viewport');
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'No dialog horizontal overflow');
      await dialog.getByLabel('Título', { exact: true }).fill('Manutenção reagendada');
      await dialog.getByRole('button', { name: 'Salvar e sincronizar' }).click();
      await dialog.getByRole('alert').filter({ hasText: 'O técnico está reservado' }).waitFor();
      assert.equal(await dialog.getByLabel('Título', { exact: true }).inputValue(), 'Manutenção reagendada', 'Rejected edit keeps input');
      assert.equal(writes[0].body.expected_revision, 3);
      mode = 'save';
      await dialog.getByLabel('Dia inteiro', { exact: true }).check();
      assert.equal(await dialog.getByLabel('Último dia', { exact: true }).inputValue(), today);
      await dialog.getByLabel('Técnico de apoio', { exact: true }).check();
      await dialog.getByRole('button', { name: 'Salvar e sincronizar' }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(writes[1].body.appointment_end_date, tomorrow, 'All-day end is exclusive for Google');
      assert.equal(writes[1].body.appointment_time, null);
      assert.deepEqual(writes[1].body.technician_ids, [1, 2]);
      await page.getByText('Envio pendente', { exact: true }).waitFor();
      assert.equal(await page.locator('#root').evaluate(el => el.inert), false);
      appointment = { ...appointment, google_sync_status: 'conflict', google_sync_revision: 4, google_sync_conflict: { summary: 'Título atualizado no Google', location: 'Outro endereço', start: { date: today }, end: { date: tomorrow }, status: 'confirmed', description: 'Equipe atualizada no Google.' } };
      await page.reload();
      await page.getByRole('button', { name: 'Revisar alterações de Cliente de teste', exact: true }).click();
      const conflict = page.getByRole('dialog', { name: 'Revisar alterações', exact: true });
      await conflict.getByText('Título atualizado no Google', { exact: true }).waitFor();
      await conflict.getByText('Manutenção reagendada', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(outputDir, `conflict-${viewport.width}.png`) });
      await conflict.getByRole('button', { name: 'Usar versão do Google' }).click();
      await conflict.waitFor({ state: 'hidden' });
      assert.deepEqual(writes[2].body, { resolution: 'google', expected_revision: 4 });
      await page.getByRole('status').filter({ hasText: 'Versão do Google aplicada.' }).waitFor();
      writeAuthorized = false;
      appointment = { ...appointment, calendar_writable: false };
      await page.reload();
      await page.getByRole('button', { name: 'Autorizar edição', exact: true }).waitFor();
      await edit.click();
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Salvar e sincronizar' }).isDisabled(), true);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await edit.evaluate(el => document.activeElement === el), true, 'Focus restored');
      await page.evaluate(() => localStorage.setItem('fixture.role', 'technician'));
      await page.reload();
      await page.getByRole('heading', { name: 'Agenda de atendimentos.' }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Editar atendimento de|Revisar alterações de|Sincronizar agora|Autorizar edição/ }).count(), 0, 'Technician has no admin mutation actions');
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedRequests, [], 'No external requests');
      assert.equal(writes.length, 3, 'Only isolated expected writes');
      console.log(`PASS ${viewport.width}x${viewport.height}: edit, rejection, all-day, team, queued sync, conflict, readonly, role and focus`);
      checks += 10;
      await context.close();
    }
    console.log(`PASS ${checks} checks; all writes intercepted; no live data changed.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
