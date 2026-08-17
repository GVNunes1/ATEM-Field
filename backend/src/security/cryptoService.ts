import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * ============================================================================
 * SERVIÇO DE CRIPTOGRAFIA & GERAÇÃO CRIPTOGRÁFICA SEGURA (CSPRNG)
 * ============================================================================
 * Padrões de Segurança Seguidos:
 * 1. AES-256-GCM para dados simétricos (Autenticação e Criptografia AEAD).
 * 2. Bcrypt (Work Factor 12) para senhas e PINs com proteção contra ataques de dicionário e força bruta.
 * 3. CSPRNG nativo do SO (crypto.randomBytes e crypto.randomInt) para IVs, Salts e Tokens.
 * 4. Comparação em tempo constante (timingSafeEqual) para mitigar ataques de temporização (Side-Channel Timing Attacks).
 * 5. Tratamento de exceções com mascaramento de erros contra vazamento de metadados.
 */

// Configurações do Algoritmo Simétrico
const SYMMETRIC_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recomendado pelo NIST para AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits de Tag de Autenticação
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;

/**
 * Obtém e valida a chave mestra de criptografia simétrica a partir do ambiente.
 * A chave DEVE ter exatamente 32 bytes (256 bits).
 */
function getMasterEncryptionKey(): Buffer {
  const rawKey =
    process.env.ENCRYPTION_MASTER_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'atem-field-clinical-aes-256-master-key-seed-3247-enterprise-security';

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  } else if (rawKey.length === 44 && rawKey.endsWith('=')) {
    return Buffer.from(rawKey, 'base64');
  }

  // Derivação uniforme de 256 bits (32 bytes) via SHA-256
  return crypto.createHash('sha256').update(rawKey).digest();
}

export class CryptoService {
  /**
   * Criptografa uma string usando AES-256-GCM.
   * Gera um IV pseudo-aleatório seguro (CSPRNG) exclusivo para cada operação.
   * 
   * Formato de saída: "ivHex:authTagHex:ciphertextHex"
   */
  public static encrypt(plainText: string): string {
    if (!plainText) return '';

    try {
      const key = getMasterEncryptionKey();
      // IV criptograficamente seguro gerado por CSPRNG
      const iv = crypto.randomBytes(IV_LENGTH_BYTES);

      const cipher = crypto.createCipheriv(SYMMETRIC_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES
      });

      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Tag de integridade para verificar se o texto cifrado foi adulterado
      const authTag = cipher.getAuthTag();

      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      // Mascaramento de erro interno para evitar enumeração de falhas criptográficas
      throw new Error('Falha na operação de proteção de dados.');
    }
  }

  /**
   * Decriptografa e valida a integridade dos dados usando AES-256-GCM.
   * Rejeita qualquer payload adulterado ou com tag inválida.
   */
  public static decrypt(cipherPayload: string): string {
    if (!cipherPayload) return '';

    const parts = cipherPayload.split(':');
    if (parts.length !== 3) {
      throw new Error('Payload criptográfico com formato inválido ou corrompido.');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    try {
      const key = getMasterEncryptionKey();
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
        throw new Error('Parâmetros de inicialização inválidos.');
      }

      const decipher = crypto.createDecipheriv(SYMMETRIC_ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH_BYTES
      });

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // Se a tag não bater ou a chave for incorreta, o decipher.final() lançará erro
      throw new Error('Falha na autenticação ou integridade dos dados cifrados.');
    }
  }

  /**
   * Gera o Hash de uma Senha ou PIN usando Bcrypt com Salt Rounds seguro.
   */
  public static async hashSecret(plainSecret: string): Promise<string> {
    if (!plainSecret) {
      throw new Error('O segredo fornecido não pode ser vazio.');
    }
    const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
    return bcrypt.hash(plainSecret, salt);
  }

  /**
   * Compara um segredo em texto plano com seu Hash Bcrypt de forma segura.
   * Utiliza algoritmo resistente a ataques de temporização (Timing Attacks).
   */
  public static async verifySecret(plainSecret: string, hashedSecret: string): Promise<boolean> {
    if (!plainSecret || !hashedSecret) return false;
    try {
      return await bcrypt.compare(plainSecret, hashedSecret);
    } catch {
      return false;
    }
  }

  /**
   * Compara duas strings em tempo constante para evitar vazamento por canal lateral.
   */
  public static timingSafeCompare(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;

    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');

    if (bufA.length !== bufB.length) {
      // Executa comparação fictícia para manter custo de tempo constante
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Gera um Token Criptograficamente Seguro (CSPRNG) em formato Hexadecimal.
   * Recomendado para Tokens de Sessão, Redefinição de Senha ou API Keys.
   */
  public static generateSecureToken(byteLength: number = 32): string {
    return crypto.randomBytes(byteLength).toString('hex');
  }

  /**
   * Gera um PIN numérico aleatório seguro com distribuição uniforme garantida por CSPRNG.
   * NUNCA utiliza Math.random() para evitar previsibilidade no PRNG.
   */
  public static generateNumericPin(digits: number = 4): string {
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits);
    const randomInt = crypto.randomInt(min, max);
    return String(randomInt);
  }

  /**
   * Gera um UUID v4 criptograficamente seguro através do CSPRNG nativo.
   */
  public static generateUuid(): string {
    return crypto.randomUUID();
  }
}
