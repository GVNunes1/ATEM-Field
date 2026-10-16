import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAndConsumeOAuthState,
  exchangeCodeForToken,
  fetchUserProfile,
  createSession,
} from '@/lib/oauth-store';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new NextResponse('<h2>Falha na autenticação OAuth. Tente novamente.</h2>', {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code || !state) {
    return new NextResponse('<h2>Parâmetros `code` ou `state` ausentes.</h2>', {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const validState = verifyAndConsumeOAuthState(state);
  if (!validState) {
    return new NextResponse('<h2>Estado OAuth inválido ou expirado.</h2>', {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const accessToken = await exchangeCodeForToken(code, validState.redirectUri);
    const userProfile = await fetchUserProfile(accessToken);
    const session = createSession(userProfile, accessToken);

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Vercel MCP - Autenticado</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #000; color: #fff; padding: 2rem; max-width: 650px; margin: 0 auto; }
          .card { background: #111; border-radius: 12px; padding: 2rem; border: 1px solid #333; }
          code { background: #222; padding: 0.5rem 1rem; border-radius: 6px; color: #0070f3; font-family: monospace; display: block; word-break: break-all; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="color: #0070f3;">▲ Vercel MCP - Autenticação Concluída</h2>
          <p>Olá, ${userProfile.name || userProfile.login || userProfile.id}</p>
          <p>Utilize este Bearer Token para autenticar no seu cliente MCP:</p>
          <code>Authorization: Bearer ${session.sessionId}</code>
        </div>
      </body>
      </html>
    `;

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch {
    return new NextResponse('<h2>Falha no processamento OAuth. Tente novamente.</h2>', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
