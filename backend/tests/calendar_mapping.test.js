const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCalendarEdit, mapGoogleEvent, dateTimeParts } = require('../dist/services/calendarMapping');

const technicians = [{ id: 1, name: 'Ana Fixture' }, { id: 2, name: 'Bruno Fixture' }];
const form = overrides => ({
  title: 'Hospital', client_name: 'Cliente', client_address: 'Rua A',
  appointment_date: '2026-10-01', appointment_time: '08:00',
  appointment_end_date: '2026-10-01', appointment_end_time: '09:00',
  all_day: false, technician_ids: [1], ...overrides,
});
const baseline = form({ google_event: { description: 'Nota do cliente\nLink externo https://example.test/meeting' } });

test('Google timestamps map to Sao Paulo including midnight/day boundaries', () => {
  assert.deepEqual(dateTimeParts({ dateTime: '2026-10-01T02:30:00Z' }), { date: '2026-09-30', time: '23:30' });
  assert.deepEqual(dateTimeParts({ dateTime: '2026-10-01T03:00:00Z' }), { date: '2026-10-01', time: '00:00' });
  assert.deepEqual(dateTimeParts({ date: '2026-10-01' }), { date: '2026-10-01', time: '00:00' });
  assert.throws(() => dateTimeParts({ dateTime: 'invalid' }), /Horário Google inválido/);
});

test('no-op edit produces no Google patch and excludes unrelated event fields', () => {
  assert.deepEqual(buildCalendarEdit(form(), baseline, technicians).eventPatch, {});
  const changed = buildCalendarEdit(form({ title: 'Novo título' }), baseline, technicians).eventPatch;
  assert.deepEqual(changed, { summary: 'Novo título' });
  assert.deepEqual(buildCalendarEdit(form({ client_address: 'Rua B' }), baseline, technicians).eventPatch, { location: 'Rua B' });
  for (const protectedField of ['attendees', 'organizer', 'recurrence', 'attachments', 'conferenceData', 'reminders']) {
    assert.equal(changed[protectedField], undefined);
  }
});

test('team patch preserves notes/meeting link and replaces only its managed block', () => {
  const previous = { ...baseline, google_event: { description: `${baseline.google_event.description}\n\n[ATEM FIELD]\nTécnicos: Ana Fixture\n[/ATEM FIELD]` } };
  const { eventPatch } = buildCalendarEdit(form({ technician_ids: [2] }), previous, technicians);
  assert.equal(eventPatch.description, `${baseline.google_event.description}\n\n[ATEM FIELD]\nTécnicos: Bruno Fixture\n[/ATEM FIELD]`);
  const mapped = mapGoogleEvent({ summary: 'Hospital', start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, description: eventPatch.description }, technicians);
  assert.deepEqual(mapped.team, [2]);
});

test('all-day end is exclusive; timed edits use explicit Sao Paulo timezone', () => {
  const allDay = buildCalendarEdit(form({ all_day: true, appointment_end_date: '2026-10-02' }), baseline, technicians);
  assert.deepEqual(allDay.eventPatch.start, { date: '2026-10-01' });
  assert.deepEqual(allDay.eventPatch.end, { date: '2026-10-02' });
  assert.equal(allDay.values.appointment_time, '00:00');
  const timed = buildCalendarEdit(form({ appointment_time: '08:30' }), baseline, technicians);
  assert.deepEqual(timed.eventPatch.start, { dateTime: '2026-10-01T08:30:00', timeZone: 'America/Sao_Paulo' });
  assert.throws(() => buildCalendarEdit(form({ all_day: true }), baseline, technicians), /posterior/);
});

test('invalid dates, times, reversed intervals and unknown technicians are rejected', () => {
  for (const invalid of [
    { appointment_date: '2026-02-30' }, { appointment_end_date: 'invalid' },
    { appointment_time: '24:00' }, { appointment_end_time: '07:59' },
    { technician_ids: [999] }, { technician_ids: ['1'] }, { technician_ids: [-1] },
    { title: '' }, { all_day: 'false' },
  ]) assert.throws(() => buildCalendarEdit(form(invalid), baseline, technicians));
});

test('Google all-day metadata maps without changing exclusive end; cancellation requires no dates', () => {
  const mapped = mapGoogleEvent({ summary: 'Hospital', location: 'Rua B',
    start: { date: '2026-10-01' }, end: { date: '2026-10-03' },
    extendedProperties: { private: { atem_client_name: 'Cliente correto' } },
  }, technicians);
  assert.equal(mapped.values.all_day, true);
  assert.equal(mapped.values.appointment_end_date, '2026-10-03');
  assert.equal(mapped.values.client_name, 'Cliente correto');
  assert.deepEqual(mapGoogleEvent({ id: 'deleted', status: 'cancelled' }, technicians), { values: {}, team: [] });
});
