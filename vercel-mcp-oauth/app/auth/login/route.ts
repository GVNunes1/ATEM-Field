import { NextRequest, NextResponse } from 'next/server';
import { generateState, saveOAuthState } from '@/lib/oauth-store';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const redirectUri = `${url.protocol}//${url.host}/auth/callback`;

  const state = generateState();
  saveOAuthState(state, redirectUri);

  const clientId = process.env.OAUTH_CLIENT_ID || '';
  const authorizeUrl = process.env.OAUTH_AUTHORIZE_URL || 'https://github.com/login/oauth/authorize';

  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state: state,
    response_type: 'code',
  });

  return NextResponse.redirect(`${authorizeUrl}?${authParams.toString()}`);
}
