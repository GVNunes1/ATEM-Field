# ATEM Field — plano funcional de padrões e analisadores

Revisão: 21/09/2026.

Status: planejamento para discussão, sem implementação. Este documento detalha a preparação técnica do workflow no NocoBase e sua integração com as operações existentes do ATEM Field. Não altera código, permissões em produção, banco de dados ou o PDF de relatório de campo.

## 1. Regras confirmadas e limites de aplicação

Confirmado nas respostas da entrevista:

- O técnico enxerga a programação provisória e seleciona os padrões/analisadores necessários às atividades.
- Técnico e carro, após a validação do supervisor, ficam reservados sem expiração automática por inatividade. Um eventual aviso após dois dias não cancela a programação nem libera esses recursos.
- O técnico não pode pegar um equipamento que esteja reservado, emprestado ou com outro impedimento operacional.
- O usuário confirmou que "vencido" significa **calibração/certificado vencido**. O equipamento pode ser selecionado/retirado com aviso, desde que não haja reserva incompatível, empréstimo ou outro impedimento operacional. A distinção entre seleção, reserva e retirada continua obrigatória.
- Solicitações de mudança do técnico são encaminhadas ao supervisor.
- O gerente acompanha e interage transversalmente, fora das etapas obrigatórias de agendamento. Seus poderes operacionais e de configuração não devem produzir liberação silenciosa de recursos comprometidos.
- O PDF da ferramenta de relatório de campo permanece integralmente protegido.

A exceção de calibração/certificado vencido é uma regra confirmada, não uma hipótese de trabalho. Ela não significa reserva expirada, empréstimo atrasado, liberação de manutenção ou qualquer baixa automática de compromisso. Ausência do certificado ou da data de validade continua como situação pendente de definição; não deve ser automaticamente equiparada a um vencimento conhecido.

Se um equipamento estiver simultaneamente com calibração vencida e emprestado, reservado de forma incompatível, em manutenção ou sob outro bloqueio, o impedimento operacional prevalece. O aviso de calibração não autoriza ultrapassar esses bloqueios. A regra solicitada também não representa declaração de conformidade metrológica do atendimento ou alteração dos critérios de emissão do relatório.

Confirmado em 21/09/2026: selecionar um padrão/analisador já efetiva sua reserva, em qualquer momento do agendamento provisório ou confirmado, respeitando disponibilidade e permissão. Não existe uma segunda ação obrigatória para aprovar/reservar nem dependência da confirmação do cliente. Os eventos explícitos de liberação ainda serão definidos. Este plano não introduz expiração automática para analisadores: política diferente exige nova decisão expressa.

## 2. Conceitos que não podem ser confundidos

| Conceito | Significado funcional | O que não implica |
| --- | --- | --- |
| Seleção | Escolha efetivada de equipamento para uma atividade; já cria sua reserva após validação de disponibilidade. | Marcação local ainda não salva não é sucesso; seleção não comprova posse física. |
| Reserva | Compromisso de disponibilidade criado ao efetivar a seleção, em agenda provisória ou confirmada. | Não comprova retirada física nem confirmação do cliente. |
| Retirada | Registro de entrega/posse física do equipamento. | Não é simples alteração de data ou seleção na tela. |
| Devolução | Registro de retorno físico, com responsável e situação informados. | Não remove automaticamente manutenção, bloqueios ou outras reservas. |
| Validade da calibração | Condição e data de validade da calibração/certificado. | Não substitui a situação de posse, manutenção ou reserva. |
| Solicitação de mudança | Pedido do técnico para o supervisor analisar uma alteração. | Não executa a alteração nem libera o recurso por conta própria. |

Seleção e reserva acontecem na mesma ação efetivada, conforme confirmado. A tela deve informar "selecionado e reservado" somente após confirmação do serviço. Retirada e devolução permanecem marcos físicos distintos.

## 3. Disponibilidade e conflitos

### 3.1 Verificações independentes

A decisão de alocar ou retirar deve considerar conjuntamente:

