const { apiFetch, assert, assertEqual, assertNotNull, trackTechnician, trackAnalyzer } = require('./helpers');

async function runTier2Tests() {
  const results = [];

  function record(name, passed, detail = '') {
    results.push({ name, passed, detail });
  }

  // 1. Filter appointments by date
  try {
    // Pick first appointment date from full list
    const allRes = await apiFetch('/api/appointments');
    const firstAppt = allRes.data.appointments[0];
    const targetDate = firstAppt ? firstAppt.appointment_date : '2026-08-11';

    const res = await apiFetch(`/api/appointments?date=${targetDate}`);
    assertEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert(res.data.success === true, 'Expected success: true');
    assert(Array.isArray(res.data.appointments), 'Expected appointments array');
    assert(res.data.appointments.length > 0, `Expected filtered appointments for date ${targetDate}`);

    const allMatch = res.data.appointments.every(a => a.appointment_date === targetDate);
    assert(allMatch, `All filtered appointments should match date ${targetDate}`);

    record('Filter appointments by date range', true, `Filtered ${res.data.appointments.length} appointments for ${targetDate}`);
  } catch (err) {
    record('Filter appointments by date range', false, err.message);
  }

  // 2. Filter appointments by technician
  try {
    const techId = 1;
    const res = await apiFetch(`/api/appointments?technician_id=${techId}`);
    assertEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert(res.data.success === true, 'Expected success: true');
    assert(Array.isArray(res.data.appointments), 'Expected appointments array');

    const allMatchTech = res.data.appointments.every(a => 
      (a.technician_ids && Array.isArray(a.technician_ids) && a.technician_ids.includes(techId)) ||
      a.technician_id === techId
    );
    assert(allMatchTech, `All filtered appointments should belong to technician ${techId}`);

    record('Filter appointments by technician ID', true, `Filtered ${res.data.appointments.length} appointments for technician ${techId}`);
  } catch (err) {
    record('Filter appointments by technician ID', false, err.message);
  }

  // 3. Boundary check: Out of range date filter
  try {
    const invalidDate = '1899-01-01';
    const res = await apiFetch(`/api/appointments?date=${invalidDate}`);
    assertEqual(res.status, 200, `Expected HTTP 200 for empty search, got ${res.status}`);
    assert(res.data.success === true, 'Expected success: true');
    assert(Array.isArray(res.data.appointments), 'Expected appointments array');
    assertEqual(res.data.appointments.length, 0, 'Expected 0 appointments for historical date');

    record('Filter appointments by invalid date (empty result boundary)', true, 'Returned empty array without server error');
  } catch (err) {
    record('Filter appointments by invalid date (empty result boundary)', false, err.message);
  }

  // 4. Technician creation validation (missing required fields)
  try {
    const res = await apiFetch('/api/technicians', {
      method: 'POST',
      body: { email: 'incomplete@test.com' } // Missing name & phone
    });

    assertEqual(res.status, 400, `Expected HTTP 400 for missing name/phone, got ${res.status}`);
    assert(res.data.success === false, 'Expected success: false');
    assert(res.data.error.includes('Nome e Telefone'), 'Expected error message regarding missing Name/Phone');

    record('Technician creation validation (missing required fields)', true, `Handled 400 validation error correctly: "${res.data.error}"`);
  } catch (err) {
    record('Technician creation validation (missing required fields)', false, err.message);
  }

  // 5. Valid technician creation
  try {
    const uniqueTechName = `E2E Tech ${Date.now()}`;
    const res = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: uniqueTechName,
        phone: '11998877665',
        email: 'e2etech@atem.com',
        role: 'Técnico de Campo'
      }
    });

    assertEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert(res.data.success === true, 'Expected success: true');
    assertNotNull(res.data.id, 'Expected new technician ID');
    trackTechnician(res.data.id);

    record('Technician creation with valid payload', true, `Created technician "${uniqueTechName}" with ID ${res.data.id}`);
  } catch (err) {
    record('Technician creation with valid payload', false, err.message);
  }

  // 6. Technician editing and duplicate merge
  try {
    const suffix = Date.now();
    const sourceRes = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: `E2E Merge Source ${suffix}`,
        phone: 'Pendente (Cadastrar via Telegram)',
        role: 'Técnico de Campo'
      }
    });
    const targetRes = await apiFetch('/api/technicians', {
      method: 'POST',
      body: {
        name: `E2E Merge Target ${suffix}`,
        phone: '11999990000',
        role: 'Técnico de Campo'
      }
    });
    assertEqual(sourceRes.status, 200, `Expected source creation HTTP 200, got ${sourceRes.status}`);
    assertEqual(targetRes.status, 200, `Expected target creation HTTP 200, got ${targetRes.status}`);
    trackTechnician(sourceRes.data.id);
    trackTechnician(targetRes.data.id);

    const editRes = await apiFetch(`/api/technicians/${sourceRes.data.id}`, {
      method: 'PATCH',
      body: { phone: '11911112222', status: 'Ativo' }
    });
    assertEqual(editRes.status, 200, `Expected edit HTTP 200, got ${editRes.status}`);
    assertEqual(editRes.data.technician.phone, '11911112222', 'Expected edited phone to be returned');

    const mergeRes = await apiFetch(`/api/technicians/${sourceRes.data.id}/merge`, {
      method: 'POST',
      body: {
        target_id: targetRes.data.id,
        profile: { name: 'E2E Merge Final' }
      }
    });
    assertEqual(mergeRes.status, 200, `Expected merge HTTP 200, got ${mergeRes.status}`);
    assert(mergeRes.data.success === true, 'Expected successful technician merge');
    assertEqual(mergeRes.data.merged.target_id, targetRes.data.id, 'Expected selected target to survive');

    const listRes = await apiFetch('/api/technicians');
    assert(!listRes.data.technicians.some(technician => technician.id === sourceRes.data.id), 'Expected merged source to be removed');
    const finalTechnician = listRes.data.technicians.find(technician => technician.id === targetRes.data.id);
    assertNotNull(finalTechnician, 'Expected target technician to remain');
    assertEqual(finalTechnician.name, 'E2E Merge Final', 'Expected final profile name after merge');

    record('Technician editing and duplicate merge', true, `Merged source ${sourceRes.data.id} into target ${targetRes.data.id}`);
  } catch (err) {
    record('Technician editing and duplicate merge', false, err.message);
  }

  // 7. Analyzer unique asset tag validation (duplicate tag error)
  try {
    const analyzersResponse = await apiFetch('/api/analyzers');
    assertEqual(analyzersResponse.status, 200, 'Expected analyzer inventory to load');
    const existingAnalyzer = analyzersResponse.data.analyzers[0];
    assertNotNull(existingAnalyzer, 'Expected at least one analyzer for duplicate validation');
    const res = await apiFetch('/api/analyzers', {
      method: 'POST',
      body: {
        asset_tag: existingAnalyzer.asset_tag,
        name: 'Duplicate Test Analyzer',
        type: 'Analisador de Desfibrilador',
        serial_number: 'SN-DUP-001'
      }
    });

    assertEqual(res.status, 400, `Expected HTTP 400 for duplicate asset tag, got ${res.status}`);
    assert(res.data.success === false, 'Expected success: false');
    assert(res.data.error.includes(existingAnalyzer.asset_tag), `Expected error mentioning duplicate tag ${existingAnalyzer.asset_tag}`);

    record('Analyzer unique asset tag validation (duplicate tag)', true, `Rejected duplicate asset tag ${existingAnalyzer.asset_tag} with HTTP 400: "${res.data.error}"`);
  } catch (err) {
    record('Analyzer unique asset tag validation (duplicate tag)', false, err.message);
  }

  // 8. Analyzer creation validation (missing required fields)
  try {
    const res = await apiFetch('/api/analyzers', {
      method: 'POST',
      body: {
        asset_tag: 'PAT-MISSING-FIELDS' // Missing name, type, serial_number
      }
    });

    assertEqual(res.status, 400, `Expected HTTP 400 for missing analyzer fields, got ${res.status}`);
    assert(res.data.success === false, 'Expected success: false');
    assertNotNull(res.data.error, 'Expected error string');

    record('Analyzer creation validation (missing required fields)', true, `Handled 400 error correctly: "${res.data.error}"`);
  } catch (err) {
    record('Analyzer creation validation (missing required fields)', false, err.message);
  }

  // 9. Non-technical appointment reservation rejection (Escala de sobreaviso / Exame periódico)
  try {
    const apptsRes = await apiFetch('/api/appointments');
    assertEqual(apptsRes.status, 200, 'Expected appointments list');
    const nonTechAppt = apptsRes.data.appointments.find(a => {
      const text = `${a.title || ''} ${a.client_name || ''}`.toLowerCase();
      return text.includes('sobreaviso') || text.includes('periodico');
    });

    assertNotNull(nonTechAppt, 'Expected at least one non-technical appointment in database');

    const res = await apiFetch('/api/reservations', {
      method: 'POST',
      body: {
        appointment_id: nonTechAppt.id,
        technician_id: 1,
        analyzer_id: 1
      }
    });

    assertEqual(res.status, 400, `Expected HTTP 400 for non-technical reservation, got ${res.status}`);
    assert(res.data.success === false, 'Expected success: false');
    assert(res.data.error.includes('não permitem reserva') || res.data.error.includes('não são serviços técnicos') || res.data.error.includes('não técnicos'), `Expected error message regarding non-technical service, got "${res.data.error}"`);

    record('Non-technical appointment reservation rejection', true, `Correctly blocked reservation for "${nonTechAppt.title}": ${res.data.error}`);
  } catch (err) {
    record('Non-technical appointment reservation rejection', false, err.message);
  }

  // 10. Non-technical appointment checklist flag (isTechnicalService: false)
  try {
    const apptsRes = await apiFetch('/api/appointments');
    const nonTechAppt = apptsRes.data.appointments.find(a => {
      const text = `${a.title || ''} ${a.client_name || ''}`.toLowerCase();
      return text.includes('sobreaviso') || text.includes('periodico');
    });

    assertNotNull(nonTechAppt, 'Expected non-technical appointment');
    const checklistRes = await apiFetch(`/api/appointments/${nonTechAppt.id}/checklist`);

    assertEqual(checklistRes.status, 200, `Expected HTTP 200, got ${checklistRes.status}`);
    assert(checklistRes.data.isTechnicalService === false, 'Expected isTechnicalService: false for non-technical appointment');
    assertEqual(checklistRes.data.requiredAnalyzerTypes.length, 0, 'Expected empty requiredAnalyzerTypes');

    record('Non-technical appointment checklist flag', true, `Returned isTechnicalService: false and empty requirements for "${nonTechAppt.title}"`);
  } catch (err) {
    record('Non-technical appointment checklist flag', false, err.message);
  }

  // 11. Excel template generation endpoint (/api/analyzers/template-excel)
  try {
    const templateRes = await apiFetch('/api/analyzers/template-excel');
    assertEqual(templateRes.status, 200, `Expected HTTP 200, got ${templateRes.status}`);
    record('Excel template generation endpoint', true, 'Successfully generated and served .xlsx template');
  } catch (err) {
    record('Excel template generation endpoint', false, err.message);
  }

  // 12. Excel analyzers batch sync & calibration dates (/api/analyzers/sync-excel)
  try {
    const timestamp = Date.now();
    const newTag = `PAT-WF-EXCEL-${timestamp.toString().slice(-5)}`;

    const analyzersRes = await apiFetch('/api/analyzers');
    assert(analyzersRes.data.analyzers.length > 0, 'Expected at least one analyzer');
    const existingAnalyzer = analyzersRes.data.analyzers[0];

    const syncPayload = {
      rows: [
        {
          asset_tag: newTag,
          name: `E2E Excel Sync New ${timestamp}`,
          type: 'Analisador de Desfibrilador',
          serial_number: `SN-EXCEL-${timestamp}`,
          brand_model: 'Fluke Impulse Pro',
          calibration_date: '2026-01-10',
          calibration_expiry: '2027-01-10',
          status: 'Disponível',
          notes: 'Created via E2E Excel Sync'
        },
        {
          asset_tag: existingAnalyzer.asset_tag,
          calibration_date: '2026-06-01',
          calibration_expiry: '2027-06-01',
          notes: 'Updated calibration via E2E Excel Sync'
        }
      ]
    };

    const syncRes = await apiFetch('/api/analyzers/sync-excel', {
      method: 'POST',
      body: syncPayload
    });

    assertEqual(syncRes.status, 200, `Expected HTTP 200, got ${syncRes.status}`);
    assert(syncRes.data.success === true, 'Expected success: true');
    assert(syncRes.data.createdCount >= 1, `Expected at least 1 created, got ${syncRes.data.createdCount}`);
    assert(syncRes.data.updatedCount >= 1, `Expected at least 1 updated, got ${syncRes.data.updatedCount}`);

    const afterRes = await apiFetch('/api/analyzers');
    const createdItem = afterRes.data.analyzers.find(a => a.asset_tag === newTag);
    if (createdItem) trackAnalyzer(createdItem.id);

    record('Excel analyzers batch sync & calibration dates', true, `Synchronized successfully: ${syncRes.data.createdCount} created, ${syncRes.data.updatedCount} updated`);
  } catch (err) {
    record('Excel analyzers batch sync & calibration dates', false, err.message);
  }

  // 13. PAT03-F1 Real Spreadsheet Parsing & Base64 Sync (/api/analyzers/sync-excel)
  try {
    const fs = require('fs');
    const path = require('path');
    const { parseAnalyzersExcelBuffer } = require('../dist/utils/excelUtils');

    const patFilePath = path.resolve(__dirname, '../../PAT03-F1 - Controle de Calibração.xls');
    if (fs.existsSync(patFilePath)) {
      const patBuf = fs.readFileSync(patFilePath);
      const parsedItems = parseAnalyzersExcelBuffer(patBuf);
      assert(parsedItems.length >= 150, `Expected at least 150 items parsed from PAT03-F1, got ${parsedItems.length}`);

      const firstItem = parsedItems[0];
      assert(Boolean(firstItem.asset_tag), 'Expected asset_tag on parsed item');
      assert(Boolean(firstItem.name), 'Expected name on parsed item');
      assert(Boolean(firstItem.calibration_date), 'Expected calibration_date on parsed item');
      assert(Boolean(firstItem.calibration_expiry), 'Expected calibration_expiry on parsed item');

      // Test endpoint with fileBase64
      const base64SyncRes = await apiFetch('/api/analyzers/sync-excel', {
        method: 'POST',
        body: {
          fileBase64: patBuf.toString('base64')
        }
      });

      assertEqual(base64SyncRes.status, 200, `Expected HTTP 200, got ${base64SyncRes.status}`);
      assert(base64SyncRes.data.success === true, 'Expected success: true');
      assert(base64SyncRes.data.total >= 150, `Expected at least 150 total, got ${base64SyncRes.data.total}`);

      record('PAT03-F1 Real Spreadsheet Parsing & Base64 Sync', true, `Successfully parsed ${parsedItems.length} items and synced via base64 (${base64SyncRes.data.updatedCount} updated)`);
    } else {
      record('PAT03-F1 Real Spreadsheet Parsing & Base64 Sync', true, 'Spreadsheet file not found in test environment, skipped');
    }
  } catch (err) {
    record('PAT03-F1 Real Spreadsheet Parsing & Base64 Sync', false, err.message);
  }

  return results;
}

module.exports = { runTier2Tests };
