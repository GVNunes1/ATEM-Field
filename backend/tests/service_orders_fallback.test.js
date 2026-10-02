const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const backendDirectory = path.resolve(__dirname, '..');
const pdfDirectory = path.join(backendDirectory, 'data', 'service-orders');

function createSupabaseDouble() {
  const records = new Map();
  const upserts = [];
  let unavailable = false;

  return {
    records,
    upserts,
    setUnavailable(value) { unavailable = value; },
    client: {
      from(table) {
        if (unavailable) throw new Error('Supabase indisponível no teste.');
        assert.equal(table, 'service_orders');
        return {
          select() {
            return {
              eq(_column, id) {
                return {
                  async maybeSingle() {
                    return { data: records.get(String(id)) || null, error: null };
                  }
                };
              },
              async order() {
                return { data: [...records.values()], error: null };
              }
            };
          },
          async upsert(order) {
            const storedOrder = {
              created_at: new Date().toISOString(),
              ...order
            };
            records.set(String(order.id), storedOrder);
            upserts.push(storedOrder);
            return { error: null };
          },
          update(patch) {
            return {
              async eq(_column, id) {
                const current = records.get(String(id));
                if (current) records.set(String(id), { ...current, ...patch });
                return { error: null };
              }
            };
          },
          delete() {
            return {
              async eq(_column, id) {
                records.delete(String(id));
                return { error: null };
              }
            };
          }
        };
      }
    }
  };
}

function createPythonDouble() {
  const calls = [];

  function execFileDouble() {
    throw new Error('The callback implementation must not be called directly.');
  }

  execFileDouble[promisify.custom] = async (_command, args) => {
    const script = path.basename(String(args.find(argument => /\.py$/i.test(String(argument))) || ''));
    const scriptArgs = args.slice(args.findIndex(argument => /\.py$/i.test(String(argument))) + 1);
    calls.push({ script, args: scriptArgs });

    if (script === 'service_order_pdf.py') {
      const outputPath = path.resolve(String(scriptArgs[1]));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from('%PDF-1.4\n% fallback test PDF\n', 'ascii'));
      return { stdout: JSON.stringify({ success: true, output: outputPath }), stderr: '' };
    }

    if (script === 'service_order_drive.py' && scriptArgs[0] === 'upload') {
      return {
        stdout: JSON.stringify({ success: false, error: 'Google Drive indisponível no teste.' }),
        stderr: ''
      };
    }

    if (script === 'service_order_drive.py' && scriptArgs[0] === 'find') {
      return { stdout: JSON.stringify({ success: true, found: false }), stderr: '' };
    }

    if (script === 'service_order_drive.py' && scriptArgs[0] === 'delete') {
      return { stdout: JSON.stringify({ success: true }), stderr: '' };
    }

    throw new Error(`Unexpected Python invocation in test: ${script} ${scriptArgs.join(' ')}`);
  };

  return { execFileDouble, calls };
}

