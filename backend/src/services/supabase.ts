import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { Database } from '../types/database.types';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requiredEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}. Configure backend/.env a partir de backend/.env.example.`);
  }
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL');
const supabaseAnonKey = requiredEnv('SUPABASE_ANON_KEY');
const supabaseServiceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

// Cliente público / anon (respeita RLS)
export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);

// Cliente Admin (Service Role - somente no backend)
export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  supabaseServiceRoleKey
);
