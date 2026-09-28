const https = require('https');
const { getSupabaseConfig } = require('./supabase-env');

const query = `
SELECT a.id
  FROM public.appointments AS a
 WHERE a.workflow_status = 'Em execução'
   AND COALESCE(lower(a.status), '') <> 'cancelado'
   AND NOT EXISTS (
     SELECT 1 FROM public.reservations AS r
      WHERE r.appointment_id = a.id
        AND r.status NOT IN ('Devolvido', 'Cancelado')
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status NOT IN ('Devolvido', 'Devolvido com pendência', 'Cancelado')
   )
   AND (a.vehicle_id IS NULL OR EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status IN ('Devolvido', 'Devolvido com pendência')
   ))
   AND (EXISTS (
     SELECT 1 FROM public.reservations AS r
      WHERE r.appointment_id = a.id AND r.status = 'Devolvido'
   ) OR EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status IN ('Devolvido', 'Devolvido com pendência')
   ))
 ORDER BY a.id;
`;

const { projectRef, accessToken } = getSupabaseConfig({ requireAccessToken: true });
const request = https.request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
}, response => {
  let body = '';
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.error(`Consulta falhou com HTTP ${response.statusCode}: ${body}`);
      process.exitCode = 1;
      return;
    }
    const rows = JSON.parse(body);
    console.log(`Atendimentos aptos à conclusão automática: ${rows.length}`);
    console.log(`IDs: ${rows.map(row => row.id).join(', ') || 'nenhum'}`);
  });
});
request.on('error', error => { console.error(error.message); process.exitCode = 1; });
request.end(JSON.stringify({ query }));
