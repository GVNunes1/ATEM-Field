import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { UserSession } from './oauth-helper';

export function createRenderMcpServer(session: UserSession) {
  const server = new Server(
    {
      name: 'render-oauth-mcp-server',
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
          name: 'get_render_user',
          description: 'Retorna o perfil do usuário autenticado no servidor MCP hospedado no Render Web Service',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'render_service_health',
          description: 'Verifica o status e saúde do Web Service no Render',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'get_render_user') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                platform: 'Render Web Service',
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

    if (name === 'render_service_health') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'healthy',
                service: 'render-mcp-oauth',
                uptimeSeconds: process.uptime(),
                memoryUsage: process.memoryUsage(),
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Ferramenta desconhecida: ${name}`);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'render://service-info',
          name: 'Informações do Render Service',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'render://service-info') {
      return {
        contents: [
          {
            uri: 'render://service-info',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                platform: 'Render.com',
                uptime: process.uptime(),
                user: session.user,
              },
              null,
              2
            ),
          },
        ],
      };
    }
    throw new Error(`Recurso não encontrado: ${request.params.uri}`);
  });

  return server;
}
