export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  return '';
}

export function apiUrl(endpoint: string): string {
  const base = getApiBaseUrl();
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${cleanPath}`;
}

export async function safeFetchJson(url: string, options?: RequestInit): Promise<any> {
  const targetUrl = apiUrl(url);
  const response = await fetch(targetUrl, options);
  const contentType = response.headers.get('content-type') || '';
  
  const text = await response.text();
  if (!text) return {};

  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(
      'O Backend ainda está inicializando no Render ou a URL da API precisa ser configurada. Aguarde alguns segundos e clique em Tentar Novamente.'
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('A API retornou uma resposta em formato inválido.');
  }
}
