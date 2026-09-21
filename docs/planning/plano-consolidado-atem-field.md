# ATEM Field — plano consolidado de workflow, frota e recursos

Versão 0.5 · 21/09/2026 · Plano executado parcialmente no código; pendências de configuração identificadas, sem padrões assumidos silenciosamente.

## Limite desta entrega

Esta entrega preserva a documentação e registra a execução autorizada pelo usuário. Foram implementados os pacotes E02–E05 no backend/frontend existente, sem instalar o NocoBase, sem novas dependências e sem tocar no PDF. A migração aditiva foi criada, mas não aplicada ao Supabase porque o ambiente local não contém `SUPABASE_ACCESS_TOKEN`.

O PDF da ferramenta de relatório de campo está protegido integralmente: gerador, modelos, fontes/imagens, rotas, contratos de dados, impressão e download. Nenhum plano depende de modificá-lo.

## Leitura dos documentos

| Documento | Uso |
|---|---|
| [Fluxograma para a gerência](./fluxograma-agendamento-gerencia.md) | Apresentar o processo e as decisões restantes, sem detalhes técnicos excessivos. |
| [Planejamento-base e entrevista](./nocobase-workflow-agendamento.md) | Consultar os requisitos confirmados, histórico da entrevista e limitações do NocoBase. |
| [Workflow, permissões e notificações](./plano-workflow-nocobase.md) | Detalhar responsáveis, transições, gerência transversal e alerta de inatividade. |
| [Menu Frota e pesquisa Field Control](./plano-frota-field-control.md) | Planejar retirada, retorno, KM, fotos, vistorias, abastecimento e pneus. |
| [Padrões e analisadores](./plano-padroes-analisadores.md) | Planejar disponibilidade, reservas, empréstimos e aviso de vencimento. |

As respostas mais recentes prevalecem sobre hipóteses antigas. Cada plano distingue regra confirmada, proposta e decisão pendente. Os diagramas não significam funcionalidades já implantadas.

## Síntese das regras confirmadas

1. Comercial combina e registra uma data provisória.
2. Supervisor define técnico/equipe, verifica disponibilidade e retorna ao comercial. Confirmado em 21/09: o carro pode ser definido depois, sem impedir a validação ou confirmação do agendamento.
3. Após validação, equipe e carro já escolhido ficam reservados, sem expiração automática por inatividade. Sem veículo escolhido, registrar "carro a definir", sem reserva fictícia. O comercial conclui a confirmação com o cliente.
4. O técnico já pode ver a programação provisória. Recebe atividades com data/hora e seleciona padrões/analisadores; cada seleção efetivada já cria a reserva, em qualquer momento do agendamento provisório ou confirmado, sem aprovação ou ação separada para reservar. Mudanças são solicitadas ao supervisor. Não há etapa obrigatória de aceite/recusa.
5. Um atendimento pode envolver vários técnicos; qualquer integrante escalado pode retirar o carro reservado. Identificar quem efetivamente retirou, sem exigir condutor único previamente escolhido.
6. Usuários de qualquer nível podem retirar carros disponíveis. Também podem utilizar hoje um carro reservado para amanhã, respeitando horários e margem de retorno; durante o período protegido da agenda, a retirada cabe aos integrantes escalados.
7. Retirada exige KM atual e foto. Vistorias de danos acontecem na saída e no retorno; na devolução há perguntas sobre abastecimento e calibragem dos pneus.
8. Recursos reservados, emprestados ou com outro impedimento não podem ser retirados. Calibração/certificado vencido é exceção permitida com aviso, conforme confirmação expressa em 18/09; não supera outros bloqueios.
9. Gerente interage com todos e pode editar/reagendar, trocar técnicos/carros, alterar prioridades, cancelar e configurar campos/etapas; não se torna uma aprovação obrigatória do fluxo.
10. Pode haver aviso após dois dias sem alterações no fluxo. Isso não cancela atendimento nem libera recurso automaticamente.

## Regras de consistência propostas para toda a solução

