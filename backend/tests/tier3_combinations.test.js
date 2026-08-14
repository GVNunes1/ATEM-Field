const { apiFetch, assert, assertEqual, assertNotNull, getSupabaseClient, trackTechnician, trackAnalyzer, trackReservation, isNonTechnicalAppointment } = require('./helpers');

async function createReservationFixture(label) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const technicianResponse = await apiFetch('/api/technicians', {
    method: 'POST',
    body: {
      name: `E2E ${label} Technician ${suffix}`,
      phone: '11990001111',
      email: `e2e-${label.toLowerCase().replaceAll(' ', '-')}-${suffix}@atem.test`,
      role: 'Técnico de Campo'
    }
  });
  assertEqual(technicianResponse.status, 200, `Could not create E2E technician for ${label}`);
  assertNotNull(technicianResponse.data.id, `E2E technician for ${label} must have an ID`);
  trackTechnician(technicianResponse.data.id);

  const analyzerResponse = await apiFetch('/api/analyzers', {
    method: 'POST',
    body: {
      asset_tag: `PAT-WF-${suffix}`,
      name: `E2E ${label} Analyzer ${suffix}`,
      type: 'Analisador de Desfibrilador',
      serial_number: `E2E-${suffix}`,
      brand_model: 'E2E Test Fixture',
      notes: `E2E ${label} isolated test fixture`
    }
  });
  assertEqual(analyzerResponse.status, 200, `Could not create E2E analyzer for ${label}`);
  assertNotNull(analyzerResponse.data.id, `E2E analyzer for ${label} must have an ID`);
  trackAnalyzer(analyzerResponse.data.id);

  return { technicianId: technicianResponse.data.id, analyzerId: analyzerResponse.data.id };
}

async function findPortalAppointmentFixture(client) {
  const today = new Date();
  const finalDate = new Date(today);
  finalDate.setUTCDate(finalDate.getUTCDate() + 44);
  const fromDate = today.toISOString().slice(0, 10);
  const toDate = finalDate.toISOString().slice(0, 10);

  const { data: appointments, error: appointmentError } = await client
    .from('appointments')
    .select('id, appointment_date, appointment_time, title, client_name')
    .gte('appointment_date', fromDate)
    .lte('appointment_date', toDate)
    .order('appointment_date')
    .order('appointment_time')
    .limit(100);
  if (appointmentError) throw appointmentError;
  const filteredTechnicalAppts = (appointments || []).filter(a => !isNonTechnicalAppointment(a));
  const appointmentIds = filteredTechnicalAppts.map(item => item.id);
  assert(appointmentIds.length > 0, 'No appointment available in the technician portal date window');

  const { data: equipments, error: equipmentError } = await client
    .from('appointment_equipments')
    .select('appointment_id, category_id')
    .in('appointment_id', appointmentIds)
    .not('category_id', 'is', null);
  if (equipmentError) throw equipmentError;
  const categoryIds = [...new Set((equipments || []).map(item => item.category_id))];
  assert(categoryIds.length > 0, 'No categorized equipment available in the technician portal date window');

  const { data: templates, error: templateError } = await client
    .from('test_templates')
    .select('category_id, analyzer_type')
    .in('category_id', categoryIds)
    .eq('is_mandatory', 1);
  if (templateError) throw templateError;
  const templatesByCategory = new Map();
  for (const template of templates || []) {
    const categoryTemplates = templatesByCategory.get(template.category_id) || [];
    categoryTemplates.push(template.analyzer_type);
    templatesByCategory.set(template.category_id, categoryTemplates);
  }

  const appointmentById = new Map((appointments || []).map(item => [item.id, item]));
  const candidates = [];
  const seenCandidates = new Set();
  for (const equipment of equipments || []) {
    for (const analyzerType of templatesByCategory.get(equipment.category_id) || []) {
      const key = `${equipment.appointment_id}|${analyzerType}`;
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      candidates.push({
        ...appointmentById.get(equipment.appointment_id),
        appointmentId: equipment.appointment_id,
        analyzerType
      });
    }
  }

  const targetFollowsSource = (source, target) => {
    if (target.appointment_date !== source.appointment_date) {
      return target.appointment_date > source.appointment_date;
    }
    if (!source.appointment_time || !target.appointment_time) return true;
    return target.appointment_time >= source.appointment_time;
  };
  const source = candidates.find(candidate => candidates.some(target => (
    target.appointmentId !== candidate.appointmentId
      && target.analyzerType === candidate.analyzerType
      && targetFollowsSource(candidate, target)
  )));
  assertNotNull(source, 'No pair of compatible appointments was found for portal rescheduling');
  const target = candidates.find(candidate => (
    candidate.appointmentId !== source.appointmentId
      && candidate.analyzerType === source.analyzerType
      && targetFollowsSource(source, candidate)
  ));
  assertNotNull(target, 'No compatible target appointment was found for portal rescheduling');
  return {
    appointmentId: source.appointmentId,
    targetAppointmentId: target.appointmentId,
    targetAppointmentDate: target.appointment_date,
    analyzerType: source.analyzerType
  };
}

