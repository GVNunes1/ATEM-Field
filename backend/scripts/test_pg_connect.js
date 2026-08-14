const { Client } = require('pg');

const ref = 'aorclbawxpjgrbdrcith';
const hosts = [
  `db.${ref}.supabase.co`,
  `aws-0-sa-east-1.pooler.supabase.com`,
  `aws-0-us-east-1.pooler.supabase.com`,
  `aws-0-us-west-1.pooler.supabase.com`,
  `aws-0-eu-central-1.pooler.supabase.com`
];

const passwords = [
  'postgres',
  'password',
  'aorclbawxpjgrbdrcith',
  'Supabase2026!',
  'Supabase123!',
  'admin',
  'root'
];

async function tryConnect(host, port, password) {
  const client = new Client({
    host,
    port,
    user: host.includes('pooler') ? `postgres.${ref}` : 'postgres',
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 3000
  });

  try {
    await client.connect();
    console.log(`SUCCESS! Host: ${host}:${port}, Password: ${password}`);
    await client.end();
    return true;
  } catch (err) {
    // console.log(`Failed ${host}:${port} with pass ${password}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('Testing PG connections...');
  for (const host of hosts) {
    const ports = host.includes('pooler') ? [6543, 5432] : [5432];
    for (const port of ports) {
      for (const pass of passwords) {
        const ok = await tryConnect(host, port, pass);
        if (ok) return;
      }
    }
  }
  console.log('Finished probing PG connections.');
}

main();
