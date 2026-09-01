import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { CryptoService } from './cryptoService';

/**
 * ============================================================================
 * SERVIÇO DE AUTENTICAÇÃO, CONTROLE DE ACESSO (RBAC) E GESTÃO DE TOKENS JWT
 * ============================================================================
 * Padrões de Segurança Seguidos:
 * 1. Tokens JWT assinados com HMAC-SHA256 e chave secreta do ambiente (JWT_SECRET).
 * 2. Tempo de expiração estrito (12 horas por padrão) e verificação obrigatória de emissor/audiência.
 * 3. Proteção contra enumeração de usuários (Dummy Hash Execution em caso de falha).
 * 4. Respostas de erro genéricas ("Credenciais inválidas") para não revelar a existência do usuário.
 * 5. Middlewares Express para validação de sessão e controle de permissões por Perfil (RBAC).
 */

export { CryptoService } from './cryptoService';

export interface AuthenticatedUserPayload {
  sub: string;               // ID do Usuário ou Técnico
  role: 'admin' | 'technician';
  name: string;
  phone?: string | null;
  email?: string | null;
  iat?: number;
  exp?: number;
}

// Hash Bcrypt fictício pré-computado para simular custo computacional constante (evita User Enumeration por Timing)
const DUMMY_BCRYPT_HASH = '$2a$12$7eqJtq98hPqEX7fNZaFWoOhuU2W87F2KzWn2U6g1hH6X6c6T1Pj7i';
const DEVELOPMENT_JWT_SECRET = randomBytes(48).toString('hex');

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET é obrigatório em produção. Configure um segredo independente no Secret Group.');
  }

  // Desenvolvimento local: a chave é efêmera e nunca reutiliza a service role.
  // Reiniciar o backend invalida as sessões locais, o que é preferível a um
  // segredo fixo compartilhado no código-fonte.
  return DEVELOPMENT_JWT_SECRET;
}

export class AuthService {
  /**
   * Gera um Token JWT assinado criptograficamente para uma sessão de usuário.
   */
  public static generateSessionToken(
    user: { id: string | number; role: 'admin' | 'technician'; name: string; email?: string | null; phone?: string | null },
    expiresIn: string = '12h'
  ): string {
    const secret = getJwtSecret();
    const payload: AuthenticatedUserPayload = {
      sub: String(user.id),
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email
    };

    return jwt.sign(payload, secret, {
      algorithm: 'HS256',
      expiresIn: (expiresIn as any),
      issuer: 'atem-field-security',
      audience: 'atem-field-clients'
    });
  }

  /**
   * Valida e decodifica um Token JWT de forma segura.
   * Lança exceções genéricas caso o token esteja expirado, adulterado ou com assinatura inválida.
   */
  public static verifySessionToken(token: string): AuthenticatedUserPayload {
    if (!token) {
      throw new Error('Token de autenticação não fornecido.');
    }

    try {
      const secret = getJwtSecret();
      return jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: 'atem-field-security',
        audience: 'atem-field-clients'
      }) as AuthenticatedUserPayload;
    } catch {
      throw new Error('Sessão inválida ou expirada. Faça login novamente.');
    }
  }

  /**
   * Executa a autenticação de forma resistente a ataques de força bruta e enumeração.
   * Se o usuário não existir, executa verificação de hash simulada para garantir tempo de resposta uniforme.
   */
  public static async verifyUserCredentials(
    plainPasswordOrPin: string,
    storedHashOrPin: string | null | undefined
  ): Promise<boolean> {
    if (!plainPasswordOrPin) return false;

    if (!storedHashOrPin) {
      // Usuário não encontrado: executa Bcrypt fictício para neutralizar timing attack
      await CryptoService.verifySecret(plainPasswordOrPin, DUMMY_BCRYPT_HASH);
      return false;
    }

    // Se o segredo armazenado for um Hash Bcrypt (começa com $2a$, $2b$ ou $2y$)
    if (storedHashOrPin.startsWith('$2')) {
      return CryptoService.verifySecret(plainPasswordOrPin, storedHashOrPin);
    }

    // Se for comparação direta de PIN mestre seguro (via timingSafeCompare)
    return CryptoService.timingSafeCompare(plainPasswordOrPin, storedHashOrPin);
  }
}

// Extensão do tipo Request do Express para inclusão de usuário autenticado
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
}

/**
 * Middleware Express: Exige que a requisição contenha um Token Bearer válido no Header Authorization.
 */
export function requireAuthentication(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Acesso não autorizado. Token de autenticação ausente ou inválido.'
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const payload = AuthService.verifySessionToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    res.status(401).json({
      success: false,
      error: err.message || 'Sessão inválida ou expirada.'
    });
  }
}

/**
 * Middleware Express: Exige permissões específicas de Perfil (Role-Based Access Control - RBAC).
 */
export function requireRole(allowedRoles: Array<'admin' | 'technician'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Acesso não autenticado.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Acesso negado. Seu perfil de usuário não possui permissão para esta operação.'
      });
      return;
    }

    next();
  };
}