1. O equipamento exato, identificado de forma estável, e não apenas o nome/modelo.
2. A atividade, o responsável e o período pretendido.
3. Reservas ou compromissos que impeçam a operação.
4. Posse física atual, empréstimo e devolução efetivamente registrada.
5. Manutenção e outros bloqueios operacionais existentes.
6. Validade da calibração/certificado, tratada como aviso na exceção autorizada.
7. Permissão do usuário para a ação e para aquela atividade.

Não utilizar uma única indicação "vencido" para esconder as demais condições. A falta de informações suficientes deve ser apresentada como pendência de verificação, e não como disponibilidade confirmada.

### 3.2 Resultado esperado por situação

| Situação | Comportamento a planejar |
| --- | --- |
| Livre, sem conflito e com calibração válida | Permitir a ação autorizada, respeitando a etapa de seleção/reserva/retirada definida. |
| Livre, sem conflito e com calibração vencida | Permitir com aviso explícito de calibração/certificado vencido; não criar aprovação obrigatória apenas por esse motivo. |
| Reserva incompatível de terceiro | Bloquear nova alocação/retirada; informar conflito e permitir solicitar solução ao supervisor. |
| Reserva do próprio técnico para a mesma atividade | Reconhecer o vínculo existente e evitar duplicação. A regra exata de retirada dessa reserva ainda precisa ser confirmada. |
| Reserva do próprio técnico para outra atividade | Não considerar livre por pertencer à mesma pessoa; verificar compromisso e período, sem transferência implícita. |
| Emprestado ou em posse de outro responsável | Bloquear a retirada para a atividade; previsão de devolução não substitui devolução registrada. |
| Em manutenção ou sob outro bloqueio operacional | Bloquear, mesmo que também exista calibração vencida. |
| Prazo de empréstimo ou devolução ultrapassado | Sinalizar atraso; não liberar automaticamente o equipamento. |
| Reserva com data passada | Não interpretar automaticamente como livre. Definir eventos explícitos de liberação e verificar o estado físico; passagem do tempo ou inatividade, sozinhas, não autorizam liberação neste plano. |
| Informação desatualizada, indisponível ou contraditória | Reconsultar ou encaminhar pendência; não apresentar sucesso sem confirmação da operação. |

Reserva própria não equivale a recurso livre, e a proibição de "pegar o reservado" precisa distinguir a retirada legítima de uma reserva da tentativa de capturar a reserva de outra atividade. Essa distinção deverá ser resolvida na entrevista antes da implementação.

### 3.3 Períodos a definir

- Definir se a reserva ocupa o dia inteiro ou um intervalo com início e fim.
- Definir se transporte, preparação, deslocamento e retorno ampliam o período comprometido.
- Tratar atividades que atravessam dias e usar a mesma referência de fuso/horário em todas as telas e integrações.
- Definir se reservas futuras sem sobreposição permitem outro uso anterior e quais margens de devolução são exigidas.
- A seleção efetivada já reserva em agendamento provisório ou confirmado. Definir quais eventos explícitos encerram ou liberam esse compromisso, como cancelamento autorizado ou substituição, sem confundi-los com devolução física.
- Definir como sinalizar calibração válida hoje, mas vencida na data planejada do uso. Proposta: avaliar também o período do atendimento e avisar antecipadamente.

Nenhuma dessas escolhas está aprovada apenas pela expressão "não pegar o reservado". Até a decisão, o plano não presume compartilhamento por horário nem liberação automática por passagem do tempo. Técnico/carro continuam sem expiração por inatividade, conforme confirmado. Uma política diferente especificamente para analisadores precisaria de nova decisão, não de um prazo padrão adotado na implementação.

## 4. Preparação técnica e mudanças

Sequência funcional proposta, com os pontos pendentes explicitados:

1. O técnico abre sua atividade provisória ou confirmada, com a situação do cliente identificada claramente.
2. Consulta os padrões/analisadores e sua situação para o período previsto.
3. Seleciona os equipamentos permitidos. A seleção efetivada já cria reserva vinculada à atividade, em qualquer momento do agendamento provisório ou confirmado. Se a confirmação falhar por conflito, não informar que está reservado.
4. Se houver apenas calibração vencida, visualiza o aviso e pode prosseguir dentro de suas permissões.
5. Se houver impedimento operacional, não consegue alocar/retirar o recurso. Pode escolher alternativa compatível ou solicitar mudança ao supervisor; a necessidade de aprovação de uma substituição específica ainda deve ser definida.
6. Quando o comercial confirmar o cliente, preserva as reservas já existentes, sem duplicar nem liberar compromissos. Revalidar impedimentos novos e eventuais mudanças de período; não tratar reserva efetivada como simples intenção de uso.
7. Na retirada, registra a passagem para posse física e verifica novamente os impedimentos aplicáveis.
8. Na devolução, registra o retorno e preserva bloqueios ou compromissos que continuem válidos.

