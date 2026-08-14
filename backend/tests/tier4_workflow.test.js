const { apiFetch, assert, assertEqual, assertNotNull, trackTechnician, trackAnalyzer, trackReservation, isNonTechnicalAppointment } = require('./helpers');

async function runTier4Tests() {
  const results = [];

  function record(name, passed, detail = '') {
    results.push({ name, passed, detail });
  }

  // 1. Full E2E Workflow Test Scenario
  try {
    const timestamp = Date.now();

    // Step 1: Create a new Field Technician
    const techName = `E2E Workflow Tech ${timestamp}`;
    const createTechRes = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: techName,
        phone: '11977776666',
        telegram_id: `tg_${timestamp}`,
        email: `tech_${timestamp}@atem.com`,
        role: 'Técnico de Campo Senior'
      }
    });

    assertEqual(createTechRes.status, 200, 'Step 1: Technician creation should return HTTP 200');
    assert(createTechRes.data.success === true, 'Step 1: Technician creation success should be true');
    const techId = createTechRes.data.id;
    assertNotNull(techId, 'Step 1: Technician ID must be returned');
    trackTechnician(techId);

    // Step 2: Fetch target appointment
    const apptsRes = await apiFetch('/api/appointments');
    assertEqual(apptsRes.status, 200, 'Step 2: Fetching appointments should return HTTP 200');
    assert(apptsRes.data.appointments.length > 0, 'Step 2: Should have appointments in system');

    const targetAppt = apptsRes.data.appointments.find(a => !isNonTechnicalAppointment(a)) || apptsRes.data.appointments[0];
    const apptId = targetAppt.id;

    // Step 3: Create dedicated Analyzer with unique Asset Tag
    const assetTag = `PAT-WF-${timestamp.toString().slice(-6)}`;
    const analyzerName = `Fluke Impulse Pro ${timestamp}`;

    const createAnalyzerRes = await apiFetch('/api/analyzers', {
      method: 'POST',
      body: {
        asset_tag: assetTag,
        name: analyzerName,
        type: 'Analisador de Desfibrilador',
        serial_number: `SN-WF-${timestamp}`,
        brand_model: 'Fluke Impulse Pro E2E',
        notes: 'Created during Tier 4 E2E Full Workflow Test'
      }
    });

    assertEqual(createAnalyzerRes.status, 200, 'Step 3: Analyzer creation should return HTTP 200');
    assert(createAnalyzerRes.data.success === true, 'Step 3: Analyzer creation success should be true');
    const analyzerId = createAnalyzerRes.data.id;
    assertNotNull(analyzerId, 'Step 3: Analyzer ID must be returned');
    trackAnalyzer(analyzerId);

    // Step 4: Reserve Analyzer for Technician & Appointment
    const reserveRes = await apiFetch('/api/reservations', {
      method: 'POST',
      body: {
        appointment_id: apptId,
        analyzer_id: analyzerId,
        technician_id: techId,
        notes: 'E2E full workflow reservation'
      }
    });

    assertEqual(reserveRes.status, 200, 'Step 4: Analyzer reservation should return HTTP 200');
    assert(reserveRes.data.success === true, 'Step 4: Analyzer reservation success should be true');
    const reservationId = reserveRes.data.reservationId;
    assertNotNull(reservationId, 'Step 4: Reservation ID must be returned');
    trackReservation(reservationId);

    // Step 5: Verify reservation in analyzer status
    const analyzerCheck1 = await apiFetch('/api/analyzers');
    const reservedAnalyzer = analyzerCheck1.data.analyzers.find(a => a.id === analyzerId);
    assertNotNull(reservedAnalyzer, 'Step 5: Created analyzer should be in inventory');
    assertEqual(reservedAnalyzer.status, 'Reservado', `Step 5: Analyzer status should be "Reservado", got "${reservedAnalyzer ? reservedAnalyzer.status : 'null'}"`);

    // Step 6: Checkout Analyzer (Equipment taken into the field)
    const checkoutRes = await apiFetch(`/api/reservations/${reservationId}/checkout`, {
      method: 'POST'
    });
    assertEqual(checkoutRes.status, 200, 'Step 6: Checkout should return HTTP 200');
    assert(checkoutRes.data.success === true, 'Step 6: Checkout success should be true');

    const analyzerCheck2 = await apiFetch('/api/analyzers');
    const checkedOutAnalyzer = analyzerCheck2.data.analyzers.find(a => a.id === analyzerId);
    assertNotNull(checkedOutAnalyzer, 'Step 6: Analyzer should exist');
    assertEqual(checkedOutAnalyzer.status, 'Em Uso', `Step 6: Analyzer status should be updated to "Em Uso", got "${checkedOutAnalyzer.status}"`);

    // Step 7: Checkin Analyzer (Equipment returned to stock)
    const checkinRes = await apiFetch(`/api/reservations/${reservationId}/checkin`, {
      method: 'POST'
    });
    assertEqual(checkinRes.status, 200, 'Step 7: Checkin should return HTTP 200');
    assert(checkinRes.data.success === true, 'Step 7: Checkin success should be true');

    const analyzerCheck3 = await apiFetch('/api/analyzers');
    const checkedInAnalyzer = analyzerCheck3.data.analyzers.find(a => a.id === analyzerId);
    assertNotNull(checkedInAnalyzer, 'Step 7: Analyzer should exist');
    assertEqual(checkedInAnalyzer.status, 'Disponível', `Step 7: Analyzer status should return to "Disponível", got "${checkedInAnalyzer.status}"`);

    record(
      'Full End-to-End Workflow (Technician -> Appointment -> Reservation -> Checkout -> Checkin)',
      true,
      `Successfully executed complete workflow for Tech #${techId}, Asset Tag ${assetTag}, Reservation #${reservationId}`
    );
  } catch (err) {
    record(
      'Full End-to-End Workflow (Technician -> Appointment -> Reservation -> Checkout -> Checkin)',
      false,
      err.message
    );
  }

  return results;
}

module.exports = { runTier4Tests };