async function runTier3Tests() {
  const results = [];
  const record = (name, passed, detail = '') => results.push({ name, passed, detail });

  try {
    const response = await apiFetch('/api/appointments/1/checklist');
    assertEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    assert(response.data.success === true, 'Expected success: true');
    assertNotNull(response.data.appointment, 'Expected appointment object');
    assert(Array.isArray(response.data.equipments), 'Expected equipments array');
    assert(Array.isArray(response.data.testTemplates), 'Expected testTemplates array');
    assert(Array.isArray(response.data.requiredAnalyzerTypes), 'Expected requiredAnalyzerTypes array');
    assertNotNull(response.data.availableAnalyzersGrouped, 'Expected availableAnalyzersGrouped object');
    assert(Array.isArray(response.data.existingReservations), 'Expected existingReservations array');
    record('Appointment checklist generation (/api/appointments/:id/checklist)', true, `Generated checklist for appointment #1 with ${response.data.equipments.length} equipments and ${response.data.testTemplates.length} templates`);
  } catch (error) {
    record('Appointment checklist generation (/api/appointments/:id/checklist)', false, error.message);
  }

  try {
    const response = await apiFetch('/api/appointments/999999/checklist');
    assertEqual(response.status, 404, `Expected HTTP 404, got ${response.status}`);
    assert(response.data.success === false, 'Expected success: false');
    assert(response.data.error.includes('Atendimento não encontrado'), 'Expected 404 error message');
    record('Checklist request for non-existent appointment ID', true, `Handled 404 correctly: "${response.data.error}"`);
  } catch (error) {
    record('Checklist request for non-existent appointment ID', false, error.message);
  }

  try {
    const fixture = await createReservationFixture('Tier 3 lifecycle');
    const client = getSupabaseClient();
    const { data: appts } = await client.from('appointments').select('id, title, client_name');
    const techAppt = (appts || []).find(a => !isNonTechnicalAppointment(a));
    const apptId = techAppt ? techAppt.id : 3;

    const createResponse = await apiFetch('/api/reservations', {
      method: 'POST',
      body: {
        appointment_id: apptId,
        analyzer_id: fixture.analyzerId,
        technician_id: fixture.technicianId,
        notes: 'E2E Tier 3 Reservation Lifecycle Test'
      }
    });
    assertEqual(createResponse.status, 200, `Expected HTTP 200 on reservation creation, got ${createResponse.status}`);
    assert(createResponse.data.success === true, 'Expected reservation creation success');
    assertNotNull(createResponse.data.reservationId, 'Expected reservation ID');
    trackReservation(createResponse.data.reservationId);

    const checkoutResponse = await apiFetch(`/api/reservations/${createResponse.data.reservationId}/checkout`, { method: 'POST' });
    assertEqual(checkoutResponse.status, 200, 'Expected checkout to succeed');
    const checkinResponse = await apiFetch(`/api/reservations/${createResponse.data.reservationId}/checkin`, { method: 'POST' });
    assertEqual(checkinResponse.status, 200, 'Expected checkin to succeed');

    const analyzersResponse = await apiFetch('/api/analyzers');
    const analyzer = analyzersResponse.data.analyzers.find((item) => item.id === fixture.analyzerId);
    assertNotNull(analyzer, 'Isolated E2E analyzer should exist');
    assertEqual(analyzer.status, 'Disponível', `Analyzer status should be restored to Disponível, got ${analyzer.status}`);
    record('Reservation Checkout/Checkin lifecycle', true, `Reservation #${createResponse.data.reservationId} completed on isolated E2E data`);
  } catch (error) {
    record('Reservation Checkout/Checkin lifecycle', false, error.message);
  }

  try {
    const fixture = await createReservationFixture('Tier 3 conflict');
    const client = getSupabaseClient();
    const { data: allAppts } = await client.from('appointments').select('id, title, client_name, appointment_date');
    const byDate = new Map();
    for (const a of allAppts || []) {
      if (!isNonTechnicalAppointment(a)) {
        const list = byDate.get(a.appointment_date) || [];
        list.push(a.id);
        byDate.set(a.appointment_date, list);
      }
    }
    const sameDatePair = [...byDate.values()].find(list => list.length >= 2);
    const appt1 = sameDatePair ? sameDatePair[0] : 9384;
    const appt2 = sameDatePair ? sameDatePair[1] : 1737;

    const firstReservation = await apiFetch('/api/reservations', {
      method: 'POST',
      body: {
        appointment_id: appt1,
        analyzer_id: fixture.analyzerId,
        technician_id: fixture.technicianId,
        notes: 'E2E Reservation Conflict Initial'
      }
    });
    assertEqual(firstReservation.status, 200, `Expected initial reservation HTTP 200, got ${firstReservation.status}`);
    assertNotNull(firstReservation.data.reservationId, 'Expected initial reservation ID');
    trackReservation(firstReservation.data.reservationId);

    const duplicateReservation = await apiFetch('/api/reservations', {
      method: 'POST',
      body: {
        appointment_id: appt2,
        analyzer_id: fixture.analyzerId,
        technician_id: fixture.technicianId,
        notes: 'E2E Reservation Conflict Duplicate Attempt'
      }
    });
    assertEqual(duplicateReservation.status, 400, `Expected HTTP 400 for duplicate active reservation, got ${duplicateReservation.status}`);
    assert(duplicateReservation.data.success === false, 'Expected success: false');
    assert(duplicateReservation.data.error.includes('já está reservado/em uso'), 'Expected conflict error message');
    record('Reservation conflict prevention (double booking)', true, `Correctly blocked conflict reservation with HTTP 400: "${duplicateReservation.data.error}"`);
  } catch (error) {
    record('Reservation conflict prevention (double booking)', false, error.message);
  }

  try {
    const client = getSupabaseClient();
    const portalTarget = await findPortalAppointmentFixture(client);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const technicianResponse = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: `E2E Portal Multi Technician ${suffix}`,
        phone: '11981112222',
        email: `e2e-portal-multi-${suffix}@atem.test`,
        role: 'Técnico de Campo'
      }
    });
    assertEqual(technicianResponse.status, 200, 'Portal fixture technician creation should succeed');
    const technicianId = technicianResponse.data.id;
    trackTechnician(technicianId);

    const { error: linkError } = await client.from('appointment_technicians').insert([
      {
        appointment_id: portalTarget.appointmentId,
        technician_id: technicianId
      },
      {
        appointment_id: portalTarget.targetAppointmentId,
        technician_id: technicianId
      }
    ]);
    if (linkError) throw linkError;

    const analyzerIds = [];
    for (const variant of ['A', 'B']) {
      const analyzerResponse = await apiFetch('/api/analyzers', {
        method: 'POST',
        body: {
          asset_tag: `PAT-WF-${suffix}-${variant}`,
          name: `E2E Portal Multi ${variant} ${suffix}`,
          type: portalTarget.analyzerType,
          serial_number: `E2E-PORTAL-${suffix}-${variant}`,
          brand_model: 'E2E Portal Multiple Reservations',
          notes: 'E2E portal multiple reservation fixture'
        }
      });
      assertEqual(analyzerResponse.status, 200, `Portal analyzer ${variant} creation should succeed`);
      analyzerIds.push(analyzerResponse.data.id);
      trackAnalyzer(analyzerResponse.data.id);
    }

    const linkResponse = await apiFetch(`/api/technicians/${technicianId}/portal-link`);
    assertEqual(linkResponse.status, 200, 'Portal link generation should succeed');
    const portalUrl = new URL(linkResponse.data.portal_url);
    const accessToken = new URLSearchParams(portalUrl.hash.slice(1)).get('access');
    assert(accessToken, 'Portal access token should be present in generated link');
    const portalHeaders = { Authorization: `Bearer ${accessToken}` };

    const reservationIds = [];
    for (const analyzerId of analyzerIds) {
      const reservationResponse = await apiFetch('/api/technician-portal/reservations', {
        method: 'POST',
        headers: portalHeaders,
        body: { appointment_id: portalTarget.appointmentId, analyzer_id: analyzerId }
      });
      assertEqual(reservationResponse.status, 201, 'Each analyzer of the same type should be reservable');
      reservationIds.push(reservationResponse.data.reservationId);
      trackReservation(reservationResponse.data.reservationId);
    }

    const inUseResponse = await apiFetch(`/api/reservations/${reservationIds[1]}/checkout`, { method: 'POST' });
    assertEqual(inUseResponse.status, 200, 'Second portal reservation should enter in-use custody');

    const dashboardResponse = await apiFetch('/api/technician-portal?days=45', { headers: portalHeaders });
    assertEqual(dashboardResponse.status, 200, 'Technician dashboard should load after multiple reservations');
    const appointment = dashboardResponse.data.appointments.find(item => item.id === portalTarget.appointmentId);
    assertNotNull(appointment, 'Linked appointment should be visible in technician dashboard');
    const requirement = appointment.analyzerRequirements.find(item => item.analyzerType === portalTarget.analyzerType);
    assertNotNull(requirement, 'Matching analyzer requirement should be visible');
    assertEqual(requirement.existingReservations.length, 2, 'Requirement should expose both active reservations');

    const otherTechnicianResponse = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: `E2E Portal Return Guard ${suffix}`,
        phone: '11983334444',
        email: `e2e-portal-guard-${suffix}@atem.test`,
        role: 'Técnico de Campo'
      }
    });
    assertEqual(otherTechnicianResponse.status, 200, 'Return guard technician creation should succeed');
    trackTechnician(otherTechnicianResponse.data.id);
    const otherLinkResponse = await apiFetch(`/api/technicians/${otherTechnicianResponse.data.id}/portal-link`);
    const otherPortalUrl = new URL(otherLinkResponse.data.portal_url);
    const otherAccessToken = new URLSearchParams(otherPortalUrl.hash.slice(1)).get('access');
    const forbiddenReturn = await apiFetch(`/api/technician-portal/reservations/${reservationIds[0]}/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherAccessToken}` }
    });
    assertEqual(forbiddenReturn.status, 403, 'A technician must not return another technician reservation');

    const forbiddenReschedule = await apiFetch(`/api/technician-portal/reservations/${reservationIds[1]}/reschedule`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherAccessToken}` },
      body: { appointment_id: portalTarget.targetAppointmentId }
    });
    assertEqual(forbiddenReschedule.status, 403, 'A technician must not reschedule another technician reservation');

    const returnResponse = await apiFetch(`/api/technician-portal/reservations/${reservationIds[0]}/checkin`, {
      method: 'POST',
      headers: portalHeaders
    });
    assertEqual(returnResponse.status, 200, 'Technician return should succeed');
    assert(returnResponse.data.alreadyReturned === false, 'First return should update the reservation');

    const repeatReturn = await apiFetch(`/api/technician-portal/reservations/${reservationIds[0]}/checkin`, {
      method: 'POST',
      headers: portalHeaders
    });
    assertEqual(repeatReturn.status, 200, 'Repeated technician return should be idempotent');
    assert(repeatReturn.data.alreadyReturned === true, 'Repeated return should report alreadyReturned');

    const [{ data: returnedReservation }, { data: returnedAnalyzer }] = await Promise.all([
      client.from('reservations').select('status, checkin_at, checkin_date').eq('id', reservationIds[0]).single(),
      client.from('analyzers').select('status').eq('id', analyzerIds[0]).single()
    ]);
    assertEqual(returnedReservation.status, 'Devolvido', 'Portal return should close the reservation');
    assert(returnedReservation.checkin_at && returnedReservation.checkin_date, 'Portal return should record both check-in timestamps');
    assertEqual(returnedAnalyzer.status, 'Disponível', 'Returned analyzer should be available again');

    const rescheduleResponse = await apiFetch(`/api/technician-portal/reservations/${reservationIds[1]}/reschedule`, {
      method: 'POST',
      headers: portalHeaders,
      body: { appointment_id: portalTarget.targetAppointmentId }
    });
    assertEqual(rescheduleResponse.status, 200, 'Technician rescheduling should succeed without a return');
    assert(rescheduleResponse.data.alreadyScheduled === false, 'First rescheduling should move the reservation');
    assertEqual(rescheduleResponse.data.status, 'Em Uso', 'Rescheduling should preserve the in-use reservation status');

    const repeatReschedule = await apiFetch(`/api/technician-portal/reservations/${reservationIds[1]}/reschedule`, {
      method: 'POST',
      headers: portalHeaders,
      body: { appointment_id: portalTarget.targetAppointmentId }
    });
    assertEqual(repeatReschedule.status, 200, 'Repeated rescheduling to the same appointment should be idempotent');
    assert(repeatReschedule.data.alreadyScheduled === true, 'Repeated rescheduling should report alreadyScheduled');

    const [{ data: movedReservation }, { data: carriedAnalyzer }] = await Promise.all([
      client
        .from('reservations')
        .select('appointment_id, reserved_date, status, checkout_at, checkin_at, checkin_date, notes')
        .eq('id', reservationIds[1])
        .single(),
      client.from('analyzers').select('status').eq('id', analyzerIds[1]).single()
    ]);
    assertEqual(movedReservation.appointment_id, portalTarget.targetAppointmentId, 'Reservation should point to the target appointment');
    assertEqual(movedReservation.reserved_date, portalTarget.targetAppointmentDate, 'Reservation date should follow the target appointment');
    assertEqual(movedReservation.status, 'Em Uso', 'Moved reservation should remain in use');
    assert(movedReservation.checkout_at, 'Continuous custody should preserve the checkout timestamp');
    assert(!movedReservation.checkin_at && !movedReservation.checkin_date, 'Rescheduling must not record a return');
    assert(movedReservation.notes?.includes('Reagendado'), 'Rescheduling should leave an audit note');
    assertEqual(carriedAnalyzer.status, 'Em Uso', 'Carried analyzer should remain in use');

    const movedDashboardResponse = await apiFetch('/api/technician-portal?days=45', { headers: portalHeaders });
    assertEqual(movedDashboardResponse.status, 200, 'Dashboard should load after rescheduling');
    const sourceAppointment = movedDashboardResponse.data.appointments.find(item => item.id === portalTarget.appointmentId);
    const targetAppointment = movedDashboardResponse.data.appointments.find(item => item.id === portalTarget.targetAppointmentId);
    const sourceRequirement = sourceAppointment?.analyzerRequirements.find(item => item.analyzerType === portalTarget.analyzerType);
    const targetRequirement = targetAppointment?.analyzerRequirements.find(item => item.analyzerType === portalTarget.analyzerType);
    assertNotNull(targetRequirement, 'Target appointment should expose the matching analyzer requirement');
    assert(!sourceRequirement?.existingReservations.some(item => item.id === reservationIds[1]), 'Moved reservation must leave the source appointment');
    assert(targetRequirement.existingReservations.some(item => item.id === reservationIds[1]), 'Moved reservation must appear on the target appointment');

    record(
      'Technician portal multiple reservations, carry-over rescheduling and self-service return',
      true,
      `Reserved 2 assets of ${portalTarget.analyzerType}, returned #${reservationIds[0]} and carried #${reservationIds[1]} forward`
    );
  } catch (error) {
    record('Technician portal multiple reservations, carry-over rescheduling and self-service return', false, error.message);
  }

  return results;
}

module.exports = { runTier3Tests };
