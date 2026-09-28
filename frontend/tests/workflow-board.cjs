const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Workflow fixtures require a local Vite server.');
const outputDir = path.join(__dirname, '..', 'test-results', 'workflow-board');
fs.mkdirSync(outputDir, { recursive: true });

const technician = { id: 4, name: 'Ana Técnica', role: 'Técnico de Campo', status: 'Ativo' };
const supervisor = { id: 2, name: 'Lia Supervisora', role: 'Supervisor', status: 'Ativo' };
const base = { title: 'Preventiva', client_name: 'Hospital Central', client_address: 'Rua A, 100', appointment_date: '2026-09-28', appointment_time: '08:00', appointment_end_date: '2026-09-28', appointment_end_time: '17:00', all_day: false, technician_ids: [], technician_names: '', google_calendar_id: 'fixture-calendar', google_event_id: 'fixture-event', calendar_writable: true, google_sync_revision: 1 };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const records = [
        { ...base, id: 101, workflow_status: 'Data provisória' },
        { ...base, id: 102, client_name: 'Hospital sem local', client_address: '', workflow_status: 'Data provisória' },
        { ...base, id: 103, client_name: 'Hospital em validação', workflow_status: 'Aguardando validação do supervisor' },
        { ...base, id: 104, client_name: 'Hospital validado', workflow_status: 'Validado pelo supervisor', technician_ids: [4], technician_names: technician.name, workflow_assignee_id: 1 },
        { ...base, id: 105, client_name: 'Hospital concluído', workflow_status: 'Concluído', technician_ids: [4], technician_names: technician.name }
      ];
      const writes = [];
      const errors = [];
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: { id: 1, name: 'Comercial Fixture', role: 'commercial' } } });
        if (request.method() === 'PATCH' && /\/api\/appointments\/\d+\/workflow$/.test(url.pathname)) {
          const id = Number(url.pathname.split('/')[3]);
          const body = request.postDataJSON();
          writes.push({ id, body });
          const record = records.find(item => item.id === id);
          record.workflow_status = body.workflow_status;
          return route.fulfill({ json: { success: true, appointment: record } });
        }
        if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { success: false, error: 'Fixture blocks unexpected writes.' } });
        if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments: records } });
        if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians: [technician, supervisor] } });
        return route.fulfill({ json: { success: true, analyzers: [], categories: [], technicians: [technician, supervisor], stats: {}, recentReservations: [] } });
      });
      await context.addInitScript(() => {
        localStorage.setItem('atem.auth.user', JSON.stringify({ id: 1, name: 'Comercial Fixture', role: 'commercial' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseUrl}/workflow`);
      await page.getByRole('heading', { name: 'Workflow', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Workflow', exact: true }).count(), 1, 'Commercial sees workflow navigation');
      await page.getByLabel('Filtrar por mês').fill('2026-09');
      assert.equal(await page.locator('.workflow-card').count(), 5, 'All fixture appointments are shown');
      await page.screenshot({ path: path.join(outputDir, `workflow-${viewport.width}.png`) });
      await page.getByLabel('Filtrar por nível').selectOption('Data provisória');
      assert.equal(await page.locator('.workflow-column').count(), 2, 'Level filter preserves next drop column');
      await page.getByRole('button', { name: /Avançar Hospital sem local/ }).click();
      await page.getByRole('alert').getByText(/Local/).waitFor();
      await page.getByRole('dialog', { name: 'Editar atendimento' }).waitFor();
      assert.equal(writes.length, 0, 'Missing required field blocks PATCH');
      await page.keyboard.press('Escape');
      if (viewport.width > 600) {
        const source = page.locator('.workflow-card').filter({ hasText: 'Hospital Central' });
        const target = page.locator('.workflow-column[data-stage="Aguardando validação do supervisor"]');
        const a = await source.boundingBox();
        const b = await target.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + 30);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + 100, { steps: 12 });
        await page.mouse.up();
        await page.getByRole('dialog', { name: 'Encaminhar atendimento' }).waitFor();
        assert.equal(writes.length, 0, 'Drag requires selecting the next owner');
        await page.getByLabel('Responsável pela próxima etapa').selectOption('2');
        await page.getByRole('button', { name: 'Confirmar encaminhamento' }).click();
        await page.getByRole('status').getByText(/movido para/).waitFor();
        assert.deepEqual(writes, [{ id: 101, body: { workflow_status: 'Aguardando validação do supervisor', workflow_assignee_id: 2 } }], 'Drag advances exactly one adjacent stage with owner');
      } else {
        await page.getByRole('button', { name: /Avançar Hospital Central/ }).click();
        await page.getByLabel('Responsável pela próxima etapa').selectOption('2');
        await page.getByRole('button', { name: 'Confirmar encaminhamento' }).click();
        await page.getByRole('status').getByText(/movido para/).waitFor();
        assert.equal(writes.length, 1, 'Touch-sized layout retains accessible action');
      }
      await page.getByLabel('Filtrar por nível').selectOption('Validado pelo supervisor');
      assert.equal(await page.locator('.workflow-column').count(), 2);
      assert.equal(await page.locator('.workflow-card').count(), 1);
      await page.getByText('Minhas atividades', { exact: true }).last().click();
      assert.equal(await page.locator('.workflow-card').count(), 1, 'Commercial can isolate tasks assigned to them');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'No page-level horizontal overflow');
      assert.deepEqual(errors, [], 'No runtime errors');
      await context.close();
      console.log(`PASS workflow ${viewport.width}x${viewport.height}`);
    }
    const technicianContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await technicianContext.addInitScript(() => {
      localStorage.setItem('atem.auth.user', JSON.stringify({ id: 4, name: 'Ana Técnica', role: 'technician' }));
      localStorage.setItem('atem.auth.token', 'isolated-fixture');
    });
    await technicianContext.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { success: false } });
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user: { id: 4, name: 'Ana Técnica', role: 'technician' } } });
      if (url.pathname === '/api/appointments') return route.fulfill({ json: { success: true, appointments: [
        { ...base, id: 601, client_name: 'Minha atividade', workflow_status: 'Em execução', workflow_assignee_id: 4, technician_ids: [4] },
        { ...base, id: 602, client_name: 'Atividade de outro', workflow_status: 'Em execução', workflow_assignee_id: 2, technician_ids: [4] }
      ] } });
      return route.fulfill({ json: { success: true, technicians: [technician, supervisor], analyzers: [], categories: [], stats: {}, recentReservations: [] } });
    });
    const technicianPage = await technicianContext.newPage();
    await technicianPage.goto(`${baseUrl}/workflow`);
    await technicianPage.getByRole('heading', { name: 'Workflow' }).waitFor();
    assert.equal(await technicianPage.getByRole('button', { name: 'Minhas atividades' }).count(), 1, 'Technician receives a dedicated menu');
    assert.equal(await technicianPage.getByRole('button', { name: 'Templates', exact: true }).count(), 0, 'Technician cannot show Templates in sidebar');
    await technicianPage.getByRole('button', { name: 'Personalizar menu' }).click();
    assert.equal(await technicianPage.getByRole('dialog', { name: 'Personalizar menu' }).getByLabel('Mostrar Templates').count(), 0, 'Technician cannot re-enable Templates');
    await technicianPage.getByRole('button', { name: 'Concluído' }).click();
    assert.equal(await technicianPage.locator('.workflow-card').count(), 1, 'Technician sees only assigned activity');
    assert.equal(await technicianPage.getByRole('button', { name: /Avançar|Editar dados/ }).count(), 0, 'Technician view is read-only');
    await technicianContext.close();
    console.log('PASS workflow technician ownership');

    for (const role of ['supervisor', 'manager']) {
      const context = await browser.newContext();
      const user = { id: role === 'manager' ? 8 : 2, name: role, role };
      await context.addInitScript(user => {
        localStorage.setItem('atem.auth.user', JSON.stringify(user));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
      }, user);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { success: true, user } });
        return route.fulfill({ json: { success: true, appointments: [], technicians: [supervisor], analyzers: [], categories: [], stats: {}, recentReservations: [] } });
      });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/workflow`);
      await page.getByRole('heading', { name: 'Workflow' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Templates', exact: true }).count(), 0, `${role} defaults to hidden Templates`);
      await page.getByRole('button', { name: 'Personalizar menu' }).click();
      await page.getByRole('dialog', { name: 'Personalizar menu' }).getByLabel('Mostrar Templates').check();
      await page.getByRole('button', { name: 'Concluído' }).click();
      assert.equal(await page.getByRole('button', { name: 'Templates', exact: true }).count(), 1, `${role} can enable Templates`);
      await page.reload();
      assert.equal(await page.getByRole('button', { name: 'Templates', exact: true }).count(), 1, `${role} preference persists`);
      await context.close();
    }
    console.log('PASS sidebar preferences');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
