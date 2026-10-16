const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const scripts = [
  '.agents/auditor_m2m3_1/audit_db.js',
  '.agents/challenger_m1_1/test_m1_schema.js',
  '.agents/challenger_m1_1/test_sequence_collision.js',
  '.agents/challenger_m2m3_1/test_edge_cases.js',
  '.agents/challenger_m2m3_1/test_query.js',
  '.agents/challenger_m2m3_2/test_sequence.js',
];

for (const relativePath of scripts) {
  test(`${relativePath} requires credentials before initializing Supabase`, () => {
    const filename = path.join(root, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const stopBeforeDatabaseAccess = new Error('client initialization intercepted');
    for (const value of [undefined, '', '   ', 'isolated-test-credential']) {
      let initialized = false;
      const context = {
        __dirname: path.dirname(filename),
        process: { env: value === undefined ? {} : { SUPABASE_SERVICE_ROLE_KEY: value } },
        require(id) {
          if (id.replace(/\\/g, '/').includes('@supabase/supabase-js')) {
            return { createClient(url, credential) {
              initialized = true;
              assert.equal(credential, value);
              assert.equal(typeof url, 'string');
              throw stopBeforeDatabaseAccess;
            } };
          }
          // Do not load the ignored local .env or ever run a database query.
          if (id.includes('dotenv')) return { config() {} };
          if (id === 'path' || id === 'fs') return require(id);
          throw new Error(`Unexpected dependency: ${id}`);
        },
      };
      if (value === 'isolated-test-credential') {
        assert.throws(() => vm.runInNewContext(source, context, { filename }), error => error === stopBeforeDatabaseAccess);
        assert.equal(initialized, true);
      } else {
        assert.throws(() => vm.runInNewContext(source, context, { filename }), /SUPABASE_SERVICE_ROLE_KEY is required/);
        assert.equal(initialized, false);
      }
    }
  });
}

test('the eight finding files contain no embedded service_role JWT', () => {
  for (const relativePath of [...scripts, '.agents/explorer_survey_3/survey_spec.md', '.agents/reviewer_m2m3_1/handoff.md']) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const tokens = source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
    for (const token of tokens) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      assert.equal(payload.role === 'service_role', false, relativePath);
    }
  }
});

function loadCallback(adapter, { exchangeError } = {}) {
  const packageRequire = createRequire(path.join(root, `${adapter}-mcp-oauth/package.json`));
  const ts = packageRequire('typescript');
  const trace = [];
  const oauth = {
    verifyAndConsumeOAuthState(...args) {
      trace.push(['state', ...args]);
      return args.at(-1) === 'valid-state' ? { redirectUri: 'https://example.invalid/auth/callback' } : null;
    },
    async exchangeCodeForToken(...args) {
      trace.push(['exchange', ...args]);
      if (exchangeError) throw exchangeError;
      return 'isolated-token';
    },
    async fetchUserProfile(...args) { trace.push(['profile', ...args]); return { id: 'fixture', name: 'Fixture User' }; },
    createSession(...args) { trace.push(['session', ...args]); return { sessionId: 'isolated-session' }; },
  };
  const relativePath = {
    vercel: 'vercel-mcp-oauth/app/auth/callback/route.ts',
    render: 'render-mcp-oauth/src/server.ts',
    cloudflare: 'cloudflare-mcp-oauth/src/index.ts',
  }[adapter];
  const filename = path.join(root, relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  let app;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    process: { env: {} },
    URL,
    URLSearchParams,
    Response,
    console: { log() {} },
    require(id) {
      if (id.includes('oauth-store') || id.includes('oauth-helper')) return oauth;
      if (id.includes('mcp-server')) return {};
      if (id.includes('@modelcontextprotocol/')) return {};
      if (id === 'dotenv') return { config() {} };
      if (id === 'express') {
        const express = packageRequire('express');
        const factory = () => {
          app = express();
          // Registration is allowed, but this isolated test never opens sockets.
          app.listen = () => {};
          return app;
        };
        factory.json = express.json;
        return factory;
      }
      if (id === 'hono') {
        const { Hono } = packageRequire('hono');
        return { Hono: class extends Hono { constructor(...args) { super(...args); app = this; } } };
      }
      return packageRequire(id);
    },
  }, { filename });

  return {
    trace,
    async request(query) {
      trace.length = 0;
      const url = `https://example.invalid/auth/callback?${query}`;
      if (adapter === 'vercel') {
        const { NextRequest } = packageRequire('next/server');
        return exports.GET(new NextRequest(url));
      }
      if (adapter === 'cloudflare') return app.request(url, {}, { OAUTH_KV: {} });
      const handler = app._router.stack.find(layer => layer.route?.path === '/auth/callback').route.stack[0].handle;
      const req = { query: app.get('query parser fn')(query) };
      let result;
      const res = {
        statusCode: 200,
        status(value) { this.statusCode = value; return this; },
        send(body) { result = new Response(body, { status: this.statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); return this; },
      };
      await handler(req, res);
      return result;
    },
  };
}

