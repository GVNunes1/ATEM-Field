# ATEM Field — planejamento do workflow no NocoBase

Status: respostas registradas em 17/09/2026 e consolidação revisada em 21/09/2026; implementação não autorizada. Entrevista em andamento para decisões restantes. Não criar código, instalar NocoBase, executar migrações ou publicar mudanças até ordem explícita do usuário.

Índice e sequência de entrega: [plano consolidado](./plano-consolidado-atem-field.md). Planos especializados: [workflow e permissões](./plano-workflow-nocobase.md), [frota e Field Control](./plano-frota-field-control.md) e [padrões/analisadores](./plano-padroes-analisadores.md).

Material para apresentação à gerência: [fluxograma de agendamento — versão em construção](./fluxograma-agendamento-gerencia.md). Atualizar os dois documentos conforme as respostas da entrevista, mantendo regras confirmadas separadas das pendências.

## Decisões confirmadas pelo usuário

- Usar NocoBase como base do painel customizável.
- Permitir campos customizáveis e encaminhamento de atividades.
- Contemplar comercial, supervisores, gerentes e técnicos.
- O gerente fica fora das etapas obrigatórias de agendamento e pode interagir com todos os usuários e fluxos.
- O gerente pode editar datas, trocar técnicos/carros, alterar prioridades, cancelar atendimentos e configurar campos e etapas. Isso não o torna automaticamente administrador de infraestrutura nem dispensa os registros de retirada.
- Comercial combina com o cliente uma data provisória e a registra no sistema.
- Supervisor escolhe técnico/equipe, valida disponibilidade e confirma a programação ao comercial. Carro pode ser definido depois, sem impedir validação ou confirmação do agendamento.
- Após a validação, equipe e carro se já escolhido ficam reservados enquanto o comercial confirma com o cliente. Não haverá expiração automática dessa reserva por inatividade do fluxo.
- Pode haver notificação após dois dias sem alterações no fluxo; contagem, destinatários, alterações relevantes e repetição serão definidos antes da implementação.
- Comercial recebe a validação interna e termina de agendar com o cliente. A validação do supervisor e a confirmação com o cliente são marcos distintos.
- Técnico recebe a atribuição com data e horário das atividades, sem etapa obrigatória de aceite/recusa.
- Técnico pode visualizar a programação provisória, identificada como ainda não confirmada pelo cliente.
- Um atendimento pode envolver vários técnicos no mesmo carro.
- Técnico seleciona os padrões/analisadores necessários; seleção efetivada já reserva em qualquer momento da agenda provisória ou confirmada.
- Padrões/analisadores reservados, emprestados ou com outro impedimento não podem ser retirados. Confirmado em 18/09: a exceção "vencido" significa calibração/certificado vencido, permitindo retirada com aviso. Isso não libera uma reserva incompatível nem um empréstimo em aberto.
- Mudanças solicitadas pelo técnico são encaminhadas ao supervisor.
- A frota terá fluxo próprio de retirada/devolução, acessível a usuários de qualquer nível. Não será uma operação exclusiva do supervisor ou exclusivamente dependente de agendamento.
- Havendo reserva vinculada à agenda, qualquer integrante escalado nela pode retirar o carro. Não há exigência de condutor único previamente escolhido; deve ser identificado quem efetivamente retirou.
- Carro reservado para amanhã pode ser retirado hoje por outro usuário, com verificação de horários e margem de retorno. A duração da margem e a antecedência de retirada ainda serão definidas.
- Retirada de carro exige KM atual e foto; danos são questionados na retirada e na devolução. A devolução também inclui perguntas sobre abastecimento e calibragem dos pneus.
- Manter intacto o PDF da ferramenta de relatório de campo, incluindo seu contrato de geração.

## Proposta inicial para discussão

Proposta de organização: o atendimento reúne cliente, unidade/local, serviço solicitado, campos customizados, agendamentos e atividades. Uma atividade tem um responsável e um próximo passo; múltiplos técnicos podem participar e qualquer escalado pode retirar o carro, ficando registrado o retirante real. A divisão das atividades ainda será detalhada. Etapa do processo e cargo são conceitos diferentes: pertencer à gerência não cria uma aprovação obrigatória.

Fluxo principal definido até a atribuição, com preparação e encerramento a detalhar:

