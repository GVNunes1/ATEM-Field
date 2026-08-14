# Render.com Web Service Remote MCP Server com OAuth 2.0

Este projeto é uma implementação de referência de um **Servidor MCP Remoto** hospedado como um **Render Web Service (Node.js/Express)** e protegido por **OAuth 2.0**.

---

## 🛠️ Como Executar Localmente

### 1. Instalar Dependências
```bash
npm install
```

### 2. Configurar Variáveis de Ambiente
Crie um arquivo `.env`:
```env
PORT=10000
OAUTH_CLIENT_ID=seu_client_id_github
OAUTH_CLIENT_SECRET=seu_client_secret_github
OAUTH_AUTHORIZE_URL=https://github.com/login/oauth/authorize
OAUTH_TOKEN_URL=https://github.com/login/oauth/access_token
OAUTH_USER_INFO_URL=https://api.github.com/user
```

### 3. Rodar em Desenvolvimento
```bash
npm run dev
```
Acesse `http://localhost:10000`.

---

## 🚀 Deploy no Render.com

### Opção A: Blueprint automatizado (`render.yaml`)
1. Faça push do projeto para o seu repositório GitHub.
2. Na [Render Dashboard](https://dashboard.render.com/), clique em **New +** -> **Blueprint**.
3. Selecione o repositório. O Render lerá automaticamente o arquivo [`render.yaml`](file:///c:/Users/tecnico.mmAT31/Documents/antigravity/quick-turing/render-mcp-oauth/render.yaml).
4. Preencha os valores para `OAUTH_CLIENT_ID` e `OAUTH_CLIENT_SECRET` quando solicitado.

### Opção B: Web Service Manual no Render
1. Na Render Dashboard, escolha **New +** -> **Web Service**.
2. **Build Command**: `npm install && npm run build`
3. **Start Command**: `npm start`
4. Na aba **Environment**, insira as variáveis `OAUTH_CLIENT_ID` e `OAUTH_CLIENT_SECRET`.
