const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCalendarInsert } = require('../dist/services/calendarMapping');
const { createCalendarAppointment, listWritableCalendars } = require('../dist/services/calendarSyncEngine');

const technicians = [
  { id: 1, name: 'Ana Fixture' },
  { id: 2, name: 'Bruno Fixture' }
];

test('buildCalendarInsert creates valid Google Calendar event payload and [ATEM FIELD] technician block', () => {
  const input = {
    title: 'Manutenção Preventiva - US Affiniti 70',
    client_name: 'Hospital São Lucas',
    client_address: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP',
    appointment_date: '2026-10-15',
    appointment_time: '09:00',
    appointment_end_date: '2026-10-15',
    appointment_end_time: '12:00',
    all_day: false,
    technician_ids: [1, 2],
    notes: 'Realizar backup antes da preventiva.',
    calendar_id: 'tecnicosmultmed@gmail.com'
  };

  const { values, eventPatch, calendarId } = buildCalendarInsert(input, technicians);

  assert.equal(calendarId, 'tecnicosmultmed@gmail.com');
  assert.equal(eventPatch.summary, 'Manutenção Preventiva - US Affiniti 70');
  assert.equal(eventPatch.location, 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP');
  assert.equal(eventPatch.extendedProperties.private.atem_client_name, 'Hospital São Lucas');
  assert.ok(eventPatch.description.includes('Realizar backup antes da preventiva.'));
  assert.ok(eventPatch.description.includes('[ATEM FIELD]\nTécnicos: Ana Fixture, Bruno Fixture\n[/ATEM FIELD]'));
  assert.deepEqual(eventPatch.start, { dateTime: '2026-10-15T09:00:00', timeZone: 'America/Sao_Paulo' });
  assert.deepEqual(eventPatch.end, { dateTime: '2026-10-15T12:00:00', timeZone: 'America/Sao_Paulo' });
  assert.deepEqual(values.technician_ids, [1, 2]);
});

test('buildCalendarInsert rejects invalid dates and times', () => {
  assert.throws(() => buildCalendarInsert({
    title: 'Teste',
    appointment_date: 'invalid',
    appointment_end_date: '2026-10-15',
  }, technicians), /datas válidas/);

  assert.throws(() => buildCalendarInsert({
    title: 'Teste',
    appointment_date: '2026-10-15',
    appointment_time: '14:00',
    appointment_end_date: '2026-10-15',
    appointment_end_time: '10:00',
  }, technicians), /posterior ao início/);
});

test('listWritableCalendars returns Google calendars via python connector', async () => {
  const mockExecute = async (file, args) => {
    assert.equal(file, 'import_agenda.py');
    assert.deepEqual(args, ['--list-calendars']);
    return {
      success: true,
      calendars: [
        { id: 'tecnicosmultmed@gmail.com', name: 'Geral', writable: true, primary: true },
        { id: 'cal2@group.calendar.google.com', name: 'Contratos', writable: true, primary: false }
      ]
    };
  };

  const calendars = await listWritableCalendars(mockExecute);
  assert.equal(calendars.length, 2);
  assert.equal(calendars[0].id, 'tecnicosmultmed@gmail.com');
  assert.equal(calendars[0].primary, true);
});
