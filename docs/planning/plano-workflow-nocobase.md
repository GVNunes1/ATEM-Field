# ATEM Field — plano funcional do workflow no NocoBase

Versão inicial: 17/09/2026. Revisão documental: 21/09/2026. Status: planejamento e entrevista; nenhuma implantação foi iniciada por este documento. As datas das pesquisas oficiais permanecem identificadas na seção de recursos do NocoBase.

Este plano consolida as respostas mais recentes e detalha propostas para discussão. A construção, instalação, configuração de uma instância, integração e publicação somente poderão começar depois de uma ordem explícita do usuário para implementar. Aprovar uma regra de negócio durante a entrevista não constitui, por si só, essa ordem.

Referências de contexto: [planejamento da entrevista](./nocobase-workflow-agendamento.md) e [fluxograma para a gerência](./fluxograma-agendamento-gerencia.md). Se uma versão anterior desses documentos ainda indicar como pendente uma resposta registrada aqui, prevalece a resposta mais recente do usuário, com posterior consolidação editorial.

## 1. Como ler as decisões

- **Confirmado:** informação expressamente dada pelo usuário.
- **Proposto:** desenho recomendado para discussão; ainda não deve ser tratado como regra aprovada.
- **Pendente:** falta uma decisão de negócio ou uma verificação técnica antes de construir o trecho dependente.

Os nomes de estados, telas, ações e conceitos de informação abaixo são propostas. Este documento não define esquema de banco de dados, tabelas, tipos de colunas, SQL ou migrações.

## 2. Regras confirmadas

1. O painel será planejado com NocoBase, com campos customizáveis e encaminhamento de atividades entre comercial, supervisores, gerentes e técnicos.
2. Comercial combina uma data provisória com o cliente e a registra no sistema.
3. Supervisor escolhe os técnicos e, se já definido, o carro, verifica a disponibilidade e valida a programação, devolvendo-a ao comercial.
4. A validação interna do supervisor e a confirmação final com o cliente são marcos distintos. Comercial conclui a confirmação com o cliente.
5. Após a validação, os recursos da programação ficam reservados, mesmo enquanto a confirmação do cliente está pendente. Essas reservas não expiram automaticamente por inatividade.
6. Técnico vê a programação provisória. Não há etapa obrigatória de aceite ou recusa do técnico.
7. Um atendimento pode envolver múltiplos técnicos.
8. Técnico seleciona padrões/analisadores e já os reserva ao efetivar a seleção, em qualquer momento da agenda provisória ou confirmada. Encaminha solicitações de mudança ao supervisor.
9. Gerente fica fora do fluxo obrigatório de agendamento e interage com todos os usuários e fluxos. Pode editar, reagendar, reatribuir técnicos e carros, alterar prioridade, cancelar e configurar campos e etapas.
10. A frota permite retirada por usuários de qualquer nível. Para utilizar o veículo na programação reservada, qualquer integrante escalado na agenda pode retirá-lo; não é obrigatório um condutor único. Uma retirada anterior à reserva futura por outro usuário também é permitida, desde que horários e margem de retorno sejam verificados.
11. É permitido prever uma notificação após dois dias sem alterações. O detalhe do relógio, dos destinatários e da repetição ainda não está confirmado.
12. O PDF da ferramenta de relatório de campo permanece intacto, incluindo conteúdo, formato e contrato de geração.
13. Padrões/analisadores reservados, emprestados ou indisponíveis por outros bloqueios não podem ser selecionados como disponíveis. Calibração/certificado vencido é uma exceção permitida com aviso; esse vencimento não libera um recurso que também esteja reservado, emprestado ou sujeito a outro bloqueio.
14. A frota tem fluxo de retirada/devolução independente do agendamento. Na saída são registrados KM, foto e danos; no retorno são registrados danos, abastecimento e pneus. Confirmado em 21/09: o carro pode ser definido depois, sem impedir validação ou confirmação do agendamento.

A validação reserva a equipe e o carro se já escolhido. Carro pode ficar a definir, sem reserva fictícia e sem impedir avanço comercial. A seleção efetivada de padrões/analisadores já cria reserva em qualquer momento da agenda provisória ou confirmada, sem ação adicional de aprovação/reserva. Proposta: atribuir veículo depois verifica disponibilidade e efetiva reserva junto à atribuição. Procedimento de retirada própria e eventos de liberação permanecem pendentes.

## 3. Processo principal e estados propostos

O atendimento representa a demanda do cliente. A programação organiza quando e com quais recursos essa demanda será executada. Atividades representam o trabalho a realizar; uma programação pode envolver vários técnicos. O próximo responsável pelo processo pode ser comercial ou supervisor, mesmo quando técnicos já estão designados para a execução.

