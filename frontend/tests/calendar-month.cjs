const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Monthly calendar fixtures require a local Vite server.');
const outputDir = path.join(__dirname, '..', 'test-results', 'calendar-month');
fs.mkdirSync(outputDir, { recursive: true });
const technicians = [{ id: 1, name: 'Ana Luísa', status: 'Ativo' }, { id: 2, name: 'Bruno Campos', status: 'Ativo' }];
const mainAppointment = {
  id: 201, title: 'Manutenção preventiva', client_name: 'São João — Unidade Central',
  client_address: 'Rua das Acácias, 250 — São Paulo',
  appointment_date: '2026-09-21', appointment_time: '08:00', appointment_end_date: '2026-09-21', appointment_end_time: '10:00',
  technician_ids: [1], technician_names: 'Ana Luísa', status: 'Agendado', workflow_status: 'Confirmado com cliente',
  google_calendar_id: 'isolated-calendar', google_event_id: 'isolated-event', calendar_writable: true,
  google_sync_status: 'synced', google_sync_revision: 1,
  reservations: [{ id: 301, asset_tag: 'QA-101', analyzer_name: 'Analisador de segurança', status: 'Reservado' }, { id: 302, asset_tag: 'QA-102', analyzer_name: 'Simulador de sinais', status: 'Devolvido' }]
};
const appointments = [
  mainAppointment,
  ...Array.from({ length: 9 }, (_, index) => ({
    ...mainAppointment, id: 202 + index, client_name: `Unidade de teste ${index + 1}`, title: `Atendimento complementar ${index + 1}`,
    appointment_time: `${String(9 + index).padStart(2, '0')}:00`, appointment_end_time: `${String(10 + index).padStart(2, '0')}:00`,
    technician_ids: [2], technician_names: 'Bruno Campos', workflow_status: 'Data provisória', reservations: [], google_event_id: `isolated-${202 + index}`
  })),
  { ...mainAppointment, id: 220, client_name: 'Plantão entre meses', title: 'Plantão entre meses', appointment_date: '2026-08-30', appointment_end_date: '2026-09-03', appointment_time: null, appointment_end_time: null, all_day: true, reservations: [] },
  { ...mainAppointment, id: 221, client_name: 'Atendimento noturno', appointment_date: '2026-09-30', appointment_end_date: '2026-10-01', appointment_time: '22:00', appointment_end_time: '00:00', reservations: [] }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let checks = 0;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
      const mobileCalendar = viewport.width < 960;
      const cellSelector = mobileCalendar ? '.month-cell' : '.framework-day';
      const eventSelector = mobileCalendar ? '.month-event' : '.framework-event';
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const writes = [];
      const externalRequests = [];
      const errors = [];
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
          // Legacy font imports are blocked too, but are not application calls.
          if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) externalRequests.push(request.url());
          return route.abort();
        }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (request.method() !== 'GET') {
          writes.push({ method: request.method(), path: url.pathname });
          return route.fulfill({ status: 403, json: { success: false, error: 'This fixture never permits API writes.' } });
        }
        if (url.pathname === '/api/sync/google/status') return route.fulfill({ json: { success: true, authenticated: true, write_authorized: true, bidirectional: true, pending: 0, conflicts: 0, errors: 0 } });
        return route.fulfill({ json: { success: true, technicians, appointments, reservations: [], equipments: [], categories: [], analyzers: [], stats: {}, recentReservations: [] } });
      });
      await context.addInitScript(() => {
        localStorage.setItem('atem.auth.user', JSON.stringify({ id: 1, name: 'Teste isolado', role: localStorage.getItem('fixture.role') || 'admin' }));
        localStorage.setItem('atem.auth.token', 'isolated-fixture');
        localStorage.setItem('atem_agenda_view_mode', 'spreadsheet');
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseUrl}/agenda`);
      const monthInput = page.getByLabel('Selecionar mês', { exact: true });
      const setMonth = async month => {
        await monthInput.fill(month);
        await page.locator(`${cellSelector}[data-date="${month}-15"]`).waitFor();
        assert.equal(await monthInput.inputValue(), month);
      };
      const cell = date => page.locator(`${cellSelector}[data-date="${date}"]`);
      const verifyDialog = async (dialog, label) => {
        await dialog.waitFor();
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, `${label} fits viewport`);
        assert.equal(await dialog.evaluate(el => el.parentElement.parentElement === document.body), true, `${label} uses body portal`);
        assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${label} has no horizontal overflow`);
        assert.equal(await page.locator('#root').evaluate(el => el.inert), true, `${label} blocks background`);
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, `${label} contains focus`);
      };
      const closeDialog = async dialog => { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); };

      await setMonth('2026-09');
      assert.equal(await page.locator(cellSelector).count(), 35, 'September 2026 uses five complete weeks');
      assert.deepEqual((await page.locator(mobileCalendar ? '.month-calendar__weekday' : '.framework-weekday').allTextContents()).map(text => text.toLowerCase()), ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);
      const geometry = await page.locator(mobileCalendar ? '.month-calendar__grid' : '.atem-fullcalendar').evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth }));
      assert.ok(geometry.overflow <= 1, 'Month grid does not overflow');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page fits viewport width');

      const helperResults = await page.evaluate(async ({ appointments, technicians }) => {
        const helpers = await import('/src/lib/calendarMonth.ts');
        const days = helpers.monthDays('2026-09');
        const groups = helpers.groupMonthAppointments(days, appointments, technicians);
        return {
          counts: ['2026-09', '2026-08', '2026-02', '2024-02'].map(month => helpers.monthDays(month).length),
          first: days[0], last: days.at(-1), leap: helpers.monthDays('2024-02').includes('2024-02-29'),
          allDayIncluded: ['2026-08-30', '2026-09-01', '2026-09-02'].every(day => groups.get(day).some(item => item.id === 220)),
          allDayEndExcluded: !groups.get('2026-09-03').some(item => item.id === 220),
          midnightEndExcluded: !groups.get('2026-10-01').some(item => item.id === 221),
          fallbackTeam: helpers.appointmentTeam({ ...appointments[0], technician_names: '', technician_name: '', technician_ids: [2] }, technicians),
          missingTime: helpers.appointmentTime({ ...appointments[0], appointment_time: null }),
          continuation: helpers.appointmentTime({ ...appointments[0], appointment_date: '2026-09-20' }, '2026-09-21')
        };
      }, { appointments, technicians });
      assert.deepEqual(helperResults, { counts: [35, 42, 28, 35], first: '2026-08-30', last: '2026-10-03', leap: true, allDayIncluded: true, allDayEndExcluded: true, midnightEndExcluded: true, fallbackTeam: 'Bruno Campos', missingTime: 'Sem horário', continuation: 'Continuação' });

      await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
      assert.equal(await monthInput.inputValue(), '2026-08');
      assert.equal(await page.locator(cellSelector).count(), 42, 'Six-week month');
      await setMonth('2026-02');
      assert.equal(await page.locator(cellSelector).count(), 28, 'Four-week month');
      await setMonth('2024-02');
      assert.equal(await cell('2024-02-29').count(), 1, 'Leap day is visible');
      await page.getByRole('button', { name: 'Hoje', exact: true }).click();
      assert.equal(await monthInput.inputValue(), new Date().toLocaleDateString('sv-SE').slice(0, 7));
      await setMonth('2026-09');

      if (!mobileCalendar) {
        const sidebar = page.locator('.app-sidebar');
        const expandedWidth = await sidebar.evaluate(el => el.getBoundingClientRect().width);
        await page.getByRole('button', { name: 'Recolher menu lateral' }).click();
        assert.equal(await sidebar.evaluate(el => el.classList.contains('app-sidebar--collapsed')), true, 'Sidebar can collapse');
        await page.waitForTimeout(300);
        assert.ok(await sidebar.evaluate(el => el.getBoundingClientRect().width) < expandedWidth, 'Collapsed sidebar frees horizontal space');
        await page.getByRole('button', { name: 'Expandir menu lateral' }).click();
        const viewportElement = page.locator('.month-calendar__viewport');
        const viewportGeometry = await viewportElement.evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
        assert.ok(viewportGeometry.scroll > viewportGeometry.client, 'Month days can be panned within the viewport');
        await page.getByRole('button', { name: 'Aumentar zoom' }).click();
        assert.equal(await page.locator('.month-calendar__zoom-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 5, 'Zoom reflows into five days per row');
        assert.equal(await page.locator('.month-zoom-day[data-date="2026-09-21"] .month-zoom-event').count(), 8, 'Zoomed day shows eight appointments');
        await page.getByRole('button', { name: 'Aumentar zoom' }).click();
        assert.equal(await page.locator('.month-calendar__zoom-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3, 'Further zoom reflows into three days per row');
        await page.getByRole('button', { name: 'Diminuir zoom' }).click();
        await page.getByRole('button', { name: 'Diminuir zoom' }).click();
        await page.getByRole('button', { name: 'Abrir agenda em tela cheia' }).click();
        assert.equal(await page.locator('.month-calendar--fullscreen').count(), 1, 'Fullscreen expands calendar');
        const fullscreenBounds = await page.locator('.month-calendar--fullscreen').boundingBox();
        assert.ok(fullscreenBounds.x <= 1 && fullscreenBounds.y <= 1 && fullscreenBounds.width >= viewport.width - 1 && fullscreenBounds.height >= viewport.height - 1, 'Fullscreen covers the viewport');
        await page.getByRole('button', { name: 'Sair da tela cheia' }).click();
        assert.equal(await page.locator('.month-calendar--fullscreen').count(), 0, 'Fullscreen can be closed');
      } else {
        await page.getByRole('button', { name: 'Aumentar zoom' }).click();
        assert.equal(await page.locator('.month-calendar__zoom-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3, 'Mobile zoom reflows days');
        assert.equal(await page.locator('.month-zoom-day[data-date="2026-09-21"] .month-zoom-event').count(), 8, 'Mobile zoom shows eight visits');
        await page.getByRole('button', { name: 'Diminuir zoom' }).click();
      }

      const day = cell('2026-09-21');
      if (!mobileCalendar) {
        assert.equal(await day.locator(`${eventSelector}:visible`).count(), 8);
        await page.getByLabel('Compacta', { exact: true }).check();
        await day.locator(`${eventSelector}:visible`).nth(7).waitFor();
        assert.equal(await day.locator(`${eventSelector}:visible`).count(), 8, 'Compact mode preserves eight events');
        await page.getByLabel('Compacta', { exact: true }).uncheck();
        await day.locator('.framework-more').filter({ hasText: 'Mais 2' }).waitFor();
        await day.locator('.framework-more').click();
        const dayDialog = page.getByRole('dialog', { name: /^Agenda de / });
        await verifyDialog(dayDialog, 'Full day agenda');
        assert.equal(await dayDialog.locator('.month-day-event').count(), 10, 'Overflow opens every event');
        const nestedOpener = dayDialog.locator('.month-day-event').first();
        await nestedOpener.click();
        const nestedDetails = page.getByRole('dialog', { name: mainAppointment.client_name, exact: true });
        await verifyDialog(nestedDetails, 'Nested event details');
        assert.equal(await dayDialog.evaluate(el => el.parentElement.inert), true, 'Parent day dialog is inert');
        await closeDialog(nestedDetails);
        assert.equal(await nestedOpener.evaluate(el => el === document.activeElement), true, 'Nested focus returns to day entry');
        assert.equal(await dayDialog.evaluate(el => el.parentElement.inert), false, 'Day dialog becomes active again');
        await closeDialog(dayDialog);
      } else {
        await day.locator('.month-date').click();
        assert.equal(await page.getByRole('dialog').count(), 0, 'Mobile day selection stays inline');
        assert.equal(await page.locator('.month-calendar__mobile-agenda .month-day-event').count(), 10, 'Mobile displays full selected-day agenda');
        assert.equal(await day.locator('.month-date').getAttribute('aria-pressed'), 'true');
      }
      const opener = () => mobileCalendar
        ? page.locator('.month-calendar__mobile-agenda .month-day-event').filter({ hasText: mainAppointment.client_name })
        : day.locator(`${eventSelector}:visible`).filter({ hasText: mainAppointment.client_name });
      await opener().click();
      const eventDialog = page.getByRole('dialog', { name: mainAppointment.client_name, exact: true });
      await verifyDialog(eventDialog, 'Event details');
      await eventDialog.getByText(mainAppointment.client_address, { exact: true }).waitFor();
      await eventDialog.getByText('Confirmado com cliente', { exact: true }).waitFor();
      await eventDialog.getByText('QA-101 · Analisador de segurança · Reservado', { exact: true }).waitFor();
      await eventDialog.getByText('QA-102 · Simulador de sinais · Devolvido', { exact: true }).waitFor();
      assert.equal(await eventDialog.getByRole('button', { name: 'Checklist e reservas', exact: true }).isVisible(), true);
      assert.equal(await eventDialog.getByRole('button', { name: 'Editar', exact: true }).isVisible(), true);
      assert.equal(await eventDialog.evaluate(el => getComputedStyle(el).animationName), 'none', 'Reduced motion removes dialog animation');
      await page.screenshot({ path: path.join(outputDir, `event-${viewport.width}.png`) });
      await closeDialog(eventDialog);
      assert.equal(await opener().evaluate(el => el === document.activeElement), true, 'Detail focus returns to opener');
      await opener().click();
      await eventDialog.getByRole('button', { name: 'Editar', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Editar atendimento', exact: true });
      await verifyDialog(editor, 'Existing calendar editor');
      assert.equal(await editor.getByLabel('Título do atendimento', { exact: true }).inputValue(), mainAppointment.title);
      await closeDialog(editor);
      await eventDialog.waitFor();
      assert.equal(await eventDialog.getByRole('button', { name: 'Editar', exact: true }).evaluate(el => el === document.activeElement), true, 'Editor focus returns to detail action');
      await closeDialog(eventDialog);

      await page.getByLabel('Buscar atendimentos', { exact: true }).fill('sao joao');
      assert.equal(await page.locator(eventSelector).count(), 1, 'Search ignores accents');
      await page.getByRole('button', { name: 'Limpar', exact: true }).click();
      await page.getByLabel('Filtrar por técnico', { exact: true }).selectOption('Bruno Campos');
      if (!mobileCalendar) await day.locator(`${eventSelector}:visible`).nth(7).waitFor();
      assert.equal(await cell('2026-09-01').locator(eventSelector).count(), 0, 'Technician filter removes other teams from multi-day events');
      assert.equal(await day.locator(`${eventSelector}:visible`).count(), mobileCalendar ? 0 : 8, 'Technician-filtered day retains visible limit');
      assert.equal(await day.locator(eventSelector).filter({ hasText: mainAppointment.client_name }).count(), 0, 'Technician filter removes other teams');
      await page.getByRole('button', { name: 'Limpar', exact: true }).click();

      await page.evaluate(() => localStorage.setItem('fixture.role', 'technician'));
      await page.reload();
      await setMonth('2026-09');
      if (mobileCalendar) await day.locator('.month-date').click();
      await opener().click();
      await verifyDialog(eventDialog, 'Technician event details');
      assert.equal(await eventDialog.getByRole('button', { name: 'Checklist e reservas', exact: true }).isVisible(), true, 'Technician retains checklist access');
      assert.equal(await eventDialog.getByRole('button', { name: /^(Editar|Excluir|Revisar alterações)$/ }).count(), 0, 'Technician sees no event mutation actions');
      await closeDialog(eventDialog);
      assert.equal(await page.getByRole('button', { name: /^Novo(?: atendimento)?(?: em .*)?$/ }).count(), 0, 'Technician sees no create actions');
      await page.locator('.agenda-page').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(outputDir, `month-${viewport.width}.png`), fullPage: true });
      assert.deepEqual(writes, [], 'No API writes were attempted');
      assert.deepEqual(externalRequests, [], 'No external services contacted');
      assert.deepEqual(errors, [], 'No browser runtime errors');
      console.log(`PASS ${viewport.width}x${viewport.height}: month geometry, dates, filters, details, permissions and isolated navigation`);
      checks += 18;
      await context.close();
    }
    console.log(`PASS ${checks} monthly-calendar checks; all API requests intercepted; zero writes.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
