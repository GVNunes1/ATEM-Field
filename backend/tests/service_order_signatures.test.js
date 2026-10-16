const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII=';
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

function raster(kind, bytes) {
  return `data:image/${kind};base64,${bytes.toString('base64')}`;
}

function isolatedRoutes() {
  const previousDirectory = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'service-order-signatures-'));
  process.chdir(directory);
  const calls = [];
  const savedOrders = [];
  function execFileDouble() { throw new Error('Unexpected unmocked process.'); }
  execFileDouble[promisify.custom] = async (_command, args) => {
    const scriptIndex = args.findIndex(argument => String(argument).endsWith('.py'));
    const script = path.basename(args[scriptIndex]);
    const scriptArgs = args.slice(scriptIndex + 1);
    calls.push({ script, args: scriptArgs });
    if (script === 'service_order_pdf.py') {
      calls.at(-1).form = JSON.parse(fs.readFileSync(scriptArgs[0], 'utf8'));
      fs.writeFileSync(scriptArgs[1], '%PDF-1.4\n%%EOF\n');
      return { stdout: JSON.stringify({ success: true }), stderr: '' };
    }
    assert.equal(script, 'service_order_drive.py');
    return { stdout: JSON.stringify({ success: false, error: 'Isolated Drive double.' }), stderr: '' };
  };
  const replacements = [
    ['../dist/services/supabase', { supabaseAdmin: { from() { return {
      async upsert(order) { savedOrders.push(order); return { error: null }; }
    }; } } }],
    ['../dist/security/authService', { requireAuthentication(_req, _res, next) { next(); } }]
  ];
  const originals = replacements.map(([name, exports]) => {
    const filename = require.resolve(name);
    const original = require.cache[filename];
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
    return [filename, original];
  });
  const originalExecFile = childProcess.execFile;
  childProcess.execFile = execFileDouble;
  const filename = require.resolve('../dist/routes/serviceOrders');
  delete require.cache[filename];
  let router;
  try {
    router = require(filename).default;
  } finally {
    childProcess.execFile = originalExecFile;
    for (const [modulePath, original] of originals) {
      if (original) require.cache[modulePath] = original;
      else delete require.cache[modulePath];
    }
  }
  return {
    calls, savedOrders,
    async generate(route, form) {
      const handler = router.stack.find(layer => layer.route?.path === route && layer.route.methods.post).route.stack[0].handle;
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        send(body) { this.body = body; return this; },
        set() { return this; }, type() { return this; }, attachment() { return this; }
      };
      await handler({ body: { form_data: { Cliente: 'Cliente Teste', Nome_Tecnico: 'Teste Admin', ...form } },
        user: { role: 'admin', name: 'Teste Admin' } }, response);
      return response;
    },
    close() {
      process.chdir(previousDirectory);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test('signature images are validated before either route invokes the renderer', async t => {
  const fixture = isolatedRoutes();
  t.after(() => fixture.close());
  const oversizedDimensions = Buffer.from(png.split(',')[1], 'base64');
  oversizedDimensions.writeUInt32BE(4097, 16);
  const oversizedPixels = Buffer.from(png.split(',')[1], 'base64');
  oversizedPixels.writeUInt32BE(4096, 16);
  oversizedPixels.writeUInt32BE(4096, 20);
  const attacks = [
    'http://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/private',
    'file:///etc/passwd', 'file:///C:/Windows/win.ini', '//localhost/private', '../secret.png',
    'javascript:alert(1)', 'data:image/svg+xml;base64,' + Buffer.from('<svg><image href="http://127.0.0.1/private"/></svg>').toString('base64'),
    raster('png', Buffer.from('<svg><image href="file:///etc/passwd"/></svg>')),
    raster('jpeg', Buffer.from('<svg/>')), png.replace('image/png', 'image/jpeg'),
    png.replace('image/png', 'image/gif'), png.replace(';base64,', ';charset=utf-8;base64,'),
    png + '\n', png.replace(/=$/, ''), 'data:image/png;base64,!!!!', 'data:image/png;base64,AB==',
    raster('png', Buffer.from(png.split(',')[1], 'base64').subarray(0, -12)),
    raster('jpeg', Buffer.from(jpeg.split(',')[1], 'base64').subarray(0, -2)),
    raster('png', oversizedDimensions), raster('png', oversizedPixels),
    raster('png', Buffer.alloc(1024 * 1024 + 1)), 0, false, {}, []
  ];
  for (const route of ['/generate', '/generate-local']) {
    for (const field of ['Assinatura_Tecnico', 'Assinatura_Cliente']) {
      await t.test(`${route} rejects unsafe ${field} without process or persistence calls`, async () => {
        for (const [index, attack] of attacks.entries()) {
          const callsBefore = fixture.calls.length;
          const savedBefore = fixture.savedOrders.length;
          const response = await fixture.generate(route, { [field]: attack });
          assert.equal(response.statusCode, 400, `attack ${index}`);
          assert.equal(response.body.success, false, `attack ${index}`);
          assert.match(response.body.error, new RegExp(field));
          assert.equal(fixture.calls.length, callsBefore, `attack ${index} must never start Python`);
          assert.equal(fixture.savedOrders.length, savedBefore, `attack ${index} must never save an order`);
        }
      });
    }
    await t.test(`${route} preserves PNG, JPEG and blank signatures`, async () => {
      const originalWarn = console.warn;
      console.warn = () => {};
      try {
        for (const signatures of [
          { Assinatura_Tecnico: png, Assinatura_Cliente: jpeg },
          {}, { Assinatura_Tecnico: '', Assinatura_Cliente: null }
        ]) {
          const response = await fixture.generate(route, signatures);
          assert.equal(response.statusCode, 200);
          const renderedForm = fixture.calls.filter(call => call.script === 'service_order_pdf.py').at(-1).form;
          assert.equal(renderedForm.Assinatura_Tecnico, signatures.Assinatura_Tecnico || '');
          assert.equal(renderedForm.Assinatura_Cliente, signatures.Assinatura_Cliente || '');
          if (route === '/generate') assert.equal(response.body.order.status, signatures.Assinatura_Tecnico ? 'signed' : 'unsigned');
          else assert.equal(response.body.subarray(0, 5).toString('ascii'), '%PDF-');
        }
      } finally { console.warn = originalWarn; }
    });
  }
});