1. Comercial registra a solicitação e a data provisória combinada com o cliente.
2. Supervisor escolhe equipe e verifica disponibilidade; carro pode ser escolhido nessa etapa ou depois.
3. Supervisor confirma a programação ao comercial; equipe e carro se já escolhido ficam reservados, sem liberação automática por inatividade.
4. Comercial conclui o agendamento com o cliente.
5. Em paralelo à confirmação comercial, o técnico já pode ver suas atividades provisórias com data e horário e selecionar padrões/analisadores. Visibilidade não implica autorização automática para iniciar atendimento ou retirar carro antes da confirmação; essas regras operacionais ainda serão definidas.
6. Técnico executa e registra o resultado; os estados de execução ainda serão definidos.
7. Atendimento é encerrado conforme critérios ainda a definir.

O técnico solicita mudanças ao supervisor. O caminho de retorno ao comercial e ao cliente em um reagendamento ainda precisa ser detalhado. Pendências, devoluções e cancelamentos também serão transições explícitas, com permissões e motivos a definir.

Estados candidatos para o painel: Data provisória → Em validação pelo supervisor → Aguardando confirmação do cliente → Agendado → Em preparação → Em atendimento → Concluído. Estes nomes e o critério de cada passagem são propostas de implementação.

Recursos a considerar na disponibilidade: técnicos, veículos e padrões/analisadores. A reserva de técnico/carro após validação está confirmada e não expira por falta de movimentação no fluxo. Isso é diferente do intervalo agendado de uso: uso anterior por terceiros está permitido quando horários e margem de retorno não conflitam. A margem exata e as antecipações ainda serão definidas. Seleção efetivada já gera reserva de analisador, em agenda provisória ou confirmada; retirada é um marco físico distinto.

Gerente: acesso/interação transversal e poderes de edição, reagendamento, troca de técnicos/carros, prioridades, cancelamento e configuração de campos/etapas confirmados. Proposta: intervenções registradas com autor, momento e motivo quando pertinente. Reatribuição da agenda não equivale a retirada física do carro por qualquer pessoa; conflitos e exigências de identificação permanecem. Perfil gerencial não implica automaticamente acesso de administrador técnico da plataforma.

## Estrutura proposta do painel

- Minha fila: atividades sob minha responsabilidade, prazos e pendências.
- Solicitações: entrada e acompanhamento comercial por cliente.
- Planejamento: fila do supervisor, seleção de técnico e carro, disponibilidade e retorno ao comercial.
- Confirmações comerciais: programações validadas aguardando conclusão com o cliente.
- Agenda: visualização por técnico/equipe e veículo com tratamento de conflitos.
- Preparação técnica: seleção de padrões/analisadores vinculada às atividades e solicitações de mudança ao supervisor.
- Frota: veículos, reservas e posse atual; retirada com KM/foto/vistoria, devolução com vistoria/abastecimento/pneus e histórico. Cadastro, bloqueios e manutenção a detalhar no plano específico.
- Atendimento: dados, atividades, anexos, comentários e histórico de mudanças.
- Visão gerencial: acompanhamento transversal por equipe, prazo e situação.
- Configuração autorizada: campos, opções, obrigatoriedade e regras de encaminhamento.

Os nomes, telas e visualizações são propostas, não requisitos fechados.

## Entrevista — rodada 1: responsáveis e passagem de trabalho

1. Origem e confirmação: respondido. Comercial registra data provisória; supervisor valida técnico e carro e retorna ao comercial; comercial confirma com o cliente.
2. Técnico: respondido. Recebe atribuição com data e horário, seleciona padrões/analisadores e solicita mudanças ao supervisor.
3. Poderes do gerente: respondido na rodada seguinte. Pode exercer os poderes operacionais e de configuração sugeridos, sem se tornar aprovador obrigatório.

## Entrevista — respostas recebidas em 17/09/2026

Numeração correspondente ao último questionário respondido pelo usuário:

