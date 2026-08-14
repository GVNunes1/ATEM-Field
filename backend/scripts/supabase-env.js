const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Configure backend/.env from backend/.env.example.`);
  }
  return value;
}

function getSupabaseConfig({ requireAnonKey = false, requireAccessToken = false } = {}) {
  return {
    projectRef: requireEnv('SUPABASE_PROJECT_REF'),
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    ...(requireAnonKey ? { anonKey: requireEnv('SUPABASE_ANON_KEY') } : {}),
    ...(requireAccessToken ? { accessToken: requireEnv('SUPABASE_ACCESS_TOKEN') } : {})
  };
}

module.exports = { getSupabaseConfig, requireEnv };