for (const adapter of ['vercel', 'render', 'cloudflare']) {
  test(`${adapter} callback never reflects OAuth query errors into HTML`, async () => {
    const callback = loadCallback(adapter);
    const payloads = [
      '<script>alert(document.domain)</script>',
      '</h2><img src=x onerror=alert(1)>',
      '%3Csvg%20onload%3Dalert(1)%3E',
      'access_denied',
    ];
    const queries = payloads.map(error => new URLSearchParams({ error }).toString());
    queries.push(new URLSearchParams([['error', 'access_denied'], ['error', payloads[0]]]).toString());
    if (adapter === 'render') queries.push(`error[html]=${encodeURIComponent(payloads[0])}`);
    for (const query of queries) {
      const response = await callback.request(query);
      assert.equal(response.status, 400);
      assert.match(response.headers.get('content-type'), /^text\/html\b/);
      assert.equal(await response.text(), '<h2>Falha na autenticação OAuth. Tente novamente.</h2>');
      assert.deepEqual(callback.trace, []);
    }
  });

  test(`${adapter} callback preserves missing parameters, invalid state, and successful exchange`, async () => {
    const callback = loadCallback(adapter);
    const missing = await callback.request('');
    assert.equal(missing.status, 400);
    assert.deepEqual(callback.trace, []);

    const invalid = await callback.request('code=fixture-code&state=invalid-state');
    assert.equal(invalid.status, 403);
    assert.deepEqual(callback.trace.map(call => call[0]), ['state']);

    const successful = await callback.request('code=fixture-code&state=valid-state');
    assert.equal(successful.status, 200);
    assert.match(await successful.text(), /Authorization: Bearer isolated-session/);
    assert.deepEqual(callback.trace.map(call => call[0]), ['state', 'exchange', 'profile', 'session']);
    const exchangeArgs = callback.trace[1].slice(1);
    assert.deepEqual(exchangeArgs.slice(-2), ['fixture-code', 'https://example.invalid/auth/callback']);
  });

  test(`${adapter} callback never reflects provider exchange errors into HTML`, async () => {
    const payloads = ['<script>alert(1)</script>', '</h2><img src=x onerror=alert(1)>'];
    for (const payload of payloads) {
      const callback = loadCallback(adapter, { exchangeError: new Error(`OAuth provider failure: ${payload}`) });
      const response = await callback.request('code=fixture-code&state=valid-state');
      assert.equal(response.status, 500);
      assert.match(response.headers.get('content-type'), /^text\/html\b/);
      assert.equal(await response.text(), '<h2>Falha no processamento OAuth. Tente novamente.</h2>');
      assert.deepEqual(callback.trace.map(call => call[0]), ['state', 'exchange']);
    }
  });
}