Uma mudança de data, técnico ou equipamento exige nova avaliação dos compromissos afetados. O pedido do técnico não deve alterar a reserva enquanto o supervisor não tratar a solicitação segundo suas permissões. O retorno ao comercial e a reconfirmação com o cliente permanecem parte do fluxo de reagendamento a detalhar.

Cancelar uma atividade não equivale a receber de volta os equipamentos já retirados. Proposta: separar liberação dos compromissos futuros da pendência de devolução física, mantendo ambas rastreáveis.

## 5. Interações conceituais do painel

Esta seção define informações e ações, não um layout ou redesign.

- **Na atividade:** apresentar data/horário, condição provisória ou confirmada, técnico responsável e equipamentos selecionados, reservados ou em posse, sem misturar esses marcos.
- **Na consulta de equipamentos:** permitir localizar pelo patrimônio/identificador e reconhecer o motivo de uma indisponibilidade. Equipamentos bloqueados podem continuar visíveis para consulta, sem ação que efetive alocação indevida.
- **Nos avisos:** escrever "calibração/certificado vencido" com a data conhecida, evitando o rótulo isolado "vencido". Exibir os impedimentos simultâneos, se existirem.
- **Nas ações:** selecionar já reserva; retirar, devolver e solicitar mudança são ações distintas. Não exigir um segundo botão de reserva. As ações disponíveis refletem situação e permissões, sem depender apenas de ocultação visual para proteção.
- **Na solicitação ao supervisor:** incluir atividade, recurso, período, motivo e alternativa sugerida, quando houver.
- **No acompanhamento gerencial:** permitir identificar conflitos, pedidos de alteração e recursos ainda não devolvidos, respeitando os poderes definidos para a gerência.

Proposta opcional para rastreabilidade: registrar que o aviso de calibração vencida foi exibido e, se o usuário concordar com essa política, pedir uma ciência explícita. Isso não está confirmado, não substitui o aviso informativo solicitado e não deve ser convertido em aprovação obrigatória do supervisor ou gerente sem nova decisão.

## 6. Acessos e responsabilidades

- **Técnico:** consulta a programação provisória ou confirmada que lhe cabe; seleciona recursos permitidos e já os reserva, sem etapa adicional. Solicita mudanças ao supervisor. Detalhar retirada/devolução, inclusive operação por totem ou responsável pela entrega.
- **Supervisor:** trata as solicitações de alteração e seus impactos sobre a programação. Pode resolver conflitos por mudanças autorizadas de recurso/período/responsável; não deve simplesmente ignorar um compromisso ativo.
- **Comercial:** acompanha se a preparação possui pendências que afetem a confirmação com o cliente. Não recebe implicitamente poder de liberar empréstimos, reservas ou manutenção.
- **Gerente:** acompanha e interage em todos os fluxos, com poderes operacionais/configuracionais conforme a definição geral. Uma intervenção que altere compromissos deve ser explícita, identificar os registros atingidos, respeitar posse física e deixar histórico; não há bypass silencioso por perfil.
- **Administração/EQAT ou responsável pelo patrimônio:** os papéis existentes de calibração, empréstimo e entrega precisam ser compatibilizados com os novos perfis. Não confundir esses processos com a exceção de selecionar um equipamento cuja calibração venceu.

Todo canal de operação deve aplicar as mesmas restrições. Uma ação negada ao técnico no painel não pode ser aceita por envio direto, portal alternativo ou integração. A validação das permissões ocorre no serviço responsável pela operação, não somente na interface.

## 7. Integração com o ATEM Field existente

