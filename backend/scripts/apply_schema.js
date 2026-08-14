const fs = require('fs');
const https = require('https');
const path = require('path');
const { getSupabaseConfig } = require('./supabase-env');

const { projectRef, accessToken } = getSupabaseConfig({ requireAccessToken: true });
const sqlPath = path.resolve(__dirname, '../migrations/001_initial_schema.sql');
const sqlContent = fs.readFileSync(sqlPath, 'utf8');

const request = https.request(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  },
  (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        console.log('Migration applied successfully.');
      } else {
        console.error(`Migration failed with HTTP ${response.statusCode}: ${body}`);
        process.exitCode = 1;
      }
    });
  }
);

request.on('error', (error) => {
  console.error(`Migration request failed: ${error.message}`);
  process.exitCode = 1;
});
request.end(JSON.stringify({ query: sqlContent }));