async function startIsolatedApp() {
  process.chdir(backendDirectory);
  process.env.JWT_SECRET = 'service-order-fallback-test-secret-with-at-least-32-characters';

  const supabaseDouble = createSupabaseDouble();
  const pythonDouble = createPythonDouble();
  const supabasePath = require.resolve('@supabase/supabase-js');
  require(supabasePath);
  const cachedSupabaseModule = require.cache[supabasePath];
  const originalSupabaseExports = cachedSupabaseModule.exports;
  const originalExecFile = childProcess.execFile;

  cachedSupabaseModule.exports = {
    ...originalSupabaseExports,
    createClient: () => supabaseDouble.client
  };
  childProcess.execFile = pythonDouble.execFileDouble;

  const routePath = require.resolve('../dist/routes/serviceOrders');
  delete require.cache[routePath];
  const serviceOrdersRouter = require(routePath).default;

  cachedSupabaseModule.exports = originalSupabaseExports;
  childProcess.execFile = originalExecFile;

  const express = require('express');
  const { AuthService } = require('../dist/security/authService');
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api/service-orders', serviceOrdersRouter);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  // The bootstrap administrator is server-verified without a profile query.
  // Other identities require the separate operational Supabase client.
  const token = AuthService.generateSessionToken({ id: '0', role: 'admin', name: 'Teste Admin' });

  return {
    baseUrl,
    token,
    supabaseDouble,
    pythonDouble,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

test('service-order PDF fallback and historical downloads', async t => {
  const fixture = await startIsolatedApp();
  const generatedFiles = [];

  t.after(async () => {
    await fixture.close();
    for (const filePath of generatedFiles) {
      fs.rmSync(filePath, { force: true });
    }
  });

  await t.test('keeps the generated PDF downloadable when Drive upload fails', async () => {
    const response = await fetch(`${fixture.baseUrl}/api/service-orders/generate`, {
      method: 'POST',
      headers: {
        ...authorization(fixture.token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        form_data: {
          Cliente: 'Hospital Teste Fallback',
          Nome_Tecnico: 'Teste Admin',
          Serie: 'SN-FALLBACK',
          Data: '28/08/2026',
          Pecas: []
        }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.drive_uploaded, false);
    assert.match(body.warning, /Drive/i);
    assert.equal(body.download_url, `/api/service-orders/${encodeURIComponent(body.order.id)}/pdf`);
    assert.ok(!body.order.pdf_url || !/^https?:\/\//i.test(body.order.pdf_url), 'fallback must not expose a fake remote URL');

    assert.equal(fixture.supabaseDouble.upserts.length, 1, 'the OS metadata must still be saved');
    const storedOrder = fixture.supabaseDouble.upserts[0];
    assert.ok(!storedOrder.pdf_url || !/^https?:\/\//i.test(storedOrder.pdf_url), 'database must not receive a fake Drive URL');

    const generatedPath = path.join(pdfDirectory, path.basename(body.order.pdf_filename));
    generatedFiles.push(generatedPath);
    assert.equal(fs.existsSync(generatedPath), true, 'fallback PDF must remain available after the response');

    const downloadResponse = await fetch(`${fixture.baseUrl}${body.download_url}`, {
      headers: authorization(fixture.token)
    });
    const bytes = Buffer.from(await downloadResponse.arrayBuffer());

    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get('content-type') || '', /^application\/pdf\b/i);
    assert.match(downloadResponse.headers.get('content-disposition') || '', /attachment/i);
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');

    assert.equal(
      fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').length,
      1,
      'download must reuse the generated PDF instead of regenerating it'
    );
  });

  await t.test('streams a local-only PDF without Drive or Supabase and removes the temporary file', async () => {
    const databaseCallsBefore = fixture.supabaseDouble.upserts.length;
    const driveCallsBefore = fixture.pythonDouble.calls.filter(call => call.script === 'service_order_drive.py').length;
    fixture.supabaseDouble.setUnavailable(true);

    let response;
    try {
      response = await fetch(`${fixture.baseUrl}/api/service-orders/generate-local`, {
        method: 'POST',
        headers: {
          ...authorization(fixture.token),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          form_data: {
            Cliente: 'Hospital Sem Sincronização',
            Nome_Tecnico: 'Teste Admin',
            Serie: 'SN-LOCAL',
            Data: '28/08/2026',
            Pecas: []
          }
        })
      });
    } finally {
      fixture.supabaseDouble.setUnavailable(false);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^application\/pdf\b/i);
    assert.match(response.headers.get('content-disposition') || '', /attachment/i);
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(fixture.supabaseDouble.upserts.length, databaseCallsBefore);
    assert.equal(fixture.pythonDouble.calls.filter(call => call.script === 'service_order_drive.py').length, driveCallsBefore);

    const localCall = fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').at(-1);
    assert.equal(fs.existsSync(path.resolve(String(localCall.args[1]))), false, 'temporary PDF must be removed after response');
  });

  await t.test('does not regenerate an old PDF missing from Drive', async () => {
    const historicalId = 'SIGNED_OS_HISTORICA_20260820_120000';
    const historicalFilename = `${historicalId}.pdf`;
    const historicalPath = path.join(pdfDirectory, historicalFilename);
    fs.rmSync(historicalPath, { force: true });
    fixture.supabaseDouble.records.set(historicalId, {
      id: historicalId,
      status: 'signed',
      technician_name: 'Teste Admin',
      form_data: { Cliente: 'Cliente Histórico', Nome_Tecnico: 'Teste Admin' },
      pdf_filename: historicalFilename,
      pdf_url: null
    });
    const renderCallsBeforeDownload = fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').length;

    const response = await fetch(`${fixture.baseUrl}/api/service-orders/${historicalId}/pdf`, {
      headers: authorization(fixture.token)
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.match(body.error, /Google Drive/i);
    assert.match(body.error, /Nenhum PDF foi recriado/i);
    assert.equal(
      fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').length,
      renderCallsBeforeDownload,
      'historical download must never invoke the PDF generator'
    );
    assert.equal(
      fixture.pythonDouble.calls.some(call => call.script === 'service_order_drive.py' && call.args[0] === 'find' && call.args[1] === historicalFilename),
      true,
      'historical download must look for the original Drive file'
    );
  });

  await t.test('redirects an old order to its existing Drive original without regenerating', async () => {
    const historicalId = 'SIGNED_OS_COM_DRIVE_20260820_120000';
    const driveUrl = 'https://drive.google.com/file/d/historic-file-id/view';
    const historicalFilename = `${historicalId}.pdf`;
    const historicalPath = path.join(pdfDirectory, historicalFilename);
    fs.mkdirSync(pdfDirectory, { recursive: true });
    fs.writeFileSync(historicalPath, Buffer.from('%PDF-1.4\n% stale local historical copy\n', 'ascii'));
    generatedFiles.push(historicalPath);
    fixture.supabaseDouble.records.set(historicalId, {
      id: historicalId,
      status: 'signed',
      technician_name: 'Teste Admin',
      form_data: { Cliente: 'Cliente Drive', Nome_Tecnico: 'Teste Admin' },
      pdf_filename: historicalFilename,
      pdf_url: driveUrl
    });
    const renderCallsBeforeDownload = fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').length;

    const response = await fetch(`${fixture.baseUrl}/api/service-orders/${historicalId}/pdf`, {
      headers: authorization(fixture.token),
      redirect: 'manual'
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), driveUrl);
    assert.equal(
      fixture.pythonDouble.calls.filter(call => call.script === 'service_order_pdf.py').length,
      renderCallsBeforeDownload,
      'Drive redirect must not invoke the PDF generator'
    );
  });
});
