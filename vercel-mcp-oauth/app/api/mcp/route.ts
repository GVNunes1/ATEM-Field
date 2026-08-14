import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/oauth-store';
import { createVercelMcpServer } from '@/lib/mcp-server';

function authenticate(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    token = request.nextUrl.searchParams.get('token') || '';
  }

  if (!token) return null;
  return getSession(token);
}

export async function POST(request: NextRequest) {
  const session = authenticate(request);
  if (!session) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Não autorizado. Forneça o header Authorization: Bearer <session_token>.' },
        id: null,
      },
      { status: 401 }
    );
  }

  const mcpServer = createVercelMcpServer(session);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, { status: 400 });
  }

  const { jsonrpc, method, params, id } = body;

  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'vercel-oauth-mcp-server', version: '1.0.0' },
      },
      id,
    });
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
      return NextResponse.json({ jsonrpc: '2.0', error: responseError, id });
    }

    return NextResponse.json({ jsonrpc: '2.0', result: responseResult, id });
  } catch (err: any) {
    return NextResponse.json({ jsonrpc: '2.0', error: { code: -32603, message: err?.message || 'Internal error' }, id }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = authenticate(request);
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json({
    status: 'online',
    platform: 'Vercel Serverless',
    user: session.user,
  });
}