Esta separação é uma proposta funcional: permite que o técnico acompanhe uma agenda provisória sem transformá-lo no responsável pela confirmação comercial.

| Estado proposto | Significado e responsável pelo próximo passo | Recursos e visibilidade |
|---|---|---|
| Data provisória | Comercial registrou o combinado inicial; envio à supervisão ainda pode ser necessário | O registro da data, sozinho, não foi definido como reserva |
| Em validação | Supervisor verifica disponibilidade e escolhe os recursos da programação; carro pode ser definido depois | Técnicos já atribuídos podem ver a programação provisória; o instante exato de publicação da atribuição é pendente |
| Aguardando confirmação do cliente | Supervisor validou; comercial conclui o combinado com o cliente | Técnicos e carro vinculado já reservados; técnico vê indicação de provisória/cliente pendente |
| Agendado | Comercial registrou a confirmação do cliente | Preserva as reservas existentes, sem criar reservas duplicadas |
| Em preparação | Técnico organiza os padrões/analisadores e os requisitos da visita | Entrada e necessidade desse estado dependem da definição da preparação |
| Em atendimento | Execução em andamento | Regras de início e acompanhamento ainda pendentes |
| Aguardando encerramento | Execução terminada, mas há evidências ou verificações pendentes | Estado opcional, condicionado aos critérios de conclusão |
| Concluído | Critérios de encerramento atendidos | Critérios, responsável e liberação dos recursos ainda serão definidos |
| Cancelado | Atendimento cancelado por quem tenha permissão | Efeitos sobre reservas, retiradas já abertas e comunicação devem ser definidos |

“Pedido de mudança” é proposto como uma pendência associada ao atendimento, não como substituição automática de seu estado. Assim, uma atividade agendada continua identificável enquanto a alteração é analisada. “Atrasado” e “sem alterações há dois dias” também são indicadores, não cancelamentos ou aprovações automáticas.

### 3.1 Transições e ações

| Origem → destino/efeito | Quem age | Situação da regra | Condições ou decisões dependentes |
|---|---|---|---|
| Registro inicial → Data provisória | Comercial | Confirmado; nome do estado proposto | Campos obrigatórios por serviço ainda pendentes |
| Data provisória → Em validação | Comercial | Encaminhamento implícito no fluxo; ação explícita proposta | Definir se salvar já encaminha ou se existe botão “Enviar à supervisão” |
| Em validação → Aguardando confirmação do cliente | Supervisor | Confirmado | Validar disponibilidade e efetivar as reservas dos recursos escolhidos; carro ausente não impede validar |
| Em validação → Ajustes comerciais | Supervisor | Proposto | Motivo de devolução e necessidade de nova data com o cliente |
| Aguardando confirmação do cliente → Agendado | Comercial | Confirmado | Registrar a confirmação; evidência necessária ainda pendente |
| Atribuição provisória → visualização pelo técnico | Sistema, após atribuição visível | Confirmado | Exibir claramente que a confirmação do cliente está pendente |
| Programação → seleção de padrões/analisadores | Técnico | Confirmado | Reservados, emprestados e outros bloqueios impedem seleção; calibração/certificado vencido é permitido com aviso. Seleção efetivada já reserva em provisório ou confirmado; resta detalhar retirada da reserva própria |
| Programação → pedido de mudança | Técnico → supervisor | Confirmado | Mudança solicitada não altera silenciosamente data, técnico ou carro |
| Agendado → preparação → execução → encerramento | Responsáveis a definir | Proposto | Estados opcionais, evidências e responsabilidade pelo encerramento pendentes |
| Atendimento ativo → edição/reagendamento/reatribuição/prioridade | Gerente | Confirmado | Aplicar regras de disponibilidade e registrar a alteração; reconfirmação com o cliente pendente |
| Atendimento ativo → Cancelado | Gerente | Confirmado | Motivo, notificações e efeitos sobre retirada em andamento pendentes |
| Qualquer etapa → interação gerencial | Gerente | Confirmado | Não cria parada nem aprovação gerencial obrigatória |

Proposta: validação e reserva devem produzir um único resultado consistente. Se algum técnico ou veículo escolhido não estiver disponível, a ação deve indicar o conflito e manter a programação sem validar parcialmente. A semântica de conflito, incluindo deslocamento e compartilhamento de carro, precisa ser fechada antes dessa implementação. Carro pode ser omitido nesta etapa, conforme confirmado em 21/09; ausência não é conflito de disponibilidade.

