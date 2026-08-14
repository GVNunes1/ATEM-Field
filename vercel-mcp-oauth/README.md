# Vercel Serverless Remote MCP Server com OAuth 2.0

Este projeto é uma implementação de referência de um **Servidor MCP Remoto** hospedado na **Vercel** usando **Next.js App Router (Serverless Functions)** e protegido por **OAuth 2.0**.

---

## 🛠️ Como Executar Localmente

### 1. Instalação de Dependências
```bash
npm install
```

### 2. Variáveis de Ambiente
Crie um arquivo `.env.local` com as credenciais OAuth:
```env
OAUTH_CLIENT_ID=seu_client_id_github
OAUTH_CLIENT_SECRET=seu_client_secret_github
OAUTH_AUTHORIZE_URL=https://github.com/login/oauth/authorize
OAUTH_TOKEN_URL=https://github.com/login/oauth/access_token
OAUTH_USER_INFO_URL=https://api.github.com/user
```

### 3. Rodar Localmente
```bash
npm run dev
```
Acesse `http://localhost:3000`.

---

## 🚢 Deploy na Vercel

### Opção A: Vercel CLI
```bash
npx vercel
```

### Opção B: Integração Git na Dashboard Vercel
1. Conecte o repositório na [Dashboard Vercel](https://vercel.com/new).
2. Configure as variáveis de ambiente na seção **Environment Variables**:
   - `OAUTH_CLIENT_ID`
   - `OAUTH_CLIENT_SECRET`
   - `OAUTH_AUTHORIZE_URL`
   - `OAUTH_TOKEN_URL`
   - `OAUTH_USER_INFO_URL`
3. O deploy será feito automaticamente em `https://seu-projeto.vercel.app`.