- Separar disponibilidade para um intervalo, reserva da agenda e posse física atual do veículo/analisador. "Sem expiração" não significa que o veículo está fisicamente em uso para sempre.
- A tela informa; o servidor confirma permissão e disponibilidade no instante da ação. Ações simultâneas não podem produzir duas retiradas do mesmo recurso.
- Identificar usuários de qualquer perfil sem obrigar comercial, supervisor ou gerente a se cadastrar como técnico para retirar um carro.
- Gerente pode reatribuir uma agenda, mas essa edição não equivale a uma devolução física nem autoriza falsificar a identidade de quem retira. Registrar mudanças e continuar aplicando a regra de retirada.
- Não transformar calibração vencida em autorização para ignorar reserva, empréstimo, manutenção ou bloqueio por dano.
- Não exigir que o usuário declare que abasteceu/calibrou quando não o fez. Registrar respostas negativas e pendências; a política de liberação será definida separadamente.
- Registrar devolução física mesmo quando há pendência de vistoria/upload, sem tornar o veículo disponível antes da conferência prevista. A forma dessa exceção precisa de validação operacional.
- Tratar alteração de campos/etapas de forma versionada, com prévia de impacto sobre atendimentos em andamento e histórico preservado.
- Testar permissões por ação e por registro, além de ocultação de botões. A aplicação atual e o NocoBase devem aplicar a mesma identidade e as mesmas restrições.

## Decisões que faltam antes de codificar

| ID | Decisão | Proposta de trabalho, ainda não aprovada |
|---|---|---|
| D01 | Qual é a margem de retorno e a antecedência de retirada? | Uso anterior por terceiro está confirmado, desde que não conflite com horários e margem. Falta quantificar a margem e definir tolerâncias. |
| D02 — resolvida | Quem é "usuário da agenda" em uma equipe com vários técnicos? | Confirmado: qualquer integrante escalado pode retirar. Registrar o retirante efetivo; duas retiradas simultâneas continuam impedidas. |
| D03 — parcialmente resolvida | Carro posterior está permitido; pode retirar com agenda provisória? | Não exigir veículo para validar/confirmar. A autorização de retirada física antes da confirmação do cliente continua pendente e não decorre da visibilidade ou reserva. |
| D04 — parcialmente resolvida | Seleção já reserva; quais eventos a liberam e como retirar uma reserva própria? | Reserva imediata na seleção em agenda provisória ou confirmada está confirmada. Restam eventos de liberação, período protegido e procedimento de retirada própria. |
| D05 | O que conta como dois dias sem alterações e quem recebe? | 48 horas corridas, contando somente mudanças operacionais relevantes; um aviso por ciclo de inatividade, sem expiração. Detalhes no plano de workflow. |
| D06 | Quais perguntas/evidências são obrigatórias na devolução? Quem resolve dano/KM divergente? | KM e foto no retorno recomendados pela referência pesquisada, além dos questionários pedidos; pendências administrativas não devem apagar retorno físico. |
| D07 | Onde cada informação será editada e qual agenda é a referência? | Definir responsabilidades entre NocoBase, ATEM Field e Google Agenda antes de sincronizar; não permitir escrita concorrente sem regra de conflito. |
| D08 | Quais campos, serviços, filas, notificações e critérios de conclusão? | Continuar entrevista; criar configuração autorizada, sem apresentar a estrutura candidata como requisito fechado. |

Também detalhar cancelamento/reagendamento, manutenção da frota, devolução por terceiro, prazo de retenção das fotos e extensão da visibilidade entre equipes. As pendências não impedem entregar o plano, mas não podem virar decisões silenciosas durante implementação.

## Sequência proposta, somente após autorização

As respostas de 18/09 e 21/09 resolveram uso antes de reserva futura com margem, retirada por qualquer integrante escalado, significado de vencido, definição posterior do carro e reserva automática na seleção do analisador. A margem de retorno (D01) não foi respondida; não assumir 30 ou 60 minutos. Permanecem as decisões listadas para ativação de cada módulo.

### Fase 0 — fechar regras e viabilidade

Resolver os itens ainda abertos de D01–D08, custos/edição NocoBase, hospedagem, identidade dos usuários, integração e responsável por cada dado. Produzir critérios de aceite finais. Não comprar nem habilitar plugins automaticamente.

### Fase 1 — protótipo isolado

Prototipar com dados fictícios o ciclo comercial → supervisor → comercial e visibilidade provisória do técnico. Demonstrar gerência transversal, formulários customizados e mudanças de etapa sem alterar produção.