Proposta: reagendamento e substituição devem validar os novos recursos e a nova janela antes de abandonar as reservas anteriores. A forma técnica de garantir essa consistência será definida posteriormente. Alteração gerencial não significa autorização para dupla reserva.

Pendente: se a mudança afetar o combinado com o cliente, deve voltar à confirmação comercial? A recomendação é distinguir “alteração interna” de “alteração que exige reconfirmação”, sem decidir antecipadamente quais campos pertencem a cada classe.

## 4. Permissões operacionais

Legenda da matriz: **C** = confirmado; **P** = proposto; **?** = pendente. “Não presumido” significa que a entrevista não autorizou essa capacidade; não é uma proibição de negócio já decidida.

| Ação | Comercial | Supervisor | Técnico | Gerente |
|---|---|---|---|---|
| Criar solicitação e data provisória | C | ? | ? | ?: criação inicial; edição transversal já confirmada |
| Validar disponibilidade e escolher técnicos/carro | ? | C | Não presumido; pede mudança | C: intervenção e reatribuição; não é etapa obrigatória |
| Confirmar agendamento com o cliente | C | ? | Não presumido | ? Pode intervir, mas substituição formal do comercial precisa ser definida |
| Ver programação provisória | C: sua demanda; abrangência ? | C: planejamento; abrangência ? | C: atribuições recebidas | C: todos os fluxos |
| Selecionar padrões/analisadores | ? | ? | C | ? Edição transversal não define ainda o procedimento de reserva |
| Solicitar mudança | P | P | C: encaminha ao supervisor | C: pode interagir e também alterar diretamente |
| Reagendar, trocar técnicos/carro e prioridade | ? | ? Após tratar pedido, extensão a definir | Não presumido; pede mudança | C |
| Cancelar atendimento | ? | ? | Não presumido | C |
| Comentar e encaminhar atividades | P: no escopo autorizado | P: no escopo autorizado | P: no escopo autorizado | C: interação transversal; canais exatos propostos |
| Retirar veículo disponível | C: qualquer nível | C: qualquer nível | C: qualquer nível | C: qualquer nível |
| Retirar veículo para a programação reservada | C: se integrante escalado | C: se integrante escalado | C: qualquer integrante escalado | C: se integrante escalado |
| Retirar antes de uma reserva futura | C: horários e margem de retorno compatíveis | C: horários e margem de retorno compatíveis | C: horários e margem de retorno compatíveis | C: horários e margem de retorno compatíveis |
| Encerrar atendimento | ? | ? | ? | ? Critério e responsável ainda não definidos |

O gerente não recebe exceção automática à proteção do período reservado. As mesmas regras se aplicam a todos: integrante escalado pode retirar para sua agenda; outro usuário pode usar antes de uma reserva futura somente quando horários e margem de retorno forem compatíveis. Alterar a atribuição operacional e retirar um carro são ações diferentes. O processo de troca de responsável deve ser definido e rastreado, sem criar um atalho implícito para contornar a reserva.

Pendente: escopo dos demais perfis por equipe, região, carteira e unidade; visibilidade de dados comerciais; possibilidade de um usuário acumular papéis; quem assume tarefas quando o responsável está ausente.

## 5. Configuração do negócio versus administração do sistema

| Capacidade | Decisão |
|---|---|
| Gerente criar/editar campos customizados e etapas de negócio | Confirmado |
| Gerente definir obrigatoriedade e visibilidade desses campos | Proposto como parte da configuração; regras de restrição e abrangência precisam ser confirmadas |
| Gerente criar novos fluxos, alterar encaminhamentos e publicar versões | Pendente: configurar etapas foi autorizado, mas o alcance da publicação e efeito sobre atendimentos ativos precisa ser detalhado |
| Gerente criar usuários, alterar senhas e distribuir papéis administrativos | Não presumido; pendente |
| Instalar plugins, mudar conexões, acessar segredos, backups e infraestrutura | Administração técnica separada proposta; não decorrente do cargo gerente |
| Remover campos já utilizados ou alterar o significado de etapas existentes | Pendente; proposta de arquivar/versionar para preservar o histórico |

Proposta: configuração de negócio pode ser oferecida em uma área própria do painel. O direito de configurar campos não deve ser implementado simplesmente concedendo acesso irrestrito a todas as configurações técnicas do NocoBase. A viabilidade da separação precisa ser validada na versão selecionada.

Proposta: mudanças publicadas valem inicialmente para novas solicitações. Migrar atendimentos em andamento exige uma regra específica e prévia; nunca presumir que renomear ou remover uma etapa cancela tarefas abertas.

## 6. Reservas, frota e múltiplos técnicos

### 6.1 Reservas persistentes

