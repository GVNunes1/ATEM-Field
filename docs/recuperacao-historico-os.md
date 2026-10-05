# Recuperação do histórico de OS

## Fontes verificadas pelo navegador em 05/10/2026

- [Formulários de Campo](https://drive.google.com/drive/folders/1OyWOz9SYtmVyOPr6eZYsJvjYTGZ8c9P-)
- [OS assinadas](https://drive.google.com/drive/folders/13OOs4zsvGJh9RGKJ1sK_hMugTmL-kmKi)
- [OS geradas / não assinadas](https://drive.google.com/drive/folders/1IWdsd9B2ZGRotVdzt6OVzu6NjM7SnRdS)

As pastas existem e são legíveis pelo navegador sem login. Entretanto, a credencial OAuth de produção do ATEM retorna HTTP 404 para as três pastas. Não substituir os IDs por esse motivo: a limitação é de acesso da credencial `drive.file`.

## Banco atual

Projeto `aorclbawxpjgrbdrcith`: tabelas `service_orders` e `equipments` criadas via MCP em `20261005121150_restore_service_order_database`. A ferramenta usa o cliente privilegiado do backend, mantendo a autenticação ATEM; acesso direto por anon/authenticated está bloqueado.

## Importador

`backend/src/services/recover_service_order_history.py` lê os PDFs originais sem reexportar, modificar ou apagar arquivos. Precisa das variáveis `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `GOOGLE_DRIVE_OAUTH_TOKEN_JSON_BASE64` (ou variantes suportadas pelo serviço Drive), em ambiente privado.

Prévia sem alteração no banco:

```powershell
python backend/src/services/recover_service_order_history.py
```

Importação após verificar o acesso e a prévia:

```powershell
python backend/src/services/recover_service_order_history.py --apply
```

O importador exige acesso a ambas as pastas antes da primeira inserção, percorre subpastas e paginação e evita reimportar o mesmo identificador de arquivo. PDFs diferentes com nomes iguais não são presumidos duplicados. Metadados parcialmente recuperados recebem `_recovery.partial_form` e os campos essenciais ausentes recebem `needs_review`. Não se reconstroem assinaturas a partir do texto. O status é derivado da pasta de origem, não de validação criptográfica.

Para arquivos que já são publicamente baixáveis, há um caminho independente do OAuth: copiar pelo navegador os IDs observados e preparar um JSON privado com arrays `signed` e `unsigned`. Executar `--public-manifest caminho.json --report caminho-privado.json`, primeiro sem `--apply`. Essa operação não torna nenhum arquivo público nem altera compartilhamento. A importação compara SHA-256 e ignora cópias binariamente idênticas, além de proteger contra reimportação por ID. PDFs distintos com nomes iguais permanecem separados. Não publicar o manifesto nem os relatórios operacionais no Git.

OS recuperadas contêm somente dados extraíveis, não o formulário completo original. A API impede sobrescrevê-las pelo editor: para alterar uma OS recuperada, criar uma nova OS e preservar o PDF histórico.

O catálogo antigo de equipamentos não está nos PDFs integralmente: reconstruir metadados de OS não recupera equipamentos que nunca tiveram OS. Nenhum dado anterior do banco excluído é considerado restaurado apenas por criar as tabelas.

## Validação realizada

- RLS e grants consultados por MCP: anon/authenticated sem acesso; backend service_role autorizado.
- Inserção e busca por série verificadas em transação com rollback, sem registros de teste persistidos.
- Testes isolados de geração/download continuam cobrindo funcionamento sem Drive/banco e preservação de PDFs históricos.
- Prévia com credencial de produção bloqueada antes de importar, por HTTP 404.

## Resultado da importação — 05/10/2026

100 PDFs identificados nas duas pastas pelo navegador; 91 registros recuperados (45 assinados e 46 não assinados). Nove cópias binariamente idênticas foram ignoradas, sem excluir nenhum arquivo no Drive. A importação terminou sem erros. Todos os registros importados possuem link para o PDF original.

Sete registros precisam de revisão: seis sem nome de técnico extraível e um sem data no formato reconhecido. Os demais campos permanecem conforme o texto do PDF, sem inferir nomes ou assinaturas. Relatórios detalhados ficam apenas em `backend/data/os-recovery-*.json`, ignorados pelo Git.

A API foi publicada no Northflank com o commit `f3ab5bd`; build e deploy concluídos, health saudável e endpoint de histórico recusando requisições sem login (HTTP 401). Os testes automatizados de OS (6) e recuperação (5) passaram. A geração e o template de PDF não foram alterados.

## Pendência independente

A credencial de produção ainda não consegue listar/enviar arquivos nessas pastas; a reconstrução por download público não corrige a integração OAuth. Não inferir que uma consulta vazia na API prova pasta vazia. Novas OS podem ser salvas no Supabase atual e baixadas localmente enquanto o upload ao Drive permanece pendente.
