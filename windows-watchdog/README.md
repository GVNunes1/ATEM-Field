# Watchdog Excel → Supabase do ATEM Field

Automação independente que observa uma planilha local e envia suas alterações diretamente ao Supabase. Não é necessário iniciar o backend Node, Python, navegador ou a sincronização do Google Agenda.

O instalador reconhece dois formatos:

- **Padrões/analisadores:** planilha `PAT03-F1 - Controle de Calibração.xls`, enviada para `analyzers`;
- **Agenda de campo:** planilha de atendimentos, enviada para `appointments` e tabelas relacionadas.

## Compatibilidade

- Windows 7 SP1 ou superior;
- Windows PowerShell 2.0 ou superior;
- .NET Framework 3.5.1, componente do Windows 7;
- Microsoft Excel instalado, usado via COM para ler `.xlsx`, `.xlsm`, `.xls` e `.xlsb`;
- acesso HTTPS ao domínio do projeto Supabase.

Não são usados módulos PowerShell, `supabase-js`, Node ou Python. HTTPS usa o WinHTTP 5.1 do Windows com TLS 1.2 explícito e o Agendador usa o `schtasks.exe` nativo. No Windows 7, mantenha o SP1, as atualizações de TLS e os certificados raiz instalados.

## Instalação em outro computador

1. Copie a pasta do watchdog ou o projeto para o computador que ficará ligado.
2. Dê duplo clique em `instalar-watchdog.bat`.
3. Informe o caminho completo da planilha naquele computador.
4. Informe a URL e a `service_role key` do Supabase, caso não exista um `backend\.env` junto ao projeto.
5. O restante é automático: tipo da planilha, aba, cabeçalho, mapeamento, localização padrão e intervalos de monitoramento.
6. O instalador testa a conexão, executa uma simulação completa sem gravar dados e instala o watchdog.
7. O watchdog é iniciado imediatamente e voltará a iniciar no logon do mesmo usuário.

Se a planilha estiver em uma unidade de rede mapeada, como `Z:\`, o instalador tenta salvar o caminho UNC persistente automaticamente e usa intervalos mais tolerantes à rede. Se a aba for renomeada depois, o sincronizador volta a localizá-la pelos cabeçalhos.

Ao abrir `instalar-watchdog-excel.bat` depois de uma instalação concluída, ele apenas informa que a tarefa já existe e mostra seu estado. Para trocar o arquivo ou as credenciais, use `reconfigurar-watchdog-excel.bat`.

Se o instalador informar que `setup-watchdog.ps1` está ausente, o ZIP não foi extraído por completo ou um antivírus colocou o script em quarentena. Extraia o ZIP inteiro para uma nova pasta e verifique a quarentena se o arquivo desaparecer novamente.

A chave é protegida pelo DPAPI em `watchdog.credential`. Somente o mesmo usuário do Windows consegue descriptografá-la; ela não aparece na configuração nem nos logs.

## Planilha PAT03-F1 — Controle de Calibração

O layout é reconhecido pelos cabeçalhos `PAT`, `Descrição / Marca` e `Próxima calibração`. Para o arquivo analisado, o instalador detecta:

- aba `CONTROLE DE CALIBRAÇÃO - MATRIZ`;
- cabeçalho na linha 4;
- modo `Analyzers`.

### Mapeamento para `analyzers`

| Planilha | Supabase |
| --- | --- |
| `PAT` | `asset_tag` — chave única do upsert |
| `Descrição / Marca` | `name` e tipo derivado |
| `Modelo` | `brand_model` |
| `Nº Série` | `serial_number` |
| `Data Calibração` | `calibration_date` |
| `Próxima calibração` | `calibration_expiry` e `calibration_due` |
| `Localização` | `current_location` |
| Certificado, executor, aprovador, periodicidade e exclusividade | `notes` |

Quando `Localização` está vazia, o valor configurado no instalador é usado; o padrão é `Matriz`.

O `PAT` é lido como texto para preservar zeros à esquerda. Linhas sem PAT ou descrição são ignoradas com aviso. PATs repetidos interrompem a sincronização para impedir que um equipamento sobrescreva outro.

O status operacional não vem da planilha e **não é sobrescrito**. Assim, um padrão que esteja `Reservado`, `Em Uso` ou `Em Calibração` continua com o mesmo status. Novos padrões recebem o padrão do banco, `Disponível`.

Categorias são inferidas somente quando há correspondência segura com as categorias existentes: desfibrilador, monitor, ventilador/fluxo, bomba, ultrassom, autoclave e bisturi/eletrocirúrgico. Os demais padrões permanecem sem categoria em vez de receber uma categoria incorreta.

Registros removidos do Excel não são apagados nem desativados no Supabase.

## Planilhas de agenda

O modo de agenda continua disponível. Os cabeçalhos são normalizados, ignorando acentos e pontuação. Os principais nomes reconhecidos são:

| Campo | Cabeçalhos reconhecidos |
| --- | --- |
| ID estável | `ID`, `ID Externo`, `Código`, `ID Evento`, `Chave` |
| Atendimento | `Título`, `Serviço`, `Evento`, `Atendimento`, `Assunto` |
| Cliente | `Cliente`, `Hospital`, `Unidade`, `Local` |
| Data/hora | `Data`, `Data Atendimento`, `Hora`, `Horário`, `Início` |
| Técnicos | `Técnico`, `Técnicos`, `Responsável`, `Equipe` |
| Equipamento | `Equipamento`, `Categoria`, `Modelo`, `Serial`, `Setor`, `Tag` |

No modo de agenda, `appointments.external_id` é a chave única e as linhas repetidas com o mesmo ID são agrupadas como equipamentos do mesmo atendimento.

## Funcionamento do watchdog

- observa tamanho e data de modificação do arquivo;
- espera o arquivo parar de mudar antes de abri-lo;
- abre o Excel somente para leitura;
- impede duas sincronizações simultâneas;
- usa upsert por chave única, evitando duplicações;
- envia lotes de até 100 padrões por requisição;
- repete automaticamente falhas temporárias;
- só marca o arquivo como concluído quando todo o ciclo termina;
- rotaciona o log ao atingir 5 MB.

## Operação

- `simular-sincronizacao.bat`: mostra o que seria criado ou atualizado, sem gravar;
- `sincronizar-agora.bat`: força uma sincronização;
- `iniciar-watchdog.bat`: inicia em segundo plano;
- `parar-watchdog.bat`: solicita uma parada limpa;
- `status-watchdog.bat`: informa `ATIVO` ou `PARADO`;
- `remover-watchdog.bat`: remove a tarefa agendada e preserva configuração e credencial.

Os logs ficam em `logs\watchdog.log`. A assinatura do último arquivo concluído fica em `state\last-success.txt`.

## Arquivos locais

- `watchdog.config.ps1`: caminho e parâmetros, sem segredo;
- `watchdog.credential`: URL e chave cifradas pelo Windows;
- `logs\` e `state\`: log, pedido de parada e estado do último arquivo.

Esses arquivos são ignorados pelo Git. Se o caminho da planilha mudar, execute `instalar-watchdog.bat` novamente.
