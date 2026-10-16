const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Auth fixtures require a local Vite server.');
const adminToken = 'isolated-admin-token';
const techToken = 'isolated-technician-token';
const admin = { id: 99, name: 'Admin de teste', role: 'admin' };
const technician = { id: 1, name: 'Ana de teste', role: 'Técnico de Campo', status: 'Ativo', phone: '11900000000', email: '', has_pin: true };
const technicians = [technician, { ...technician, id: 2, name: 'Ana duplicada', has_pin: false }];
const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const privateAppointments = [{ id: 701, client_name: 'Cliente privado anterior', appointment_date: future, appointment_time: '08:00', technician_id: 1, technician_ids: [1], status: 'Agendado', equipments: [], reservations: [] }];
const ownAppointments = [{ ...privateAppointments[0], id: 702, client_name: 'Cliente autorizado atual' }];
const errors = [];

async function fixture(browser, viewport, seed = true, chosenPin = '4826') {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const requests = [];
  const writes = [];
  const held = [];
  let holdAdminAppointments = false;
  let holdLogin = false;
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const token = request.headers().authorization;
    requests.push({ path: url.pathname, method: request.method(), token });
    if (request.method() !== 'GET') writes.push({ path: url.pathname, body: request.postDataJSON() });
    const respond = json => route.fulfill({ json });
    if (url.pathname === '/api/auth/login') {
      assert.deepEqual(request.postDataJSON(), { type: 'technician', technician_id: 1, pin: chosenPin });
      const complete = () => respond({ success: true, token: techToken, user: { id: 1, name: technician.name, role: 'technician' } });
      if (holdLogin) { held.push(complete); return; }
      return complete();
    }
    if (url.pathname === '/api/auth/session') return respond({ success: true, user: token === `Bearer ${adminToken}` ? admin : { id: 1, name: technician.name, role: 'technician' } });
    if (url.pathname === '/api/appointments') {
      assert.ok(token, 'Private appointments are never requested anonymously');
      const complete = () => respond({ success: true, appointments: token === `Bearer ${adminToken}` ? privateAppointments : ownAppointments });
      if (holdAdminAppointments && token === `Bearer ${adminToken}`) { held.push(complete); return; }
      return complete();
    }
    if (request.method() !== 'GET') return respond({ success: true });
    if (url.pathname === '/api/credentials') return respond({ success: true, credentials: [{ id: 8, username: 'fixture', display_name: 'Credencial de teste', role: 'technician', has_pin: true }] });
    if (url.pathname === '/api/technicians') return respond({ success: true, technicians });
    return respond({ success: true, stats: {}, recentReservations: [], analyzers: [], categories: [], reservations: [], readiness: [], alerts: [] });
  });
  if (seed) await context.addInitScript(({ admin, adminToken }) => {
    localStorage.setItem('atem.auth.user', JSON.stringify(admin));
    localStorage.setItem('atem.auth.token', adminToken);
  }, { admin, adminToken });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, requests, writes, held, holdRefresh() { holdAdminAppointments = true; }, holdLogin() { holdLogin = true; } };
}

async function storedSession(page) {
  return page.evaluate(() => ({ token: localStorage.getItem('atem.auth.token'), user: localStorage.getItem('atem.auth.user') }));
}

async function standby(page) {
  await page.locator('.tablet-tech-card').filter({ hasText: technician.name }).waitFor();
  assert.deepEqual(await storedSession(page), { token: null, user: null });
  assert.equal(await page.locator('.tablet-badge-appts').count(), 0, 'Prior appointment cache cleared from standby');
}