Confirmado: a validação do supervisor já reserva os recursos, e a falta de movimentação não desfaz essas reservas. A notificação de dois dias é informativa e operacional; não libera recurso, cancela atendimento, confirma cliente ou exige aceite do técnico.

Proposto: toda visualização diferencia “recurso reservado” de “cliente confirmado”. Um compromisso pode estar reservado e continuar provisório em relação ao cliente.

Pendente: eventos que liberam recursos — cancelamento, substituição, término da janela ou encerramento — e comportamento quando a data do atendimento passa sem conclusão. Não implementar liberação por decurso de tempo ou por inatividade com base apenas neste plano.

### 6.2 Frota e retirada

Confirmado: usuários de qualquer nível podem participar da retirada. Qualquer integrante escalado na agenda pode retirar o carro para a programação reservada, sem exigência de condutor único. A retirada/devolução possui fluxo independente do agendamento.

Confirmado: um carro reservado amanhã pode ser retirado hoje por outro usuário, desde que a verificação de horários e a margem de retorno preservem a reserva futura. Ter reserva futura não significa indisponibilidade durante todo o período anterior. A duração da margem, a antecedência para retirada e a política para atrasos ainda precisam ser definidas. Essas condições são temporais e iguais para todos os cargos.

Dados já confirmados da frota:

- Saída: registro de KM, foto e danos.
- Retorno: registro de danos, abastecimento e pneus.

Não estão sendo presumidos KM ou foto obrigatórios no retorno, nem outros itens de inspeção além dos confirmados. O formato de cada registro e quem o preenche ou confere ainda precisam ser detalhados.

Pendências que impedem fechar a retirada:

1. Um atendimento com vários técnicos usa um único carro, pode usar vários ou depende do caso?
2. Qual antecedência permite retirar para a própria agenda e qual janela determina horário, tolerância e devolução prevista?
3. Qual é a duração da margem de retorno para uso antes de reserva futura? Como considerar deslocamento e reagir ao atraso, sem colocar a reserva seguinte em conflito?
4. Quem preenche e quem confere os registros já definidos — KM, foto e danos na saída; danos, abastecimento e pneus no retorno? Qual formato/obrigatoriedade condicional de cada registro e há conferência física por outra pessoa?
5. Como tratar carro já retirado quando o gerente troca a atribuição, cancela ou reagenda?
6. Quem cadastra manutenção, indisponibilidade e bloqueios? Esses eventos afetam agendas existentes de que forma?

Proposto: cancelamento de atendimento não deve registrar uma devolução física fictícia. Uma retirada aberta exige resolução explícita, conforme regra a aprovar.

Confirmado em 21/09: supervisor pode validar o atendimento sem carro e vinculá-lo depois. Proposta: atribuição posterior valida disponibilidade e cria reserva, sem reiniciar confirmação comercial apenas pela escolha do veículo. Identificar o carro antes da retirada; a autorização de saída com agenda provisória ainda precisa de decisão.

### 6.3 Trabalho em equipe

Confirmado: múltiplos técnicos podem compor o atendimento. Pendente: se as atividades são compartilhadas ou individuais, se há líder da equipe e se concluir uma atividade por um técnico conclui o trabalho dos demais.

Proposto: separar participantes da execução do responsável pela próxima ação administrativa. Para cada atividade que precise de responsabilidade individual, encaminhar a uma pessoa identificada; para trabalho coletivo, definir uma regra de conclusão da equipe antes da construção.

### 6.4 Padrões/analisadores e exceção de vencimento

Confirmado: recursos reservados, emprestados ou com outros bloqueios de indisponibilidade ficam impedidos de seleção. A exceção já autorizada é o recurso com calibração/certificado vencido, que pode ser utilizado com aviso. Essa exceção não elimina outro bloqueio simultâneo: um recurso também emprestado, por exemplo, não se torna disponível apenas porque o vencimento é permitido.

Pendente: conteúdo e local do aviso de calibração/certificado vencido. O significado do vencimento e a permissão da exceção já foram respondidos; não reabrir essas decisões.

Confirmado em 21/09: seleção efetivada já reserva, em agenda provisória ou confirmada, sem ação extra. Proposta: reconhecer reserva existente da mesma atividade, sem duplicar nem liberar para outra demanda. Detalhar o procedimento de retirada própria e eventos explícitos de liberação.

## 7. Notificação após dois dias sem alterações

Confirmado: pode existir notificação após dois dias sem alterações. Todas as definições abaixo são **propostas para aprovação**, não uma política já fechada.