1. Pré-reserva: sim, já fica reservado. Sem prazo limite; considerar notificação após dois dias sem alterações no fluxo.
2. Equipe/frota: sim para vários técnicos. Usuários de todos os níveis poderão retirar carros; carro reservado à agenda só pode ser retirado pelo usuário da agenda. Exigir KM/foto de saída, danos na saída/retorno e perguntas de abastecimento/calibragem dos pneus no retorno. O usuário pediu pesquisa do Field Control e plano próprio para o menu.
3. Técnico: pode enxergar a programação provisória.
4. Analisadores: bloquear retirada de reservados, emprestados e demais impedidos; permitir "vencido" com aviso. Em 18/09, usuário confirmou que significa calibração/certificado vencido.
5. Gerente: pode executar todas as ações sugeridas (editar datas, trocar técnicos/carros, prioridades, cancelamentos e configuração de campos/etapas).

Observação: "carro não ficará travado para o supervisor determinar na agenda" não deve ser convertido silenciosamente em reserva infinita e exclusiva de toda a frota nem em dupla retirada. Em 21/09 foi confirmado que o carro pode ser definido depois; a margem e os detalhes da janela operacional continuam pendentes.

### Complemento confirmado em 18/09/2026

1. Uso de carro antes de uma reserva futura por outro usuário está permitido, com verificação de horários e margem de retorno.
2. Qualquer integrante escalado na agenda pode retirar o carro reservado; identificar o retirante efetivo, sem condutor único obrigatório.
3. "Vencido" significa calibração/certificado vencido; reserva, empréstimo e demais impedimentos continuam bloqueando retirada.

## Próximas rodadas da entrevista

### Rodada 2 — atendimento e dados

- Tipos de serviço e eventuais fluxos diferentes por tipo.
- Cliente, unidade, contato, endereço, equipamento, prioridade e janela de atendimento: quais campos são obrigatórios em cada etapa?
- Além do gerente, quem pode criar campos customizados e quais perfis podem vê-los/alterá-los?
- Quais dados comerciais devem ficar restritos?
- Com múltiplos técnicos já permitidos, como definir responsável principal pelo atendimento, várias visitas e atividades simultâneas? A elegibilidade de retirada já abrange qualquer integrante escalado.
- A duração prevista é informada por atividade, pelo atendimento inteiro ou como janela de disponibilidade?

### Rodada 3 — distribuição e exceções

- O supervisor recebe automaticamente por região, unidade, carteira ou equipe, ou alguém escolhe?
- Os supervisores enxergam somente suas equipes ou compartilham uma fila?
- Como tratar ausência, férias, impossibilidade de executar, atraso, urgência e substituição?
- Quem pode reagendar/cancelar, como registrar o motivo e quem confirma a mudança com o cliente?
- Quais regras de disponibilidade precisam bloquear conflitos: horário, deslocamento, especialidade ou recursos?
- Seleção já gera reserva em agenda provisória ou confirmada. Como retirar a reserva própria, distinguir compromissos alheios e registrar liberação? Como lidar com certificado/data desconhecidos, que não são automaticamente a mesma condição de calibração vencida?
- Quem cadastra veículos e registra indisponibilidade/manutenção? Todo atendimento exige carro ou há exceções?
- No aviso após dois dias, usar dias corridos ou úteis? Quem recebe, quais mudanças reiniciam a contagem e haverá repetição/escalonamento?

### Rodada 4 — encerramento e integração

- O que caracteriza conclusão: execução, relatório, assinatura, validação do supervisor ou retorno do comercial?
- Onde o calendário passa a ser controlado: NocoBase, Google Agenda ou uma sincronização com regras definidas?
- Como cliente e usuários recebem notificações; o cliente precisa acessar um portal?
- Como vincular o atendimento aos técnicos, reservas e relatório já existentes no ATEM Field?
- O painel de workflow será acessado pelo NocoBase ou terá navegação unificada com o ATEM Field?

## Recursos e limites verificados

