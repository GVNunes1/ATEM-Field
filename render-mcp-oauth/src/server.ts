import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  generateState,
  saveOAuthState,
  verifyAndConsumeOAuthState,
  exchangeCodeForToken,
  fetchUserProfile,
  createSession,
  getSession,
  UserSession,
} from './oauth-helper';
import { createRenderMcpServer } from './mcp-server';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Extend Express Request type
interface AuthenticatedRequest extends Request {
  session?: UserSession;
}

// Home Page
app.get('/', (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Render MCP Server com OAuth</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; max-width: 700px; margin: 0 auto; }
        .card { background: #111827; border-radius: 12px; padding: 2rem; border: 1px solid #374151; }
        h1 { color: #d946ef; margin-top: 0; }
        code { background: #1f2937; padding: 0.3rem 0.6rem; border-radius: 4px; color: #38bdf8; font-family: monospace; }
        .btn { display: inline-block; background: #c026d3; color: white; padding: 0.8rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🚀 Render MCP Server (OAuth 2.0)</h1>
        <p>Servidor MCP Remoto rodando no Render Web Service com autenticação OAuth integrada.</p>
        
        <h3>Endpoints:</h3>
        <ul>
          <li><code>GET /.well-known/oauth-protected-resource</code> - Descoberta de Recursos OAuth 2.1</li>
          <li><code>GET /auth/login</code> - Iniciar Login OAuth</li>
          <li><code>POST /mcp</code> - Endpoint JSON-RPC MCP</li>
          <li><code>GET /mcp/sse</code> - Transporte SSE Streaming</li>
        </ul>

        <div style="margin-top: 2rem;">
          <a href="/auth/login" class="btn">🔑 Autenticar via OAuth</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Descoberta OAuth 2.1
app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;

  res.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrl}/`,
  });
});

// OAuth Login
app.get('/auth/login', (req: Request, res: Response) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const redirectUri = `${protocol}://${host}/auth/callback`;

  const state = generateState();
  saveOAuthState(state, redirectUri);

  const clientId = process.env.OAUTH_CLIENT_ID || '';
  const authorizeUrl = process.env.OAUTH_AUTHORIZE_URL || 'https://github.com/login/oauth/authorize';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state: state,
    response_type: 'code',
  });

  res.redirect(`${authorizeUrl}?${params.toString()}`);
});

// OAuth Callback
app.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;

  if (error) {
    res.status(400).send(`<h2>Erro OAuth: ${error}</h2>`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('<h2>Parâmetros code ou state ausentes.</h2>');
    return;
  }

  const validState = verifyAndConsumeOAuthState(state);
  if (!validState) {
    res.status(403).send('<h2>State OAuth inválido ou expirado.</h2>');
    return;
  }

  try {
    const accessToken = await exchangeCodeForToken(code, validState.redirectUri);
    const userProfile = await fetchUserProfile(accessToken);
    const session = createSession(userProfile, accessToken);

    res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Render MCP - Autenticado</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; max-width: 650px; margin: 0 auto; }
          .card { background: #111827; border-radius: 12px; padding: 2rem; border: 1px solid #10b981; }
          code { background: #1f2937; padding: 0.5rem 1rem; border-radius: 6px; color: #38bdf8; font-family: monospace; display: block; word-break: break-all; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="color: #10b981;">Autenticação Concluída (Render)</h2>
          <p>Olá, ${userProfile.name || userProfile.login || userProfile.id}</p>
          <p>Utilize este Bearer Token para seu cliente MCP:</p>
          <code>Authorization: Bearer ${session.sessionId}</code>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    res.status(500).send(`<h2>Erro no Callback OAuth: ${err?.message || 'Erro desconhecido'}</h2>`);
  }
});

// Auth Middleware para MCP
const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query.token) {
    token = String(req.query.token);
  }

  if (!token) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Não autorizado. Forneça Authorization: Bearer <session_token>' },
      id: null,
    });
    return;
  }

  const session = getSession(token);
  if (!session) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Sessão OAuth inválida ou expirada.' },
      id: null,
    });
    return;
  }

  req.session = session;
  next();
};

app.post('/mcp', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const session = req.session!;
  const mcpServer = createRenderMcpServer(session);

  const { jsonrpc, method, params, id } = req.body || {};

  if (method === 'initialize') {
    res.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'render-oauth-mcp-server', version: '1.0.0' },
      },
      id,
    });
    return;
  }

  try {
    let responseResult: any = null;
    let responseError: any = null;

    if (method === 'tools/list') {
      const handler = (mcpServer as any)._requestHandlers?.get('tools/list');
      if (handler) responseResult = await handler({ method: 'tools/list', params });
    } else if (method === 'tools/call') {
      const handler = (mcpServer as any)._requestHandlers?.get('tools/call');
      if (handler) responseResult = await handler({ method: 'tools/call', params });
    } else if (method === 'resources/list') {
      const handler = (mcpServer as any)._requestHandlers?.get('resources/list');
      if (handler) responseResult = await handler({ method: 'resources/list', params });
    } else if (method === 'resources/read') {
      const handler = (mcpServer as any)._requestHandlers?.get('resources/read');
      if (handler) responseResult = await handler({ method: 'resources/read', params });
    } else if (method === 'ping') {
      responseResult = {};
    } else {
      responseError = { code: -32601, message: `Método não encontrado: ${method}` };
    }

    if (responseError) {
      res.json({ jsonrpc: '2.0', error: responseError, id });
      return;
    }

    res.json({ jsonrpc: '2.0', result: responseResult, id });
  } catch (err: any) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: err?.message || 'Erro interno' },
      id,
    });
  }
});

// SSE endpoint
app.get('/mcp/sse', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const session = req.session!;
  const mcpServer = createRenderMcpServer(session);

  const transport = new SSEServerTransport('/mcp/message', res);
  await mcpServer.connect(transport);
});

app.listen(PORT, () => {
  console.log(`⚡ Render MCP Server rodando na porta ${PORT}`);
});