| Aspecto | Proposta | Decisão necessária |
|---|---|---|
| Duração | 48 horas corridas | Confirmar corridas ou dias úteis e eventual calendário de feriados |
| Escopo inicial | Solicitações em validação e programações aguardando confirmação do cliente | Incluir ou não agendadas, preparação, execução e pedidos de mudança |
| Início da contagem | Entrada no estado monitorado ou última alteração operacional relevante, o que for mais recente | Confirmar se criação de rascunho inicia contagem |
| Alterações que reiniciam | Mudança efetiva de etapa, data/horário, responsável, técnicos, carro, prioridade ou informações necessárias à próxima ação | Fechar os campos; decidir se comentário substantivo reinicia |
| Eventos que não reiniciam | Abrir tela, sincronização sem mudança de conteúdo, salvar sem alteração ou gerar notificação | Confirmar essa distinção |
| Destinatário principal | Responsável pelo próximo passo: supervisor durante validação; comercial durante confirmação do cliente | Definir fallback quando não houver responsável individual |
| Ciência da supervisão | Supervisor responsável também recebe quando a pendência está com o comercial | Confirmar cópia e canal |
| Gerência | Indicador no painel; mensagem direta apenas se uma regra de escalonamento for aprovada | Definir se gerente deve receber o primeiro alerta ou outro prazo |
| Técnicos | Mantêm a visibilidade da provisória; não recebem cobrança de confirmação comercial por padrão | Confirmar se devem receber cópia informativa |
| Canal inicial | Notificação interna no painel | E-mail, WhatsApp e outros canais precisam de definição e integração |
| Repetição | Uma notificação por ciclo contínuo de inatividade; nova alteração relevante inicia novo ciclo | Confirmar se deve repetir e em qual frequência |
| Conteúdo | Atendimento, etapa, responsável atual, tempo parado, próximo passo e ligação para abrir o registro | Definir dados sensíveis que não podem sair em canais externos |
| Efeito sobre reservas | Nenhum: permanecem reservadas | Regra já confirmada; não sujeita a expiração automática |

Proposta técnica em nível funcional: consultar periodicamente pendências vencidas e registrar quais alertas já foram emitidos. Reexecutar a verificação não deve gerar duplicações. Se o serviço ficar indisponível, a próxima consulta deve identificar o que ficou pendente, respeitando o mesmo ciclo de alerta. O intervalo de consulta e o fuso de apresentação ainda precisam ser definidos.

Exemplo proposto: supervisor valida na segunda às 10h e a programação aguarda o cliente. Sem alteração relevante, o alerta vence na quarta às 10h. Os técnicos e o carro continuam reservados. Se comercial registra uma alteração relevante na terça às 15h, a próxima contagem vence na quinta às 15h. O exemplo pressupõe a proposta de 48 horas corridas.

## 8. Painel e informação funcional

As áreas abaixo são propostas de organização, ajustáveis na entrevista:

- **Minha fila:** próxima ação, responsável, prazo e pendências.
- **Solicitações comerciais:** demanda, cliente, local, contato e data provisória.
- **Planejamento da supervisão:** escolha de técnicos/carro, disponibilidade, validação e pedidos de mudança.
- **Confirmações com cliente:** programações internamente validadas, com recursos já reservados.
- **Agenda:** filtros por técnico, equipe, carro, situação da confirmação e período.
- **Preparação técnica:** atividades, padrões/analisadores e pendências de disponibilidade.
- **Frota:** disponibilidade, reservas e fluxo independente de retirada/devolução; KM, foto e danos na saída; danos, abastecimento e pneus no retorno; janela e responsáveis ainda a detalhar.
- **Atendimento:** informações, atividades, comentários, evidências e histórico dos encaminhamentos.
- **Visão gerencial:** visão transversal, atrasos, intervenções e configuração autorizada de campos/etapas.

Conceitos a representar: cliente e unidade; solicitação e serviço; programação e seus participantes; atividades e responsável pelo próximo passo; recursos reservados; retirada/devolução; pedido de mudança; histórico de movimentações; vínculo com relatório. A forma de persistência desses conceitos fica para a fase técnica autorizada.

Pendente: catálogo de serviços, campos obrigatórios por etapa, campos comerciais restritos, anexos, prioridade, duração, fuso, recorrência, atendimentos que não exigem carro e atendimento de um cliente em múltiplas visitas.

## 9. NocoBase: recursos, edição e limitações

Verificação documental em 17/09/2026. Edições e condições devem ser reconferidas para a versão escolhida antes de instalar ou contratar.