- Workflow visual e tarefas manuais estão disponíveis na edição comunitária.
- O nó Manual pausa a execução e cria uma tarefa para um usuário. A documentação atual limita esse nó a um único responsável. Filas compartilhadas, trabalho em equipe e substituição precisam ser modelados e testados.
- Departamentos permitem hierarquia e chefias. O escopo de acesso de cada perfil precisa ser configurado; a hierarquia organizacional, sozinha, não define todas as permissões.
- Calendário exibe eventos e agendamentos. Regras de capacidade, deslocamento e prevenção de conflitos serão parte da solução a configurar/desenvolver.
- O plugin específico de Approval é Professional Edition+. Não presumir sua necessidade para um fluxo operacional com tarefas manuais.
- Histórico automático de registros (Record History) é Professional Edition+; auditoria atual de usuários/API (Audit Logger) é Enterprise Edition+. O antigo plugin Audit Logs está depreciado. Um histórico de encaminhamentos próprio é uma alternativa de domínio, mas não equivale à auditoria nativa integral.
- Permissão gerencial para editar atividades não garante poder de concluir ou transferir tarefas internas do nó Manual. O protótipo deve validar a intervenção do gerente. Uma alternativa é controlar atividades em registros próprios com ações autorizadas e automações curtas.
- O gatilho de horário não recupera automaticamente uma execução perdida enquanto o servidor estava parado. Para prazos operacionais, prever consulta periódica das pendências vencidas com prevenção de notificações duplicadas.
- O conector de banco PostgreSQL externo e o conector REST API são comerciais. Integrações próprias exigem desenvolvimento; a escolha ficará explícita antes da implementação.
- A licença do NocoBase incorpora Apache 2.0 com termos adicionais. A resposta anterior não deve ser interpretada como uma licença Apache 2.0 sem restrições adicionais de marca/distribuição.

## Compatibilidade com o ATEM Field

A implementação existente sincroniza eventos do Google Agenda com registros de atendimento usando identificadores externos, inclusive alterações de data/hora e cancelamentos. A integração nova deve definir a origem de cada atualização para evitar sobrescrever reagendamentos ou criar atendimentos duplicados.

Proposta a validar: protótipo com dados fictícios, seguido de integração por identificadores estáveis e contrato de API. A definição de onde cada informação é mantida precede qualquer migração de dados.

O relatório de campo continua sendo gerado pelo módulo atual. O workflow pode registrar o vínculo com o relatório, sem alterar seu conteúdo, formato ou geração.

## Etapas previstas após a entrevista e autorização explícita

1. Consolidar estados, transições, responsáveis, campos e exceções em um plano revisável.
2. Definir edição/plugins, integração de usuários e agenda, além dos custos de hospedagem e licenças.
3. Prototipar um atendimento completo no NocoBase com contas fictícias de cada perfil.
4. Verificar a volta supervisor → comercial, confirmação do cliente, escolha de técnico/carro, seleção de analisadores, acesso entre equipes, campos restritos e solicitações de mudança.
5. Integrar ao ATEM Field e validar o contrato existente do relatório de campo.
6. Realizar um piloto com uma equipe antes da expansão.

## Fontes oficiais

- Workflow: https://docs.nocobase.com/workflow
- Tarefas manuais: https://docs.nocobase.com/workflow/nodes/manual
- Approval: https://docs.nocobase.com/plugins/@nocobase/plugin-workflow-approval/
- Departamentos: https://docs.nocobase.com/users-permissions/departments/
- Permissões: https://docs.nocobase.com/security/guide
- Calendário: https://docs.nocobase.com/plugins/@nocobase/plugin-calendar/
- Campos: https://docs.nocobase.com/data-sources/data-modeling/collection-fields
- PostgreSQL externo: https://docs.nocobase.com/data-sources/external/postgresql
- REST API: https://docs.nocobase.com/data-sources/data-source-rest-api/
- Licença: https://github.com/nocobase/nocobase/blob/main/LICENSE.txt
- Histórico de registros: https://docs.nocobase.com/plugins/@nocobase/plugin-record-history
- Auditoria atual: https://docs.nocobase.com/plugins/@nocobase/plugin-audit-logger/
- Auditoria antiga depreciada: https://docs.nocobase.com/plugins/@nocobase/plugin-audit-logs/
- Execuções por horário: https://docs.nocobase.com/workflow/triggers/schedule
## Complemento confirmado em 21/09/2026

- Supervisor pode definir o carro depois da validação/confirmação do agendamento. Registrar carro a definir, sem reserva fictícia.
- Seleção efetivada de padrões/analisadores já cria reserva, em qualquer momento da agenda provisória ou confirmada. Não depende de confirmação adicional.
- Margem de retorno ainda sem valor definido. Roteiro de execução preparado no plano consolidado, aguardando ordem de construção.