async function enterPin(page, pin = '4826', submit = true) {
  await page.locator('.tablet-tech-card').filter({ hasText: technician.name }).click();
  const dialog = page.getByRole('dialog', { name: 'PIN do técnico' });
  assert.equal(await dialog.getByRole('button', { name: 'Entrar', exact: true }).isDisabled(), true);
  for (const digit of pin) await dialog.getByRole('button', { name: digit, exact: true }).click();
  await dialog.getByRole('status', { name: `${pin.length} dígitos informados` }).waitFor();
  if (submit) await dialog.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function authenticate(page) {
  await enterPin(page);
  await page.getByText('Cliente autorizado atual').waitFor();
  assert.equal((await storedSession(page)).token, techToken, 'Fresh kiosk login remains active');
  assert.equal(await page.getByText('Cliente privado anterior').count(), 0);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
      for (const route of ['/totem', '/tablet/', '/kiosk', '/?tab=tablet', '/?tab=KIOSK']) {
        const f = await fixture(browser, viewport);
        await f.page.goto(`${baseUrl}${route}`);
        await standby(f.page);
        assert.equal(f.requests.some(request => request.token === `Bearer ${adminToken}`), false, 'Direct kiosk load clears inherited token before API calls');
        assert.equal(f.requests.some(request => request.path.startsWith('/api/appointments')), false, 'Anonymous chooser skips private data');
        await f.context.close();
      }

      const f = await fixture(browser, viewport);
      await f.page.goto(`${baseUrl}/tecnicos`);
      await f.page.getByRole('button', { name: 'Novo técnico', exact: true }).waitFor();
      f.holdRefresh();
      await f.page.getByRole('button', { name: 'Atualizar dados', exact: true }).click();
      for (let i = 0; i < 50 && !f.held.length; i++) await f.page.waitForTimeout(20);
      assert.ok(f.held.length, 'Admin request held across kiosk transition');
      if (viewport.width > 768) await f.page.getByRole('button', { name: 'Modo Tablet / Totem', exact: true }).click();
      else await f.page.evaluate(() => { history.pushState({}, '', '/totem'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await standby(f.page);
      await Promise.all(f.held.splice(0).map(complete => complete()));
      await f.page.waitForTimeout(100);
      await standby(f.page);
      assert.equal(await f.page.getByRole('alert').count(), 0, 'Anonymous kiosk has no private-endpoint load error');
      await authenticate(f.page);
      await f.page.getByRole('button', { name: 'Retirar para Chamado', exact: true }).click();
      await f.page.getByRole('dialog').waitFor();
      await f.page.evaluate(() => { history.pushState({}, '', '/tecnicos'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await f.page.getByRole('heading', { name: 'Bem-vindo ao ATEM Field' }).waitFor();
      assert.deepEqual(await storedSession(f.page), { token: null, user: null }, 'Popstate exit cannot enter the workspace with kiosk token');
      assert.equal(await f.page.locator('.field-modal-layer').count(), 0, 'Session exit unmounts private child dialogs');
      await f.page.goBack();
      await standby(f.page);
      await authenticate(f.page);
      await f.page.getByRole('button', { name: 'Sair', exact: true }).click();
      await standby(f.page);
      await f.page.getByRole('button', { name: 'Voltar ao Painel Administrativo' }).click();
      await f.page.getByRole('heading', { name: 'Bem-vindo ao ATEM Field' }).waitFor();
      assert.deepEqual(await storedSession(f.page), { token: null, user: null });
      assert.equal(f.writes.every(write => write.path === '/api/auth/login'), true, 'Kiosk test writes are only intercepted fixture logins');
      await f.context.close();

      const late = await fixture(browser, viewport);
      late.holdLogin();
      await late.page.goto(`${baseUrl}/totem`);
      await standby(late.page);
      await enterPin(late.page);
      for (let i = 0; i < 50 && !late.held.length; i++) await late.page.waitForTimeout(20);
      assert.ok(late.held.length, 'Login response held across navigation');
      await late.page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await late.page.getByRole('heading', { name: 'Bem-vindo ao ATEM Field' }).waitFor();
      await Promise.all(late.held.splice(0).map(complete => complete()));
      await late.page.waitForTimeout(100);
      assert.deepEqual(await storedSession(late.page), { token: null, user: null }, 'Late kiosk authentication cannot revive a session after exit');
      await late.context.close();
      console.log(`PASS kiosk aliases, navigation, stale responses and per-technician lifecycle at ${viewport.width}px`);

      for (const pin of ['48261', '48261357']) {
        const longPin = await fixture(browser, viewport, true, pin);
        await longPin.page.goto(`${baseUrl}/totem`);
        await standby(longPin.page);
        await enterPin(longPin.page, pin, false);
        assert.equal(longPin.writes.length, 0, 'Keypad waits for explicit confirmation for any allowed PIN length');
        await longPin.page.getByRole('dialog', { name: 'PIN do técnico' }).getByRole('button', { name: 'Entrar', exact: true }).click();
        await longPin.page.getByText('Cliente autorizado atual').waitFor();
        assert.equal(longPin.writes[0].body.pin, pin, 'Longer PIN remains intact');
        await longPin.context.close();
      }
      console.log(`PASS masked 4/5/8-digit PIN authentication at ${viewport.width}px`);

      const ui = await fixture(browser, viewport);
      await ui.page.goto(`${baseUrl}/tecnicos`);
      await ui.page.getByRole('button', { name: 'Novo técnico', exact: true }).waitFor();
      assert.deepEqual(await ui.page.locator('.technician-pin-val').allTextContents(), ['Configurado', 'Não configurado']);
      assert.equal(await ui.page.getByRole('button', { name: /Visualizar PIN|Ocultar PIN/ }).count(), 0);
      await ui.page.getByRole('button', { name: `Ações de ${technician.name}`, exact: true }).click();
      await ui.page.getByRole('menuitem', { name: /Editar cadastro/ }).click();
      const editPin = ui.page.getByLabel('Novo PIN de acesso (opcional)');
      assert.equal(await editPin.inputValue(), '');
      await ui.page.getByRole('button', { name: 'Salvar no Banco', exact: true }).click();
      await ui.page.getByRole('status').waitFor();
      assert.equal(Object.hasOwn(ui.writes.at(-1).body, 'pin'), false, 'Blank edit omits PIN rather than replacing it');
      await ui.page.getByRole('button', { name: 'Novo técnico', exact: true }).click();
      const createPin = ui.page.getByLabel('PIN de acesso (Login / Totem) *', { exact: true });
      assert.equal(await createPin.inputValue(), '');
      assert.equal(await createPin.getAttribute('type'), 'password');
      await ui.page.getByLabel('Nome completo *', { exact: true }).fill('Técnica nova');
      await ui.page.getByLabel('Celular com DDD *', { exact: true }).fill('11900000001');
      const previousWrites = ui.writes.length;
      await ui.page.getByRole('button', { name: 'Salvar no Banco', exact: true }).click();
      assert.equal(ui.writes.length, previousWrites, 'Create requires a chosen PIN');
      await createPin.fill('123');
      await ui.page.getByRole('button', { name: 'Salvar no Banco', exact: true }).click();
      assert.equal(ui.writes.length, previousWrites, 'Short PIN rejected');
      await createPin.fill('7319');
      await ui.page.getByRole('button', { name: 'Salvar no Banco', exact: true }).click();
      await ui.page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(ui.writes.at(-1).body.pin, '7319', 'Create sends only the explicitly chosen PIN');
      assert.equal((await ui.page.getByRole('status').textContent()).includes('7319'), false, 'Notices do not disclose PINs');
      await ui.page.getByRole('button', { name: `Ações de ${technician.name}`, exact: true }).click();
      await ui.page.getByRole('menuitem', { name: /Mesclar usuário/ }).click();
      await ui.page.locator('.merge-candidates button').first().click();
      await ui.page.locator('.merge-confirmation input').check();
      await ui.page.getByRole('button', { name: 'Mesclar cadastros', exact: true }).click();
      await ui.page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(Object.hasOwn(ui.writes.at(-1).body.profile, 'pin'), false, 'Merge has no credential changes');
      await ui.page.getByRole('button', { name: 'Gerenciar PINs & Acessos', exact: true }).click();
      await ui.page.getByText('PIN configurado', { exact: true }).last().waitFor();
      assert.equal(await ui.page.getByRole('button', { name: /Visualizar PIN|Ocultar PIN/ }).count(), 0);
      await ui.page.getByRole('button', { name: 'Editar', exact: true }).click();
      const resetPin = ui.page.getByPlaceholder('Novo PIN', { exact: true });
      assert.equal(await resetPin.inputValue(), '');
      assert.equal(await resetPin.getAttribute('type'), 'password');
      await resetPin.fill('9351');
      await ui.page.getByRole('button', { name: 'Salvar novo PIN', exact: true }).click();
      await resetPin.waitFor({ state: 'hidden' });
      assert.deepEqual(ui.writes.at(-1).body, { pin: '9351' });
      await ui.page.getByRole('button', { name: 'Novo Usuário / PIN', exact: true }).click();
      const credentialPin = ui.page.getByLabel('PIN de Login (4 a 8 dígitos) *', { exact: true });
      assert.equal(await credentialPin.inputValue(), '');
      assert.equal(await credentialPin.getAttribute('type'), 'password');
      await ui.page.getByLabel('Nome do Profissional / Usuário *').fill('Acesso novo');
      await credentialPin.fill('6935');
      await ui.page.getByRole('button', { name: 'Salvar no Banco', exact: true }).click();
      await credentialPin.waitFor({ state: 'hidden' });
      assert.equal(ui.writes.at(-1).body.pin, '6935');
      assert.equal((await ui.page.getByRole('status').textContent()).includes('6935'), false);
      assert.equal(await ui.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Affected screens fit mobile and desktop');
      await ui.context.close();
      console.log(`PASS PIN status, blank edits, explicit create/reset, credential notices and merge at ${viewport.width}px`);
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('PASS all isolated auth-boundary checks; remote requests blocked and all API requests intercepted');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
