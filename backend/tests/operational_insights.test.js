const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildOperationalInsights } = require('../dist/services/operationalInsights');

const now = new Date('2026-09-28T12:00:00-03:00');
const appointment = {
  id: 1, title: 'Visita hospitalar', client_name: 'Hospital A',
  appointment_date: '2026-09-29', appointment_time: '08:00',
  workflow_status: 'Confirmado com cliente', technician_id: 7,
  technician_names: 'Ana', vehicle_id: 3, last_activity_at: now.toISOString()
};
const vehicles = [{ id: 3, name: 'Carro 3', plate: 'ABC-1234', status: 'Disponível' }];
const analyzers = [{ id: 9, calibration_expiry: '2026-10-30' }];
const reservations = [{ id: 4, appointment_id: 1, analyzer_id: 9, status: 'Reservado' }];

test('mostra atendimento pronto quando todos os recursos estão válidos', () => {
  const result = buildOperationalInsights([appointment], reservations, analyzers, vehicles, [], now);
  assert.equal(result.readiness[0].state, 'ready');
  assert.deepEqual(result.alerts, []);
});

test('alerta sobre padrão e carro faltantes em atendimento próximo', () => {
  const result = buildOperationalInsights([{ ...appointment, vehicle_id: null }], [], analyzers, vehicles, [], now);
  assert.equal(result.readiness[0].state, 'attention');
  assert.deepEqual(result.alerts.map(alert => alert.kind), ['vehicle', 'pattern']);
});

test('alerta sobre calibração vencida e carro ainda em uso em outra atividade', () => {
  const result = buildOperationalInsights([appointment], reservations,
    [{ id: 9, calibration_expiry: '2026-09-28' }], vehicles,
    [{ vehicle_id: 3, appointment_id: 2, status: 'Em Uso' }], now);
  assert.deepEqual(result.alerts.map(alert => alert.kind), ['vehicle', 'calibration']);
});

test('avisa após 48 horas sem mudança em fluxo provisório', () => {
  const result = buildOperationalInsights([{
    ...appointment, workflow_status: 'Data provisória', commercial_confirmed_at: null,
    last_activity_at: '2026-09-25T12:00:00-03:00'
  }], [], analyzers, vehicles, [], now);
  assert.ok(result.alerts.some(alert => alert.kind === 'stale'));
});

test('não produz pendências de carro e padrão para sobreaviso ou atendimento concluído', () => {
  const result = buildOperationalInsights([
    { ...appointment, title: 'Escala de sobreaviso', vehicle_id: null },
    { ...appointment, id: 2, workflow_status: 'Concluído', vehicle_id: null }
  ], [], analyzers, vehicles, [], now);
  assert.equal(result.readiness.length, 0);
  assert.equal(result.alerts.length, 0);
});
