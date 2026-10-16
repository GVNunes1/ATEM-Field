import { CryptoService } from './cryptoService';

export async function hashLoginPin(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.trim().length < 4 || Buffer.byteLength(value.trim(), 'utf8') > 72) {
    throw Object.assign(new Error('Informe um PIN com pelo menos 4 caracteres e até 72 bytes.'), { statusCode: 400 });
  }
  return CryptoService.hashSecret(value.trim());
}

// Run before accepting traffic. Legacy PINs are upgraded without changing the
// user's chosen secret; an unsuccessful write prevents server startup.
export async function migrateLoginPins(client: any): Promise<void> {
  for (const table of ['technicians', 'app_credentials']) {
    let start = 0;
    while (true) {
      const { data, error } = await client.from(table).select('id, pin').order('id').range(start, start + 499);
      if (error) throw new Error(`Não foi possível migrar os PINs de ${table}.`);
      for (const row of data || []) {
        if (row.pin === null || row.pin === undefined || row.pin === '') continue;
        if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(row.pin)) continue;
        const hash = await hashLoginPin(row.pin);
        const { error: updateError } = await client.rpc('upgrade_login_pin', {
          target_table: table, profile_id: row.id, expected_pin: row.pin, hashed_pin: hash,
        });
        if (updateError) throw new Error(`Não foi possível proteger um PIN de ${table}.`);
      }
      if (!data || data.length < 500) break;
      start += 500;
    }
  }
}
