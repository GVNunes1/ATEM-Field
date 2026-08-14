# Cloudflare Workers Remote MCP Server com OAuth 2.0

Este repositório contém uma implementação de referência de um **Servidor MCP (Model Context Protocol) Remoto** rodando no **Cloudflare Workers** e protegido por autenticação **OAuth 2.0** (GitHub OAuth, Google ou provedor personalizado).

A solução permite expor ferramentas (tools), recursos (resources) e prompts para assistentes de IA (como Claude Desktop, Cursor ou Cloudflare Agents SDK) mantendo controle total de acesso, identificação e armazenamento seguro de sessões na Edge.

---

## 📐 Arquitetura

```
               +-------------------------------------------------+
               |             Provedor OAuth (ex: GitHub)          |
               +-----------------------+-------------------------+
                                       ^
                   1. Login / Auth Code| 2. Exchange Token
                                       v
+------------------+         +---------+-------------------------+
|                  |         |                                   |
| Cliente MCP      |-------->| Cloudflare Worker (Hono Router)   |
| (Claude/Cursor)  |<--------|                                   |
|                  |         +-----------------+-----------------+
+------------------+                           |
  Authorization: Bearer <session_token>        | 3. Grava/Lê Sessão
                                               v
                                     +---------+-----------------+
                                     | Cloudflare KV (OAUTH_KV)  |
                                     +---------------------------+
```

---

## 🚀 Como Executar Localmente

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) v18 ou superior.
- Conta no [Cloudflare](https://dash.cloudflare.com/) com CLI `wrangler` instalado (`npm install -g wrangler`).
- Um **OAuth App** registrado no seu provedor de identidade (ex: [GitHub Developer Settings](https://github.com/settings/developers)).
  - **Authorization Callback URL**: `http://localhost:8787/auth/callback` (em desenvolvimento) ou `https://seu-worker.workers.dev/auth/callback` (em produção).

### 2. Instalação de Dependências
No diretório `cloudflare-mcp-oauth`:
```bash
npm install
```

### 3. Configuração do Cloudflare KV Namespace
Crie um Namespace KV para armazenar sessões e estados temporários OAuth:
```bash
npx wrangler kv namespace create OAUTH_KV
```

Copie o `id` retornado no terminal e cole no arquivo [`wrangler.jsonc`](file:///c:/Users/tecnico.mmAT31/Documents/antigravity/quick-turing/cloudflare-mcp-oauth/wrangler.jsonc):
```jsonc
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "COLE_O_ID_AQUI"
  }
]
```

### 4. Configuração dos Segredos OAuth
Defina os segredos da aplicação via Wrangler:
```bash
# Para desenvolvimento local (.dev.vars)
echo "OAUTH_CLIENT_SECRET=seu_client_secret_github" > .dev.vars

# Para ambiente de produção no Cloudflare
npx wrangler secret put OAUTH_CLIENT_SECRET
```

Edite as variáveis públicas no [`wrangler.jsonc`](file:///c:/Users/tecnico.mmAT31/Documents/antigravity/quick-turing/cloudflare-mcp-oauth/wrangler.jsonc):
- `OAUTH_CLIENT_ID`: Client ID da sua aplicação GitHub OAuth.
- `OAUTH_AUTHORIZE_URL`: URL de autorização do provedor.
- `OAUTH_TOKEN_URL`: URL para troca de código por token.
- `OAUTH_USER_INFO_URL`: URL da API do perfil de usuário.

---

## 💻 Desenvolvimento Local

Inicie o servidor de desenvolvimento do Cloudflare Worker:
```bash
npm run dev
```

O servidor estará rodando em `http://localhost:8787`.

1. Abra `http://localhost:8787/` no seu navegador.
2. Clique em **🚀 Autenticar via OAuth** ou navegue até `http://localhost:8787/auth/login`.
3. Após concluir o login no provedor, você receberá a confirmação com seu **Bearer Token** de sessão.

---

## 🛠️ Conectando Clientes MCP

### Exemplo de Requisição HTTP (JSON-RPC 2.0)
Para enviar requisições ao servidor MCP no endpoint `/mcp`:

```bash
curl -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer <SEU_BEARER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
  }'
```

### Ferramentas (Tools) Incluídas:
1. `get_user_profile`: Retorna o perfil do usuário autenticado no provedor OAuth.
2. `system_status`: Retorna o status de saúde e métricas do Worker na Edge.
3. `echo_authenticated_message`: Formata a mensagem informando a identidade do usuário logado.

---

## 🚢 Deploy para Produção

Fazer o deploy para a rede global da Cloudflare:
```bash
npm run deploy
```

Seu servidor estará online em `https://mcp-server-oauth.<seu-subdominio>.workers.dev`.

---

## 🔐 Especificações de Segurança
- **OAuth 2.1 Protected Resource Metadata**: O endpoint `/.well-known/oauth-protected-resource` expõe a especificação oficial de descoberta OAuth para clientes MCP.
- **Armazenamento KV Criptografado/Temporário**: Os parâmetros `state` expiram automaticamente em 10 minutos (anti-CSRF). As sessões de usuários expiram em 7 dias com renovação.
