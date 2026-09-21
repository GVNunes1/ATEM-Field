const fs = require('fs');
const https = require('https');
const path = require('path');
const { getSupabaseConfig } = require('./supabase-env');

const fileName = process.argv[2];
if (!/^(?:\d{3}|\d{14})_[a-z0-9_]+\.sql$/i.test(fileName || '')) {
  throw new Error('Informe uma migração, por exemplo: node scripts/apply_migration.js 002_workflow_fleet.sql');
}

const sqlPath = path.resolve(__dirname, '../migrations', fileName);
const sqlContent = fs.readFileSync(sqlPath, 'utf8');
const { projectRef, accessToken } = getSupabaseConfig({ requireAccessToken: true });

const request = https.request(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
}, response => {
  let body = '';
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log(`Migration ${fileName} applied successfully.`);
      return;
    }
    console.error(`Migration failed with HTTP ${response.statusCode}: ${body}`);
    process.exitCode = 1;
  });
});
request.on('error', error => {
  console.error(`Migration request failed: ${error.message}`);
  process.exitCode = 1;
});
request.end(JSON.stringify({ query: sqlContent }));
