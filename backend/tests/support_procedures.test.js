const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getBestSupportMatch, renderSupportProcedure } = require('../dist/services/supportRag');

const cases = [
  ['como reservar um carro?', 'reserve-vehicle'],
  ['como retirar um carro?', 'checkout-vehicle'],
  ['como devolver um carro?', 'return-vehicle'],
  ['como reservar um padrão?', 'reserve-analyzer'],
  ['como retirar um padrão?', 'checkout-analyzer'],
  ['google agenda não sincroniza', 'google-sync'],
  ['como encaminhar no workflow?', 'workflow'],
  ['não consigo entrar', 'login'],
  ['como saber se um atendimento está pronto para sair?', 'readiness'],
  ['onde vejo alertas de agendamento?', 'operational-alerts'],
  ['quem alterou o atendimento?', 'appointment-timeline']
];

for (const [question, sourceId] of cases) {
  test(`encontra o procedimento para: ${question}`, () => {
    const match = getBestSupportMatch(question);
    assert.equal(match?.source.id, sourceId);
    const answer = renderSupportProcedure(match);
    assert.match(answer, /Passo a passo:\n1\./);
    assert.ok(answer.length > match.answer.length);
  });
}

test('não inventa procedimento quando não há fonte', () => {
  assert.equal(getBestSupportMatch('qual é a tolerância de calibração do monitor XP-917?'), null);
});

test('preserva avisos operacionais na resposta', () => {
  const answer = renderSupportProcedure(getBestSupportMatch('google agenda não sincroniza'));
  assert.match(answer, /Não recrie o evento/);
});
