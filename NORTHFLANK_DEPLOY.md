# ATEM Field no Northflank

## Serviço principal

Crie um **Combined Service** a partir do repositório GitHub `GVNunes1/ATEM-Field`.

- Branch: `main`
- Build type: `Dockerfile`
- Build context: `/`
- Dockerfile: `/Dockerfile`
- Porta pública: `8080`
- Protocolo: `HTTP`
- Health check: `GET /health` na porta `8080`
- Instâncias: `1`

O contêiner compila o frontend React, o backend Node/Express e instala o conector Python do Google Agenda.

## Variáveis públicas de runtime

```env
NODE_ENV=production
PORT=8080
GOOGLE_CALENDAR_SYNC_ENABLED=true
GOOGLE_CALENDAR_SYNC_CRON=*/10 * * * *
TECHNICIAN_PORTAL_LINK_TTL_HOURS=72
```

Depois do primeiro deploy, defina `PUBLIC_APP_URL` com a URL pública gerada pelo Northflank.

## Segredos de runtime

Cadastre estes valores em um Secret Group e vincule o grupo ao serviço:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
ENCRYPTION_MASTER_KEY
TECHNICIAN_PORTAL_SECRET
GOOGLE_CALENDAR_CREDENTIALS_JSON
GOOGLE_CALENDAR_TOKEN_JSON
```

Não use variáveis de build para esses valores e não envie arquivos `.env` ou `backend/data` ao GitHub.

## Google Agenda

`GOOGLE_CALENDAR_TOKEN_JSON` deve conter um token que já tenha `refresh_token`. O OAuth local não deve ser iniciado dentro do contêiner. Se o Google revogar o acesso, autorize novamente em uma máquina local e substitua o segredo no Northflank.

Para manter o Render apenas como contingência, configure nele:

```env
GOOGLE_CALENDAR_SYNC_ENABLED=false
```

Isso impede que dois servidores executem a mesma sincronização automática.

## Verificação

Após o deploy, abra:

```text
https://URL-GERADA/health
```

A resposta esperada inclui `"status":"ok"` e `"apiVersion":4`.