Leitura limitada das rotas atuais, sem auditoria integral ou alteração de comportamento: `backend/src/routes/api.ts` já expõe operações relacionadas a analisadores e reservas. A implementação futura deve reaproveitar ou adaptar conscientemente esses contratos, em vez de criar controle paralelo sem conciliação.

| Superfície atual observada | Ponto de integração a planejar |
| --- | --- |
| Consulta de analisadores (`GET /analyzers`) | Apresentar identificação, calibração e compromissos, sem presumir que um resumo de reserva atual resolve disponibilidade futura por período. |
| Consulta/criação de reservas (`GET/POST /reservations`) | Efetivar reserva junto à seleção em agenda provisória ou confirmada e evitar duplicação entre NocoBase e ATEM Field. |
| Retirada/devolução (`POST /reservations/:id/checkout` e `/checkin`) | Preservar a distinção entre programação e posse física, reaplicando as regras comuns. |
| Alteração/exclusão de reservas | Verificar impacto em atividade, posse, outros compromissos e histórico antes de liberar um recurso. |
| Aprovação de reservas (`POST /reservations/:id/approve`) | Compatibilizar o processo existente de calibração/empréstimo; não criar aprovação gerencial de agendamento por consequência desse endpoint. |
| Portal do técnico (`/technician-portal/reservations`, `/checkin` e `/reschedule`) | Garantir regras equivalentes e alinhar qualquer reagendamento ao pedido via supervisor, sem concluir que o contrato atual já cumpre o novo fluxo. |

Os caminhos acima são relativos ao roteador atual. Sua existência não comprova segurança, atomicidade ou conformidade com todas as novas regras; essas propriedades ainda deverão ser verificadas na implementação.

Requisitos de integração propostos:

- Definir uma autoridade para cada operação de reserva/retirada/devolução. NocoBase e ATEM Field não devem efetivar o mesmo compromisso de forma independente.
- Manter vínculos estáveis entre atividade, atendimento, técnico, equipamento e reserva, sem escolher uma estrutura de banco neste documento.
- Revalidar recursos quando a agenda mudar, inclusive mudanças originadas na integração existente com o Google Agenda.
- Reconciliar falhas de comunicação sem anunciar sucesso falso, duplicar reservas ou liberar equipamento indevidamente.
- Propagar a situação atual aos canais em uso; uma tela aberta há algum tempo não é prova de disponibilidade.
- Preservar histórico operacional de alterações com autor, momento, motivo e vínculos afetados. Esse histórico de domínio não é promessa de um plugin de auditoria do NocoBase.
- Não alterar gerador, modelos, ativos, payloads, rotas, download ou impressão do PDF de relatório de campo. O workflow pode manter referências ao módulo existente sem mudar seu contrato.

## 8. Concorrência e confiabilidade — requisitos

Sem definir SQL, schema ou implementação neste momento:

- Duas solicitações simultâneas não podem confirmar compromissos incompatíveis para o mesmo recurso/período.
- O resultado final de uma operação deve ser validado contra a situação mais recente, mesmo que a consulta inicial exibisse disponibilidade.
- Cliques repetidos, reenvio por falha de rede e repetição de uma integração não podem gerar reservas, retiradas ou devoluções duplicadas.
- A transição precisa preservar coerência entre compromisso, posse e atividade. Uma falha parcial deve ser detectável e reconciliável, sem apresentar recurso falsamente livre.
- Mudanças concorrentes de data/responsável/recurso não devem sobrescrever silenciosamente a decisão anterior. O usuário precisa ser informado quando a operação tiver de ser refeita após atualização.
- Em conflito, manter o estado confirmado anteriormente e retornar uma explicação utilizável, sem transferir ou cancelar a reserva alheia automaticamente.
- Uma intervenção gerencial explícita deve obedecer aos mesmos requisitos de coerência e registro; o perfil não elimina o conflito físico.

## 9. Testes de aceitação a preparar

São cenários planejados, não testes executados. Usar dados fictícios e ambiente isolado na futura implementação.

