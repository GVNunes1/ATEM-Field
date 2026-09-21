const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { roleFromSpecialty, canTransitionWorkflow } = require('../dist/security/roles');
let profile = { id: 77, name: 'Fixture', role: 'Supervisor', status: 'Ativo' };
let lookupError = false;
const modulePath = require.resolve('../dist/services/supabase');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { supabaseAdmin: {
  from: table => {
    assert.equal(table, 'technicians');
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: profile, error: lookupError ? new Error('offline fixture') : null }) };
    return query;
  },
} } };
const { AuthService, requireAuthentication, requireRole, requireManagement } = require('../dist/security/authService');

test('Administrator-maintained specialties map to operational roles without admin escalation', () => {
  for (const [title, role] of [['Supervisor', 'supervisor'], ['supervisora técnica', 'supervisor'], [' Gerente Comercial ', 'manager'], ['Comercial', 'commercial'], ['COMERCIAL EXTERNO', 'commercial'], ['Técnico', 'technician'], ['admin', 'technician'], ['Auxiliar do gerente', 'technician']]) assert.equal(roleFromSpecialty(title), role);
  assert.equal(canTransitionWorkflow('commercial', 'Data provisória', 'Aguardando validação do supervisor'), true);
  assert.equal(canTransitionWorkflow('commercial', 'Aguardando validação do supervisor', 'Validado pelo supervisor'), false);
  assert.equal(canTransitionWorkflow('supervisor', 'Aguardando validação do supervisor', 'Validado pelo supervisor'), true);
  assert.equal(canTransitionWorkflow('supervisor', 'Validado pelo supervisor', 'Confirmado com cliente'), false);
  assert.equal(canTransitionWorkflow('commercial', 'Validado pelo supervisor', 'Confirmado com cliente'), true);
  assert.equal(canTransitionWorkflow('manager', 'Data provisória', 'Confirmado com cliente'), true);
});

test('Existing sessions receive current permissions; demotions, inactive profiles and lookup failures fail closed', async () => {
  const app = express();
  app.get('/manage', requireAuthentication, requireManagement, (req, res) => res.json({ role: req.user.role }));
  app.get('/admin', requireAuthentication, requireRole(['admin']), (_req, res) => res.json({ success: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const token = AuthService.generateSessionToken({ id: 77, name: 'Fixture', role: 'technician' });
  const call = route => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    assert.equal((await call('/manage')).status, 200);
    assert.equal((await call('/admin')).status, 403);
    profile.role = 'Gerente';
    assert.equal((await (await call('/manage')).json()).role, 'manager');
    profile.role = 'Comercial';
    assert.equal((await call('/manage')).status, 403);
    profile.role = 'Técnico';
    assert.equal((await call('/manage')).status, 403);
    profile.status = 'Inativo';
    assert.equal((await call('/manage')).status, 401);
    profile.status = 'Ativo'; lookupError = true;
    assert.equal((await call('/manage')).status, 503);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