### Fase 2 — agendamento e reservas

Implementar regras aprovadas de reserva, conflitos, reatribuição, cancelamento e aviso após dois dias, com prevenção de duplicidades e recuperação de falhas. Nenhuma liberação automática por inatividade.

### Fase 3 — menu Frota

Implementar cadastro/consulta, retirada autorizada, KM/foto, inspeção de saída, posse atual, retorno físico, inspeção de volta, abastecimento/pneus e histórico. Priorizar fluxo móvel completo; QR Code é conveniência proposta, não requisito confirmado.

### Fase 4 — padrões/analisadores

Integrar seleção, reserva e retirada/devolução conforme as regras fechadas; manter impedimentos e permitir a exceção confirmada de calibração/certificado vencido com aviso.

### Fase 5 — integração e piloto

Testar identidade/permissões entre os sistemas, sincronização da agenda, anexos, concorrência e reenvios. Executar piloto pequeno com plano de reversão que preserve os registros produzidos. Preservar o PDF e seus contratos.

## Portão de qualidade proposto

- [ ] Validar e confirmar agendamento sem carro não falha; "carro a definir" não aparece como veículo reservado.
- [ ] Atribuir carro posteriormente consulta disponibilidade atual e não altera silenciosamente data, confirmação do cliente ou posse física.
- [ ] Selecionar analisador na agenda provisória ou confirmada gera reserva imediatamente, sem etapa extra; falha de conflito não apresenta sucesso.
- [ ] Confirmar o cliente ou repetir a mesma seleção não cria reserva duplicada; manter vínculo com a atividade.
- [ ] Nenhuma dupla reserva/retirada conflitante quando duas pessoas confirmam ao mesmo tempo.
- [ ] Reserva permanece após dois dias; eventual aviso não altera a disponibilidade sozinho.
- [ ] Técnico distingue provisório de confirmado; gerente não aparece como aprovador obrigatório.
- [ ] Usuário de qualquer nível consegue retirar carro livre e usar antes de reserva futura sem conflito, respeitando a margem definida.
- [ ] Qualquer integrante escalado consegue retirar o carro na janela protegida; usuário externo à agenda não consegue. Duas pessoas escaladas não criam posses simultâneas.
- [ ] Reatribuição/cancelamento não apaga posse em aberto, fotos, vistoria ou histórico.
- [ ] Falha de câmera, upload, rede ou reenvio não produz sucesso falso nem movimento duplicado.
- [ ] Aviso de calibração vencida não libera equipamento emprestado/reservado/impedido.
- [ ] Questionários aceitam respostas reais; "não abasteci" não pode ser transformado em "sim" para devolver.
- [ ] Campos privados e anexos permanecem protegidos no servidor, inclusive contra acesso direto.
- [ ] Fluxos móveis têm ações acessíveis, validação clara e navegação com movimento reduzido.
- [ ] Não há regressão nas rotas, autenticação e funções existentes; PDF permanece intacto.

## Divisão do trabalho desta entrega

Três subagentes contribuíram com os planos especializados de workflow, frota e padrões/analisadores. O agente principal revisou os documentos, consolidou as decisões e manteve o fluxograma. A revisão cruzada verifica especialmente conflitos entre reserva sem expiração, carro com múltiplos usuários e acesso gerencial amplo. A pesquisa de frota está documentada com fontes oficiais; o questionário de vistoria foi detalhado como proposta, sem atribuí-lo ao Field Control.

## Revisão de 18/09/2026

- Os seis documentos de planejamento foram reunidos neste índice, sem alterações na aplicação.
- Incorporadas as respostas de 18/09: uso anterior por terceiro com margem, retirada por qualquer integrante escalado e confirmação da exceção de calibração/certificado vencido.
- A reserva sem expiração por inatividade permanece como requisito. O marco de reserva dos analisadores, pendente em 18/09, foi resolvido em 21/09: seleção já reserva. Eventos explícitos de liberação ainda precisam de definição.
- A configuração gerencial continua ampla no negócio, sem se transformar em liberação irrestrita de infraestrutura ou recursos fisicamente em uso.
- A devolução física foi separada da conferência administrativa e dos questionários.
- A minuta de perguntas da frota admite respostas reais e registra pendências; não obriga abastecimento ou calibragem em toda viagem.
- Testes listados nos planos são critérios para execução futura, não testes já realizados.

