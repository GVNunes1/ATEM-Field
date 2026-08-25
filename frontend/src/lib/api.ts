const NORTHFLANK_API_URL = 'https://p01--atem-field--2v2xm9t22wfk.code.run';
const LEGACY_RENDER_API_URL = 'https://atem-field-backend.onrender.com';

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  const envUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL || '');

  // Builds antigos da Vercel ainda podem carregar a URL do Render suspenso.
  // Redirecione-os para o backend ativo sem prejudicar o proxy do Vite local.
  if (envUrl && envUrl !== LEGACY_RENDER_API_URL) {
    return envUrl;
  }

  return import.meta.env.DEV ? '' : NORTHFLANK_API_URL;
}

export function apiUrl(endpoint: string): string {
  const base = getApiBaseUrl();
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${cleanPath}`;
}

export async function safeFetchJson(url: string, options?: RequestInit): Promise<any> {
  const targetUrl = apiUrl(url);
  const headers = new Headers(options?.headers || {});
  try {
    const token = localStorage.getItem('atem.auth.token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  const response = await fetch(targetUrl, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  
  const text = await response.text();
  if (!text) return {};

  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(
      'A URL da API está incorreta ou o backend está indisponível. Aguarde alguns segundos e clique em Tentar novamente.'
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('A API retornou uma resposta em formato inválido.');
  }
}
