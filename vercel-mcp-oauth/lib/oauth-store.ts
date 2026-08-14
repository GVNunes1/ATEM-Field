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

// Armazenamento em memória / KV para Serverless Functions
const stateStore = new Map<string, { redirectUri: string; expiresAt: number }>();
const sessionStore = new Map<string, UserSession>();

export function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function saveOAuthState(state: string, redirectUri: string) {
  stateStore.set(state, {
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

export function verifyAndConsumeOAuthState(state: string): { redirectUri: string } | null {
  const data = stateStore.get(state);
  if (!data) return null;
  stateStore.delete(state);
  if (Date.now() > data.expiresAt) return null;
  return { redirectUri: data.redirectUri };
}

export function createSession(user: UserProfile, accessToken: string): UserSession {
  const sessionId = generateState() + generateState();
  const ttlMs = 7 * 24 * 60 * 60 * 1000;
  const session: UserSession = {
    sessionId,
    user,
    accessToken,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
  };
  sessionStore.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): UserSession | null {
  if (!sessionId) return null;
  const session = sessionStore.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessionStore.delete(sessionId);
    return null;
  }
  return session;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const clientId = process.env.OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || '';
  const tokenUrl = process.env.OAUTH_TOKEN_URL || 'https://github.com/login/oauth/access_token';

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Troca de token falhou: ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token de acesso ausente: ${data.error_description || 'Erro desconhecido'}`);
  }

  return data.access_token;
}

export async function fetchUserProfile(accessToken: string): Promise<UserProfile> {
  const userInfoUrl = process.env.OAUTH_USER_INFO_URL || 'https://api.github.com/user';
  const response = await fetch(userInfoUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Vercel-MCP-Server',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Erro ao buscar dados do usuário: ${response.status}`);
  }

  return (await response.json()) as UserProfile;
}