## Ordem de execução preparada para a autorização

Este é o roteiro de construção, não uma autorização para executá-lo. As regras confirmadas estão prontas para orientar o trabalho. Decisões ainda abertas serão resolvidas antes do trecho que depende delas, sem impedir planejamento dos demais módulos.

| Ordem | Pacote de trabalho | Entrega e verificação esperadas |
|---|---|---|
| E01 | Preparação controlada | Conferir estado do projeto, preservar alterações existentes e contrato do PDF; decidir versão/edição/hospedagem NocoBase, identidade e origem dos dados antes de instalar/conectar. |
| E02 | Núcleo do agendamento | Comercial → supervisor → comercial; equipe reservada; carro opcional nesta etapa; técnico vê provisória; gerente transversal sem aprovação obrigatória. |
| E03 | Reservas de padrões/analisadores | Seleção já reserva em provisório ou confirmado; validar conflito e avisar calibração vencida; impedir duplicidade e posse incompatível. Não criar botão adicional obrigatório de aprovação da reserva. |
| E04 | Vinculação posterior de carro | Permitir "a definir"; ao atribuir, verificar período/disponibilidade e criar vínculo/reserva coerente. Proposta: reserva junto à confirmação da atribuição, sem exigir refazer o fluxo comercial. |
| E05 | Retirada/devolução de frota | Integrantes escalados elegíveis, uso anterior compatível, KM/foto saída, danos saída/retorno e perguntas de abastecimento/pneus. Fechar margem e política de retorno antes de ativar retiradas. |
| E06 | Configuração e notificações | Campos/etapas configuráveis pelo gerente; histórico das alterações; alerta de dois dias sem expiração, após fechar destinatários, relógio e repetição. |
| E07 | Integração, regressão e piloto | Dados fictícios primeiro; validar concorrência, permissões, reenvios, agenda e fotos; preservar PDF; ativação em produção somente no escopo autorizado. |

Propostas técnicas para E03: seleção salva e reserva devem ter resultado consistente; se a disponibilidade mudar durante o preenchimento, informar conflito sem criar seleção falsamente reservada. Uma reserva existente da mesma atividade deve ser reconhecida, não duplicada nem tratada como recurso livre para outras demandas. Retirada física é outra ação e mantém suas verificações.

Condição de prontidão: roteiro e critérios documentados; construção aguarda ordem expressa. A ordem para construir não implica compra de licença, migração destrutiva ou publicação irrestrita. Não iniciar operação de recurso que dependa de decisão ainda pendente.

### Atualização de 21/09/2026

- Carro pode ser escolhido depois da validação/confirmação; ainda deve estar identificado antes de sua retirada.
- Seleção de padrões/analisadores já efetiva reserva em agenda provisória ou confirmada, sem esperar outro marco do fluxo.
- Planos especializados e fluxograma alinhados às duas decisões. Margem de retorno permanece sem valor aprovado.

### Status da execução autorizada

- [x] API de workflow com status de agenda, confirmação comercial, validação do supervisor e vínculo posterior opcional de veículo.
- [x] Reserva imediata e idempotente de padrão/analisador, inclusive em agenda provisória, com aviso de calibração vencida e bloqueios de posse/manutenção.
- [x] Menu Frota com cadastro (admin), retirada e devolução; KM, fotos, vistoria de danos, abastecimento, pneus e histórico.
- [x] Controle de retirada: membro escalado pode retirar o veículo da agenda; posse simultânea é bloqueada.
- [x] Navegação e Agenda exibem a etapa do workflow; gerência/admin pode avançar as etapas disponíveis.
- [x] Builds do backend e frontend executados com sucesso; PDF não foi alterado.
- [ ] Aplicar `backend/migrations/002_workflow_fleet.sql` no Supabase configurado. Comando preparado: `node scripts/apply_migration.js 002_workflow_fleet.sql` (requer `SUPABASE_ACCESS_TOKEN`).
- [ ] Fechar numericamente margem de retorno, política de pendência, liberação de reservas, destinatários do alerta de dois dias e fonte de verdade NocoBase/ATEM Field antes da ativação operacional.
