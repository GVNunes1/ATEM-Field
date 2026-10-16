const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Login fixtures require a local Vite server.');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
    const attempts = [];
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/auth/login') {
        attempts.push(request.postDataJSON());
        return route.fulfill({ status: 401, json: { success: false, error: 'PIN de teste incorreto' } });
      }
      if (url.pathname === '/api/technicians') return route.fulfill({ json: { success: true, technicians: [
        { id: 4, name: 'Ana Técnica', role: 'Técnico de Campo', status: 'Ativo' },
        { id: 5, name: 'Bruno Supervisor', role: 'Supervisor', status: 'Ativo' }
      ] } });
      return route.fulfill({ json: { success: true, technicians: [], appointments: [], analyzers: [], categories: [], stats: {}, recentReservations: [] } });
    });
    await page.goto(baseUrl);
    const select = page.getByLabel('Usuário');
    await select.waitFor();
    assert.deepEqual(await select.locator('option').allTextContents(), [
      'Selecione seu nome...', 'Administrador', 'Ana Técnica (Técnico de Campo)', 'Bruno Supervisor (Supervisor)'
    ]);
    assert.equal(await page.getByRole('button', { name: 'Técnico de Campo' }).count(), 0, 'No split login tabs');
    await select.selectOption('admin');
    await page.getByLabel('PIN / Senha').fill('fixture-admin');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('alert').getByText('PIN de teste incorreto').waitFor();
    await select.selectOption('4');
    assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).isDisabled(), true, 'Technician login requires an explicit PIN');
    await page.locator('.login-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(attempts.length, 1, 'Blank technician login sends no substituted default PIN');
    await page.getByLabel('PIN / Senha').fill('fixture-tech');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    assert.deepEqual(attempts, [
      { type: 'admin', pin: 'fixture-admin' },
      { type: 'technician', technician_id: 4, pin: 'fixture-tech' }
    ]);
    console.log('PASS unified login');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