| Necessidade | Disponibilidade documentada | Consequência para este plano |
|---|---|---|
| Workflow visual | Community Edition+ | Base para eventos, condições e atualização de atividades. [Documentação](https://docs.nocobase.com/workflow) |
| Pendências humanas, nó Manual | Community Edition+, incorporado | O nó documentado aceita um único responsável. Múltiplos técnicos não podem ser tratados como múltiplos destinatários desse mesmo nó. [Manual](https://docs.nocobase.com/workflow/nodes/manual) |
| Departamentos e hierarquia | Community Edition+ | Organiza equipes e chefias; permissões e escopos ainda precisam de configuração explícita. [Departamentos](https://docs.nocobase.com/plugins/@nocobase/plugin-departments/) |
| Calendário | Community Edition+ | Exibe compromissos; regras de conflito, deslocamento e retirada serão regras próprias da solução. [Calendário](https://docs.nocobase.com/plugins/@nocobase/plugin-calendar/) |
| Validação antes de criar/editar | Pre-action Event, Community Edition+ | Pode interceptar ações; validar também concorrência e integrações na implementação. [Pre-action](https://docs.nocobase.com/workflow/triggers/pre-action) |
| Aprovação formal dedicada | Professional Edition+ | Não é requisito inerente ao fluxo definido; gerente não é aprovador obrigatório. [Approval](https://docs.nocobase.com/plugins/@nocobase/plugin-workflow-approval/) |
| Histórico automático dos registros | Record History, Professional Edition+, documentação indica 2.x | Decidir entre plugin e histórico específico de movimentações; não prometer equivalência. [Record History](https://docs.nocobase.com/plugins/@nocobase/plugin-record-history) |
| Auditoria de ações de usuários/API | Audit Logger, Enterprise Edition+ | Diferente do histórico de negócio. [Audit Logger](https://docs.nocobase.com/plugins/@nocobase/plugin-audit-logger/) |
| Conector PostgreSQL externo | Standard Edition+ | Não assumir integração direta gratuita ao banco existente. [PostgreSQL externo](https://docs.nocobase.com/data-sources/external/postgresql) |
| Fonte de dados REST API | Plugin comercial | É diferente de desenvolver uma integração própria por API. A modalidade deve ser escolhida explicitamente. [REST API](https://docs.nocobase.com/data-sources/data-source-rest-api/) |

O antigo `plugin-audit-logs` está depreciado e não deve ser confundido com o atual Audit Logger comercial. [Aviso oficial](https://docs.nocobase.com/plugins/@nocobase/plugin-audit-logs/)

O agendador documentado não recupera automaticamente eventos cujo horário ocorreu enquanto a aplicação estava parada. A proposta de varredura de pendências é uma medida da solução a desenvolver, não uma capacidade de recuperação já garantida pelo framework. [Scheduled Task](https://docs.nocobase.com/workflow/triggers/schedule)

Proposta de arquitetura funcional: atividades e transições autorizadas controlam o processo; workflows curtos executam encaminhamentos e notificações. Usar o nó Manual apenas quando sua responsabilidade individual e seu ciclo de vida forem adequados. Antes de adotá-lo, demonstrar reatribuição, intervenção gerencial e cancelamento sem deixar tarefas internas órfãs. Permissão para editar um atendimento não prova permissão para concluir a tarefa interna de outro usuário.

A licença atual referencia Apache 2.0 e contém termos adicionais, inclusive sobre marca e distribuição. Não classificá-la como Apache 2.0 irrestrita. A escolha de edição deve considerar uso interno, personalização de marca e eventual distribuição futura; nenhuma licença paga ou infraestrutura está autorizada por este documento. [Licença oficial](https://github.com/nocobase/nocobase/blob/main/LICENSE.txt) · [Edições](https://www.nocobase.com/en/commercial)

## 10. Integração com ATEM Field — contrato funcional proposto

O plano-base registra uma integração existente com Google Agenda. Antes de qualquer conexão nova, definir para cada informação qual sistema é a origem válida e quem pode alterá-la. NocoBase, ATEM Field e Google Agenda não devem sobrescrever entre si reagendamentos ou cancelamentos sem uma regra explícita.

Contratos a definir, sem endpoints ou esquema físico neste estágio:

1. **Identidade:** correspondência estável de usuário, papel, equipe e técnico, incluindo desativação e acúmulo de funções.
2. **Atendimento:** identidade comum da demanda e vínculos com cliente, programação e atividades, para impedir duplicações.
3. **Agenda:** origem, versão e data efetiva da mudança; fuso; confirmação provisória/final; resposta quando houver conflito.
4. **Disponibilidade e reserva:** consulta e confirmação consistente de técnicos, carros e, após definição da regra, analisadores.
5. **Reagendamento/cancelamento:** resultado completo ou erro explicado; tratamento de mensagens repetidas e mudanças concorrentes.
6. **Frota:** elegibilidade de retirada a partir da regra aprovada, registros confirmados de saída/retorno e tratamento de retirada física ainda aberta; não presumir que todo uso da frota decorre de atendimento.
7. **Histórico e notificação:** ator, mudança relevante, motivo quando exigido, destinatários e prevenção de repetição.
8. **Relatório de campo:** somente associação por identificador/link e eventual estado de existência. Conteúdo, formato e contrato atual de geração do PDF permanecem intactos.

Proposto: primeiro protótipo com dados fictícios e nenhum acesso a produção. Estratégia de autenticação, edição/plugins, hospedagem, fonte principal da agenda e contratos de sincronização são dependências de planejamento; este documento não resolve essas escolhas por suposição.

## 11. Entrevista restante, em ordem de impacto

1. **Retirada e equipe:** qual duração da margem de retorno e qual antecedência de retirada? Como agir em atrasos? Carro posterior à validação já está permitido. Quem preenche/confere os itens de saída e retorno já confirmados? Qualquer integrante escalado pode retirar, e uso anterior por outro usuário com horários/margem compatíveis já está permitido.
2. **Reserva dos padrões/analisadores:** Seleção já reserva em provisório ou confirmado. Como retirar reserva própria e liberar compromissos? Como apresentar o aviso de calibração/certificado vencido e quem pode substituir recursos? A exceção de vencimento com aviso e os bloqueios por reserva, empréstimo e outras indisponibilidades já estão decididos.
3. **Confirmação e mudanças:** qual evidência comercial confirma o cliente? Quais mudanças exigem nova confirmação? O cliente pode recusar sem cancelar definitivamente?
4. **Recursos após exceção:** quando liberar cada recurso em cancelamento, substituição ou encerramento? Como resolver retirada aberta?
5. **Dois dias:** corridos ou úteis; quais estados/campos; comentários contam; destinatários, canal e repetição?
6. **Distribuição:** fila compartilhada ou supervisor por região/equipe/carteira? Substitutos por ausência e visibilidade entre equipes?
7. **Atividades em equipe:** atividades individuais ou compartilhadas; responsável principal; conclusão por todos ou por um representante?
8. **Execução e encerramento:** início, evidências, assinatura, relatório e eventual revisão; quem encerra e pode reabrir?
9. **Campos e etapas:** quem vê valores comerciais; quem publica configurações; efeito das mudanças em atendimentos em andamento?
10. **Integração e acesso:** painel NocoBase separado ou navegação unificada; fonte principal da agenda; identidade; edição e custo aceitável?

## 12. Fases e dependências

| Fase | Entrega | Depende de | Condição de avanço |
|---|---|---|---|
| 0 — Entrevista e plano | Regras confirmadas, decisões propostas e pendências visíveis | Respostas de negócio | Apresentação revisável; nenhuma construção nesta fase |
| 1 — Decisão de solução | Versão/edição, plugins, hospedagem, identidade, contratos e escopo do primeiro piloto | Fase 0 e regras críticas de reserva/retirada | Ordem explícita de implementação, além das decisões necessárias para o trecho a construir |
| 2 — Protótipo funcional isolado | Um atendimento completo, múltiplos técnicos, reservas e intervenção gerencial com dados fictícios | Fase 1 | Demonstração e critérios de aceitação relevantes aprovados |
| 3 — Integração controlada | Contratos de agenda, usuários, recursos e vínculo de relatório | Protótipo validado e origem de cada dado definida | Testes de concorrência, repetição, autorização e compatibilidade |
| 4 — Piloto | Uma equipe e conjunto limitado de serviços | Integração validada e autorização de ativação | Operação acompanhada, correções e decisão de expansão |

O planejamento pode avançar com alternativas documentadas. A implementação de uma regra pendente não pode ser substituída silenciosamente por um padrão do framework. Instalação, testes executáveis, conexão com serviços privados e publicação não fazem parte desta entrega documental.

## 13. Critérios de aceitação para a futura implementação

Os itens confirmados expressam o comportamento necessário. Itens marcados como propostos dependem da aprovação da respectiva política antes de se tornarem testes definitivos.

1. Comercial registra data provisória; supervisor valida os recursos da programação; comercial registra confirmação final em uma ação separada. O comportamento de validação sem carro deve seguir a decisão ainda pendente.
2. A validação reserva recursos enquanto o cliente ainda está pendente. Confirmar o cliente não duplica reservas.
3. Passar dois dias ou receber alerta não cancela atendimento nem libera recursos automaticamente.
4. Técnico atribuído vê provisória claramente identificada e não precisa aceitá-la para o fluxo continuar.
5. Múltiplos técnicos aparecem no mesmo atendimento; responsabilidade administrativa não se confunde com participantes da execução.
6. Solicitação de mudança do técnico chega ao supervisor sem alterar silenciosamente a programação.
7. Gerente interage com qualquer fluxo e executa os poderes confirmados sem criar uma aprovação gerencial obrigatória.
8. Gerente não contorna o período reservado apenas por seu cargo; aplicam-se as mesmas regras de integrante escalado e uso anterior com horários/margem compatíveis.
9. Usuários de qualquer nível podem retirar veículo quando satisfazem as regras de disponibilidade e elegibilidade aprovadas.
10. Qualquer integrante escalado na agenda consegue retirar para essa programação; não há condutor único obrigatório. Outro usuário pode retirar antes de reserva futura quando horários e margem de retorno forem compatíveis, respeitando a duração da margem e antecedência ainda a definir.
11. Conflitos simultâneos de reserva não produzem duas programações incompatíveis validadas. A definição de incompatibilidade deve estar aprovada.
12. Reagendamento, troca de recursos e cancelamento deixam resultado consistente e histórico compreensível; retirada física aberta não é encerrada ficticiamente.
13. Proposto: alerta de 48 horas usa alterações relevantes, respeita destinatários e não se repete no mesmo ciclo; indisponibilidade temporária não elimina pendências de alerta.
14. Configuração de campos/etapas pelo gerente funciona dentro do escopo aprovado e não concede administração técnica irrestrita por consequência.
15. Atualização de configuração não apaga o histórico nem invalida silenciosamente atividades em andamento.
16. Chamadas repetidas e sincronizações concorrentes não duplicam atendimento, reserva ou notificação; conflitos de origem recebem tratamento definido.
17. O PDF de campo mantém o mesmo conteúdo, formato e contrato de geração; a solução apenas registra o vínculo autorizado.
18. Se o nó Manual for utilizado, o protótipo comprova atribuição, substituição, cancelamento e intervenção gerencial sem tarefas internas pendentes indevidas.
19. Padrões/analisadores reservados, emprestados e com outros bloqueios não ficam disponíveis para nova seleção. O caso da reserva da própria agenda segue a decisão específica ainda pendente.
20. Recurso com calibração/certificado vencido pode ser selecionado com aviso, sem ignorar bloqueios simultâneos de reserva, empréstimo ou outra indisponibilidade.
21. O fluxo independente da frota registra KM, foto e danos na saída e danos, abastecimento e pneus no retorno, conforme formatos e responsáveis a detalhar.

## 14. Decisões que este plano não tomou

Não foi selecionada uma edição paga, comprada licença, escolhida hospedagem ou instalada instância. Não foram definidos duração da margem de retorno, antecedência/janela de retirada, procedimento de retirada própria, liberação dos recursos por cancelamento/encerramento, política completa de alertas ou critérios de conclusão. Estão confirmados: retirada por qualquer integrante escalado, uso anterior à reserva futura por outro usuário com horários e margem compatíveis, reservas sem expiração automática por inatividade, bloqueios de recursos indisponíveis, calibração/certificado vencido permitido com aviso, registros de saída/retorno da frota e PDF intocado. Migração de dados não foi planejada neste estágio. O próximo resultado esperado é a consolidação da entrevista e a revisão do plano, antes de qualquer ordem explícita de construção.

## 15. Registro de revisão

- **17/09/2026:** primeira versão funcional; pesquisa de recursos, plugins e licença do NocoBase registrada nessa data.
- **18/09/2026:** incorporados os bloqueios de padrões/analisadores e a exceção permitida de “vencido” com aviso; delimitadas as pendências de reserva própria e seleção gerar reserva; registrados os dados já confirmados de saída/retorno da frota; explicitada a ambiguidade sobre carro obrigatório na validação.
- **18/09/2026 — respostas complementares:** definido que qualquer integrante escalado pode retirar, sem condutor único obrigatório; permitido uso anterior por outro usuário com verificação de horários e margem de retorno; confirmado que “vencido” significa calibração/certificado vencido, preservando os demais bloqueios. Duração da margem e antecedência continuam pendentes. Somente documentação revisada; sem nova instalação, implementação ou mudança no PDF.

## Atualização de execução — 21/09/2026

Carro pode ser definido depois; seleção de analisador já reserva em agenda provisória ou confirmada. Critérios de aceite: validar/confirmar sem carro funciona; atribuição posterior não cria conflito; seleção efetivada cria reserva sem aprovação extra; confirmação comercial e reenvio da mesma seleção não duplicam reservas. Roteiro no [plano consolidado](./plano-consolidado-atem-field.md), aguardando ordem explícita de construção.
