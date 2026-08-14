import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { UserSession } from './oauth-store.js';

export function createVercelMcpServer(session: UserSession) {
  const server = new Server(
    {
      name: 'vercel-oauth-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_vercel_user',
          description: 'Retorna os dados do usuário autenticado no servidor MCP hospedado na Vercel',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'vercel_deployment_status',
          description: 'Retorna informações de saúde do servidor MCP na infraestrutura Vercel Serverless',
          inputSchema: {
            type: 'object',
            properties: {
              region: {
                type: 'string',
                description: 'Região opcional para checagem',
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'get_vercel_user') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                provider: 'Vercel Serverless',
                authenticated: true,
                user: session.user,
                sessionId: session.sessionId,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'vercel_deployment_status') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'operational',
                platform: 'Vercel Serverless Functions',
                nodeVersion: process.version,
                requestedRegion: args?.region || 'auto',
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Ferramenta não encontrada: ${name}`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'vercel://session-info',
          name: 'Informações da Sessão Vercel MCP',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'vercel://session-info') {
      return {
        contents: [
          {
            uri: 'vercel://session-info',
            mimeType: 'application/json',
            text: JSON.stringify(session, null, 2),
          },
        ],
      };
    }
    throw new Error(`Recurso não encontrado: ${request.params.uri}`);
  });

  return server;
}
