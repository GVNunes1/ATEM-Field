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

O contêiner compila o frontend React, o backend Node/Express e instala o runtime Python, o Chromium e as fontes usadas pelo formulário PAT01-F2 original. O mesmo serviço entrega a SPA e a API; não é necessário publicar um frontend separado.

## Variáveis públicas de runtime

```env
NODE_ENV=production
PORT=8080
GOOGLE_CALENDAR_SYNC_ENABLED=true
GOOGLE_CALENDAR_SYNC_CRON=*/10 * * * *
TECHNICIAN_PORTAL_LINK_TTL_HOURS=72
CORS_ALLOWED_ORIGINS=https://URL-GERADA
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
OS_SUPABASE_URL
OS_SUPABASE_ANON_KEY
GOOGLE_DRIVE_OAUTH_TOKEN_JSON_BASE64
SUPPORT_LLM_API_URL (opcional)
SUPPORT_LLM_API_KEY (opcional)
SUPPORT_LLM_MODEL (opcional)
SUPPORT_LLM_REASONING_EFFORT (opcional; use `minimal` para Gemma 4)
SUPPORT_TTS_MODEL (opcional; padrão `gemini-3.1-flash-tts-preview`)
SUPPORT_TTS_VOICE (opcional; padrão `Kore`)
AZURE_SPEECH_REGION (opcional; necessário para a voz Azure)
AZURE_SPEECH_KEY (opcional; necessário para a voz Azure)
```

Não use variáveis de build para esses valores e não envie arquivos `.env` ou dados operacionais sensíveis ao GitHub. A FAQ curada do suporte é um artefato público do build; manuais e documentos internos devem permanecer no Storage privado.

`GOOGLE_DRIVE_OAUTH_TOKEN_JSON_BASE64` deve conter o `token.json` OAuth do ATEM OS codificado integralmente em Base64. Esse token precisa ter `refresh_token` e acesso `drive.file` às pastas originais. Não use a conta de serviço antiga para novos uploads em um Drive pessoal, pois contas de serviço não possuem cota própria nesse cenário.

Depois de confirmar o novo deploy, revogue a chave privada da conta de serviço antiga no Google Cloud caso nenhum outro processo ainda dependa dela.

No PowerShell, gere o valor sem modificar o arquivo original:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\caminho\para\token.json'))
```

## PDFs das ordens de serviço

O ATEM Field usa o mesmo template HTML/Jinja e o mesmo fluxo Chromium do ATEM OS para produzir o formulário Multmed PAT01-F2. Após a geração, o PDF é enviado imediatamente às pastas originais do Google Drive:

- não assinadas: `1IWdsd9B2ZGRotVdzt6OVzu6NjM7SnRdS`;
- assinadas: `13OOs4zsvGJh9RGKJ1sK_hMugTmL-kmKi`.

Quando o upload termina, o arquivo local é removido e a tabela `service_orders` guarda o link definitivo do Drive. Se o Drive estiver indisponível, a OS ainda é registrada sem uma URL remota falsa, o PDF local é preservado e o usuário recebe imediatamente um download autenticado pelo navegador, junto com o aviso de que o envio ficou pendente. Esse arquivo de contingência permanece somente na instância ativa; ele não substitui o arquivamento definitivo no Drive.

Ao baixar uma OS histórica que já possui link do Drive, o sistema sempre abre esse arquivo original, mesmo que exista uma cópia local residual. Se o original não for encontrado, o sistema retorna um aviso e nunca recria silenciosamente outro PDF.

O renderizador considera o documento pronto assim que encontra um PDF completo e estável, sem aguardar o Chromium encerrar sozinho. O timeout interno padrão é de 45 segundos e pode ser ajustado, quando necessário, com `PDF_RENDER_TIMEOUT_SECONDS` entre 5 e 75 segundos.

## Google Agenda

`GOOGLE_CALENDAR_TOKEN_JSON` deve conter um token que já tenha `refresh_token`. O OAuth local não deve ser iniciado dentro do contêiner. Se o Google revogar o acesso, autorize novamente em uma máquina local e substitua o segredo no Northflank.

Antes da autorização definitiva, abra **Google Cloud Console → Google Auth Platform → Audience** e confirme uma destas opções:

- aplicativo interno da organização; ou
- aplicativo externo com status **In production**.

Aplicativos externos em modo **Testing** recebem refresh tokens que expiram em 7 dias para o escopo do Google Calendar. Depois de ajustar o status, execute `renovar-google-agenda.bat`, copie o valor gerado em `google-calendar-token-northflank.txt` para o segredo `GOOGLE_CALENDAR_TOKEN_JSON` e reinicie o serviço.

Para manter o Render apenas como contingência, configure nele:

```env
GOOGLE_CALENDAR_SYNC_ENABLED=false
```

Isso impede que dois servidores executem a mesma sincronização automática.

O Blueprint oficial é o arquivo `render.yaml` na raiz e usa o mesmo Dockerfile da Northflank. A cópia antiga em `backend/render.yaml` foi removida para impedir que um deploy parcial publique somente a API, sem frontend, Chromium ou o template PAT01-F2.

## Verificação

Após o deploy, abra:

```text
https://URL-GERADA/health
```

A resposta esperada inclui `"status":"ok"` e `"apiVersion":4`.

Confirme também que a raiz pública retorna a interface do ATEM Field e que o contêiner está marcado como saudável. O Dockerfile possui um `HEALTHCHECK` próprio em `/health`, além da verificação configurada na plataforma.

Antes de publicar alterações no fluxo de OS, execute:

```powershell
cd backend
npm run test:service-orders
```
