import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  Env,
  UserSession,
  generateState,
  saveOAuthState,
  verifyAndConsumeOAuthState,
  exchangeCodeForToken,
  fetchUserProfile,
  createSession,
  getSession,
} from './oauth-helper.js';
import { createCloudflareMcpServer } from './mcp-server.js';

const app = new Hono<{ Bindings: Env; Variables: { session: UserSession } }>();

// Middleware CORS
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'mcp-session-id'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Home / Status
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Cloudflare Workers MCP Server com OAuth</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
        .card { background: #1e293b; border-radius: 12px; padding: 2rem; border: 1px solid #334155; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); }
        h1 { color: #38bdf8; margin-top: 0; }
        code { background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 4px; color: #f43f5e; font-family: monospace; }
        .btn { display: inline-block; background: #0284c7; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background 0.2s; }
        .btn:hover { background: #0369a1; }
        ul { padding-left: 1.2rem; }
        li { margin-bottom: 0.5rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>⚡ Cloudflare MCP Server (OAuth 2.0)</h1>
        <p>Servidor MCP remoto operando na Edge do Cloudflare Workers com autenticação OAuth integrada.</p>
        
        <h3>Endpoints Disponíveis:</h3>
        <ul>
          <li><code>GET /.well-known/oauth-protected-resource</code> - Descoberta de Recursos OAuth 2.1</li>
          <li><code>GET /auth/login</code> - Iniciar autenticação OAuth</li>
          <li><code>ALL /mcp</code> - Endpoint do Servidor MCP (Requer Header <code>Authorization: Bearer &lt;session_token&gt;</code>)</li>
        </ul>

        <div style="margin-top: 2rem;">
          <a href="/auth/login" class="btn">🚀 Autenticar via OAuth</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Descoberta OAuth 2.1 para Clientes MCP (Metadata Endpoint)
app.get('/.well-known/oauth-protected-resource', (c) => {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return c.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/`,
  });
});

// 1. Fluxo OAuth: Iniciar Login
app.get('/auth/login', async (c) => {
  const env = c.env;
  const url = new URL(c.req.url);
  const redirectUri = `${url.protocol}//${url.host}/auth/callback`;

  const state = generateState();
  await saveOAuthState(env.OAUTH_KV, state, redirectUri);

  const authParams = new URLSearchParams({
    client_id: env.OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state: state,
    response_type: 'code',
  });

  const authUrl = `${env.OAUTH_AUTHORIZE_URL}?${authParams.toString()}`;
  return c.redirect(authUrl);
});

// 2. Fluxo OAuth: Callback do Provedor
app.get('/auth/callback', async (c) => {
  const env = c.env;
  const url = new URL(c.req.url);
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.html('<h2>Falha na autenticação OAuth. Tente novamente.</h2>', 400);
  }

  if (!code || !state) {
    return c.html('<h2>Parâmetros `code` ou `state` ausentes.</h2>', 400);
  }

  const validState = await verifyAndConsumeOAuthState(env.OAUTH_KV, state);
  if (!validState) {
    return c.html('<h2>Estado OAuth inválido ou expirado. Tente novamente.</h2>', 403);
  }

  try {
    const accessToken = await exchangeCodeForToken(env, code, validState.redirectUri);
    const userProfile = await fetchUserProfile(env, accessToken);
    const session = await createSession(env.OAUTH_KV, userProfile, accessToken);

    return c.html(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Autenticado com Sucesso</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 700px; margin: 0 auto; }
          .card { background: #1e293b; border-radius: 12px; padding: 2rem; border: 1px solid #10b981; }
          code { background: #0f172a; padding: 0.4rem 0.8rem; border-radius: 6px; color: #38bdf8; font-family: monospace; display: block; word-break: break-all; margin: 1rem 0; }
          .user-box { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
          .avatar { width: 48px; height: 48px; border-radius: 50%; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="user-box">
            ${userProfile.avatar_url ? `<img class="avatar" src="${userProfile.avatar_url}" alt="Avatar" />` : ''}
            <div>
              <h2 style="margin:0; color:#10b981;">Autenticação Concluída!</h2>
              <p style="margin:0; color:#94a3b8;">Olá, ${userProfile.name || userProfile.login || userProfile.id}</p>
            </div>
          </div>
          <p>Utilize este Token de Sessão no seu cliente MCP (Claude Desktop, Cursor, etc.):</p>
          <code>Authorization: Bearer ${session.sessionId}</code>
          <p style="font-size: 0.9rem; color: #94a3b8;">Sessão armazenada com segurança no Cloudflare KV (expira em 7 dias).</p>
        </div>
      </body>
      </html>
    `);
  } catch {
    return c.html('<h2>Falha no processamento OAuth. Tente novamente.</h2>', 500);
  }
});

// 3. Middleware de Autenticação para o Endpoint MCP
const authMcpMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    // Permite token via query param `token` para conexões SSE no navegador
    token = c.req.query('token') || '';
  }

  if (!token) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Não autorizado. Forneça o header `Authorization: Bearer <session_token>`.',
        },
        id: null,
      },
      401
    );
  }

  const session = await getSession(c.env.OAUTH_KV, token);
  if (!session) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Sessão OAuth inválida ou expirada.',
        },
        id: null,
      },
      403
    );
  }

  // Anexa a sessão autenticada no contexto do Hono
  c.set('session', session);
  await next();
};

// Application handler para Requisições HTTP JSON-RPC do MCP
app.use('/mcp/*', authMcpMiddleware);
app.use('/mcp', authMcpMiddleware);

app.post('/mcp', async (c) => {
  const session = c.get('session');
  const mcpServer = createCloudflareMcpServer(session);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400);
  }

  // Execução direta das requisições JSON-RPC do protocolo MCP
  const { jsonrpc, method, params, id } = body;

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'cloudflare-oauth-mcp-server',
          version: '1.0.0',
        },
      },
      id,
    });
  }

  // Utiliza os handlers registrados no servidor MCP
  try {
    // Transmite a mensagem JSON-RPC para o transport do MCP Server
    // Criamos um transport sintético para ler a resposta do servidor
    let responseResult: any = null;
    let responseError: any = null;

    // Dispatch direto conforme método MCP
    if (method === 'tools/list') {
      const handler = (mcpServer as any)._requestHandlers?.get('tools/list');
      if (handler) {
        responseResult = await handler({ method: 'tools/list', params });
      }
    } else if (method === 'tools/call') {
      const handler = (mcpServer as any)._requestHandlers?.get('tools/call');
      if (handler) {
        responseResult = await handler({ method: 'tools/call', params });
      }
    } else if (method === 'resources/list') {
      const handler = (mcpServer as any)._requestHandlers?.get('resources/list');
      if (handler) {
        responseResult = await handler({ method: 'resources/list', params });
      }
    } else if (method === 'resources/read') {
      const handler = (mcpServer as any)._requestHandlers?.get('resources/read');
      if (handler) {
        responseResult = await handler({ method: 'resources/read', params });
      }
    } else if (method === 'ping') {
      responseResult = {};
    } else {
      responseError = { code: -32601, message: `Método não encontrado: ${method}` };
    }

    if (responseError) {
      return c.json({ jsonrpc: '2.0', error: responseError, id });
    }

    return c.json({ jsonrpc: '2.0', result: responseResult, id });
  } catch (err: any) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err?.message || 'Internal server error' },
      id,
    });
  }
});

// Suporte ao Transporte SSE (Server-Sent Events) para MCP
app.get('/mcp/sse', async (c) => {
  const session = c.get('session');
  const mcpServer = createCloudflareMcpServer(session);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const response = new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });

  const transport = new SSEServerTransport('/mcp/message', response as any);
  await mcpServer.connect(transport);

  return response;
});

export default app;
