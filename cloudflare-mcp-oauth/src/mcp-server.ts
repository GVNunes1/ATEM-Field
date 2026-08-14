import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { UserSession } from './oauth-helper.js';

export function createCloudflareMcpServer(session: UserSession) {
  const server = new Server(
    {
      name: 'cloudflare-oauth-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Registro das ferramentas MCP (Tools)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get_user_profile',
          description: 'Retorna os dados do perfil do usuário autenticado via OAuth',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'system_status',
          description: 'Verifica a saúde do servidor MCP no Cloudflare Workers',
          inputSchema: {
            type: 'object',
            properties: {
              detailed: {
                type: 'boolean',
                description: 'Se true, inclui informações da sessão do usuário',
              },
            },
          },
        },
        {
          name: 'echo_authenticated_message',
          description: 'Echo de mensagem formatado com a identidade OAuth do usuário',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Mensagem para processar',
              },
            },
            required: ['message'],
          },
        },
      ],
    };
  });

  // Execução de ferramentas MCP (CallTool)
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'get_user_profile': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  authenticated: true,
                  user: session.user,
                  sessionId: session.sessionId,
                  createdAt: session.createdAt,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'system_status': {
        const detailed = Boolean(args?.detailed);
        const status = {
          status: 'ok',
          runtime: 'Cloudflare Workers (Edge)',
          mcpVersion: '1.0.0',
          timestamp: new Date().toISOString(),
          ...(detailed ? { sessionUser: session.user.name || session.user.login || session.user.id } : {}),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      case 'echo_authenticated_message': {
        const message = String(args?.message || '');
        const userName = session.user.name || session.user.login || `ID ${session.user.id}`;
        return {
          content: [
            {
              type: 'text',
              text: `[Usuário OAuth Autenticado: ${userName}]: ${message}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  });

  // Recursos MCP (Resources)
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'info://user-profile',
          name: 'Perfil do Usuário Autenticado',
          mimeType: 'application/json',
          description: 'Dados da sessão atual do usuário logado via OAuth',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === 'info://user-profile') {
      return {
        contents: [
          {
            uri: 'info://user-profile',
            mimeType: 'application/json',
            text: JSON.stringify(session.user, null, 2),
          },
        ],
      };
    }
    throw new Error(`Recurso não encontrado: ${request.params.uri}`);
  });

  return server;
}