| Cenário | Resultado esperado |
| --- | --- |
| Atividade ainda provisória atribuída ao técnico | Técnico enxerga a atividade e identifica que o cliente ainda não confirmou. |
| Seleção na agenda provisória ou confirmada | Reserva criada imediatamente ao efetivar a seleção, sem aprovação separada e sem esperar confirmação do cliente. |
| Mesma seleção reenviada ou cliente confirmado depois | Preserva a reserva vinculada sem duplicação. |
| Equipamento livre, calibração válida | Ação permitida para usuário autorizado e atividade compatível. |
| Equipamento livre, calibração vencida | Aviso exibido; usuário autorizado consegue prosseguir, sem aprovação adicional inventada. |
| Calibração vencida junto com reserva incompatível | Operação bloqueada por reserva, mesmo após o aviso. |
| Calibração vencida junto com empréstimo ou manutenção | Operação bloqueada pelo impedimento operacional. |
| Empréstimo atrasado ou reserva com data passada | Não ocorre liberação automática apenas porque a data venceu. |
| Reserva sem alterações por dois dias | Eventual aviso não cancela nem libera recurso; técnico/carro mantêm a regra confirmada de não expiração e não se presume exceção para analisadores. |
| Reserva própria para a mesma atividade | Não há duplicação; a retirada segue a política expressamente definida para essa reserva. |
| Reserva própria para outra atividade | Não há captura ou transferência implícita do recurso. |
| Dois usuários disputam simultaneamente o recurso | No máximo uma operação incompatível é confirmada; a outra recebe o conflito sem modificar a primeira. |
| Operação reenviada após perda de conexão | Não há duplicação e o resultado confirmado pode ser reconhecido. |
| Data alterada depois de selecionar/reservar | Compromissos são reavaliados, com pendência clara em caso de incompatibilidade. |
| Atividade cancelada com equipamento retirado | Permanece a obrigação de devolução; o recurso não aparece falsamente livre. |
| Devolução de recurso que ainda está em manutenção | Retorno físico registrado sem liberar o bloqueio de manutenção. |
| Tentativa por outro canal ou chamada direta | Mesmas regras de acesso, conflito e aviso são aplicadas. |
| Intervenção do gerente em recurso comprometido | Não há bypass silencioso; alterações autorizadas e consequências ficam explícitas e registradas. |
| Dados de disponibilidade indisponíveis | A tela não anuncia reserva/retirada confirmada sem confirmação do serviço responsável. |
| Regressão do relatório de campo | Geração, conteúdo, formato e contrato do PDF permanecem os atuais, sem alteração por esta funcionalidade. |

## 10. Decisões pendentes para a entrevista

1. Como tratar ausência do certificado, ausência da data de validade ou informação insuficiente? O significado de "vencido" já está confirmado como calibração/certificado vencido; a pendência é exclusivamente o tratamento das informações ausentes.
2. Quais eventos explícitos liberam a reserva, como cancelamento autorizado ou substituição? O início já foi definido: seleção efetivada na agenda provisória ou confirmada. Não rediscutir prazo de inatividade de técnico/carro: eles não expiram automaticamente. Eventual política diferente para analisadores dependerá de nova decisão expressa.
3. Qual é o período de ocupação do equipamento: dia, intervalo do atendimento ou intervalo incluindo transporte/preparação/devolução?
4. Como funciona a retirada de uma reserva própria e de uma reserva da mesma equipe? É permitida entrega por outra pessoa? Quem registra?
5. Equipamento reservado para um horário futuro pode ser utilizado antes, sem sobreposição e com margem de retorno? Qual margem?
6. O técnico pode substituir livremente um padrão/analisador disponível ou toda troca depois da primeira seleção requer solicitação ao supervisor?
7. O aviso de calibração vencida é somente informativo ou também deve registrar ciência explícita? Em quais ações e datas deve ser reapresentado?
8. Quem registra a devolução e eventuais avarias/pendências? Existe conferência por responsável pelo patrimônio?
9. Quais poderes de gerente/supervisor abrangem transferir ou cancelar compromissos e como comunicar os usuários afetados, sem ignorar posse física?
10. Quais regras e aprovações já existentes para calibração/empréstimo permanecem, e como EQAT/administração participam do novo painel?

Após essas respostas, consolidar as regras aprovadas no planejamento geral e no fluxograma. Não instalar o NocoBase nem iniciar implementação a partir deste documento isoladamente.
