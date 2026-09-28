const https = require('https');
const { getSupabaseConfig } = require('./supabase-env');

// The inserted appointment and its audit entries are rolled back together.
const query = `
BEGIN;
DO $audit$
<<verify_operational_audit>>
DECLARE appointment_id bigint; analyzer_id bigint; vehicle_id bigint; usage_id bigint;
BEGIN
  INSERT INTO public.appointments (title, appointment_date, workflow_status)
  VALUES ('Verificação transitória de auditoria', current_date, 'Data provisória')
  RETURNING id INTO appointment_id;

  UPDATE public.appointments
  SET workflow_status = 'Aguardando validação do supervisor',
      workflow_assigned_at = now(), workflow_assigned_by = '0'
  WHERE id = appointment_id;

  INSERT INTO public.analyzers (asset_tag, name)
  VALUES ('QA-AUDIT-TRANSIENT', 'Padrão de verificação')
  RETURNING id INTO analyzer_id;
  INSERT INTO public.reservations (appointment_id, analyzer_id, status, audit_actor_id)
  VALUES (appointment_id, analyzer_id, 'Reservado', '0');
  UPDATE public.reservations AS r SET status = 'Em Uso', audit_actor_id = '0'
  WHERE r.appointment_id = verify_operational_audit.appointment_id AND r.analyzer_id = verify_operational_audit.analyzer_id;

  INSERT INTO public.fleet_vehicles (name, plate)
  VALUES ('Carro de verificação', 'AUD-0000')
  RETURNING id INTO vehicle_id;
  UPDATE public.appointments SET vehicle_id = verify_operational_audit.vehicle_id,
    vehicle_assigned_at = now(), vehicle_assigned_by = '0'
  WHERE id = appointment_id;
  INSERT INTO public.fleet_usage (vehicle_id, appointment_id, km_initial, withdrawn_by_user_id, withdrawn_by_name)
  VALUES (vehicle_id, appointment_id, 100, '0', 'Administrador')
  RETURNING id INTO usage_id;
  UPDATE public.fleet_usage SET status = 'Devolvido', km_final = 101,
    returned_by_user_id = '0', returned_by_name = 'Administrador'
  WHERE id = usage_id;

  INSERT INTO public.calendar_outbox
    (appointment_id, calendar_id, event_id, expected_etag, event_patch, actor_id)
  VALUES (appointment_id, 'audit-test', 'transient', 'etag-test', '{}'::jsonb, '0');

  IF (SELECT count(*) FROM public.appointment_audit
      WHERE appointment_audit.appointment_id = verify_operational_audit.appointment_id
        AND event_type IN ('created', 'workflow', 'pattern_reserved', 'pattern_checkout',
          'vehicle', 'vehicle_checkout', 'vehicle_return', 'calendar_edit')) <> 8 THEN
    RAISE EXCEPTION 'Um gatilho de auditoria operacional deixou de registrar a alteração.';
  END IF;
END
$audit$;
ROLLBACK;
`;

const { projectRef, accessToken } = getSupabaseConfig({ requireAccessToken: true });
const request = https.request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
}, response => {
  let body = '';
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log('Gatilhos de auditoria verificados; transação de teste revertida.');
    } else {
      console.error(`Verificação falhou (HTTP ${response.statusCode}): ${body}`);
      process.exitCode = 1;
    }
  });
});
request.on('error', error => { console.error(error.message); process.exitCode = 1; });
request.end(JSON.stringify({ query }));
