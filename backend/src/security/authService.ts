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
  role: 'admin' | 'technician' | 'manager' | 'supervisor' | string;
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
   * Valida credenciais comparando o hash de forma segura contra timing attacks.
   */
  public static async verifyUserCredentials(
    plainText: string,
    storedHash: string | null | undefined
  ): Promise<boolean> {
    const hashToCompare = storedHash || DUMMY_BCRYPT_HASH;
    const isMatch = await CryptoService.verifySecret(plainText, hashToCompare);
    return storedHash ? isMatch : false;
  }

  /**
   * Emite token JWT assinado para sessões de administradores e técnicos autenticados.
   */
  public static generateSessionToken(
    user: { id: number | string; role: 'admin' | 'technician' | 'manager' | 'supervisor' | string; name: string; phone?: string | null; email?: string | null },
    expiresIn = '12h'
  ): string {
    return jwt.sign(
      {
        sub: String(user.id),
        role: user.role,
        name: user.name,
        phone: user.phone || null,
        email: user.email || null
      },
      getJwtSecret(),
      {
        expiresIn: expiresIn as any,
        algorithm: 'HS256',
        issuer: 'atem-field-backend',
        audience: 'atem-field-app'
      }
    );
  }

  /**
   * Decodifica e verifica a autenticidade e validade do token JWT recebido.
   */
  public static verifySessionToken(token: string): AuthenticatedUserPayload {
    try {
      const decoded = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256'],
        issuer: 'atem-field-backend',
        audience: 'atem-field-app'
      });
      return decoded as AuthenticatedUserPayload;
    } catch (err: any) {
      throw new Error(`Token inválido ou expirado: ${err.message}`);
    }
  }
}

// Extensão do tipo Request do Express para inclusão de usuário autenticado
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
}

/**
 * Middleware Express: Exige token JWT válido no cabeçalho Authorization (Bearer <token>).
 */
export function requireAuthentication(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Autenticação necessária. Faça login para continuar.'
    });
    return;
  }

  const token = authHeader.split(' ')[1];

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
 * Verifica se um papel de usuário é administrativo ou gerencial (admin, manager, gerente, supervisor).
 */
export function isManagementRole(role?: string): boolean {
  if (!role) return false;
  const normalized = String(role).trim().toLowerCase();
  return ['admin', 'manager', 'gerente', 'supervisor'].includes(normalized);
}

/**
 * Middleware Express: Exige permissões específicas de Perfil (Role-Based Access Control - RBAC).
 */
export function requireRole(allowedRoles: Array<'admin' | 'technician' | 'manager' | 'supervisor' | string>) {
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

/**
 * Middleware Express: Exige papel de gestão (admin, gerente ou supervisor).
 */
export function requireManagement(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Acesso não autenticado.' });
    return;
  }

  if (!isManagementRole(req.user.role)) {
    res.status(403).json({
      success: false,
      error: 'Acesso negado. Operação exclusiva para administradores, gerentes ou supervisores.'
    });
    return;
  }

  next();
}
