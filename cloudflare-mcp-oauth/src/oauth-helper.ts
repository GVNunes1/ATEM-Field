export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  OAUTH_AUTHORIZE_URL: string;
  OAUTH_TOKEN_URL: string;
  OAUTH_USER_INFO_URL: string;
}

export interface UserProfile {
  id: string | number;
  login?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface UserSession {
  sessionId: string;
  user: UserProfile;
  accessToken: string;
  createdAt: string;
  expiresAt: number;
}

/**
 * Gera um parâmetro state criptograficamente seguro para o fluxo OAuth
 */
export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Salva o estado OAuth temporário no KV (expira em 10 minutos)
 */
export async function saveOAuthState(kv: KVNamespace, state: string, redirectUri: string): Promise<void> {
  await kv.put(`state:${state}`, JSON.stringify({ redirectUri }), { expirationTtl: 600 });
}

/**
 * Valida e consome o estado OAuth vindo do callback
 */
export async function verifyAndConsumeOAuthState(kv: KVNamespace, state: string): Promise<{ redirectUri: string } | null> {
  const key = `state:${state}`;
  const data = await kv.get(key);
  if (!data) return null;
  
  await kv.delete(key);
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Troca o código de autorização por um token de acesso com o provedor OAuth
 */
export async function exchangeCodeForToken(env: Env, code: string, redirectUri: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(env.OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha na troca de código OAuth (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token OAuth não recebido: ${data.error_description || data.error || 'Erro desconhecido'}`);
  }

  return data.access_token;
}

/**
 * Busca dados do perfil do usuário usando o token de acesso
 */
export async function fetchUserProfile(env: Env, accessToken: string): Promise<UserProfile> {
  const response = await fetch(env.OAUTH_USER_INFO_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Cloudflare-Worker-MCP-Server',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Erro ao buscar dados do usuário: ${response.status}`);
  }

  return (await response.json()) as UserProfile;
}

/**
 * Cria e armazena uma sessão de usuário no KV
 */
export async function createSession(kv: KVNamespace, user: UserProfile, accessToken: string): Promise<UserSession> {
  const sessionId = generateState() + generateState(); // Token de sessão seguro de 64 caracteres
  const ttlSeconds = 60 * 60 * 24 * 7; // Expiração em 7 dias
  const expiresAt = Date.now() + ttlSeconds * 1000;

  const session: UserSession = {
    sessionId,
    user,
    accessToken,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  await kv.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: ttlSeconds });
  return session;
}

/**
 * Valida e recupera a sessão do KV através do Bearer Token
 */
export async function getSession(kv: KVNamespace, sessionId: string): Promise<UserSession | null> {
  if (!sessionId) return null;
  const raw = await kv.get(`session:${sessionId}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as UserSession;
    if (session.expiresAt && Date.now() > session.expiresAt) {
      await kv.delete(`session:${sessionId}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
