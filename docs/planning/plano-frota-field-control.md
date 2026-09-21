# ATEM Field — plano do menu Frota

Elaborado em 17/09/2026; revisão consolidada em 21/09/2026. Status: proposta para revisão, sem autorização para implementar.

Este documento planeja o menu de frota do ATEM Field, articulado com o workflow de agendamento no NocoBase. A referência funcional é o Field Control; não se trata de copiar sua interface, contratar o produto ou integrar sua API. Nenhum código, banco, dependência, serviço ou implantação deve ser alterado até ordem do usuário.

Documentos relacionados: [workflow de agendamento](./nocobase-workflow-agendamento.md) e [fluxograma para a gerência](./fluxograma-agendamento-gerencia.md).

## 1. O que foi confirmado pelo usuário

- A validação do supervisor já reserva a equipe e o carro se escolhido, enquanto o comercial confirma com o cliente. Carro pode ser definido depois; ausência de veículo não impede avançar o agendamento.
- A reserva não expira por falta de movimentação. Pode haver aviso após dois dias sem mudanças no fluxo; destinatários e contagem ainda serão definidos.
- Um atendimento pode ter vários técnicos no mesmo carro.
- A frota não fica limitada a retiradas determinadas pelo supervisor na agenda: usuários de qualquer nível podem registrar saídas.
- Quando há carro reservado para uma agenda, qualquer integrante escalado nela pode retirá-lo. Identificar quem efetivamente retirou, sem exigir condutor único previamente escolhido.
- Carro reservado para amanhã pode ser retirado hoje por outro usuário, com verificação de horários e margem de retorno. A duração da margem ainda será definida.
- A retirada exige KM atual e foto.
- Há questionário de danos na retirada e no retorno, além de perguntas sobre abastecimento e calibragem dos pneus na devolução.
- O técnico pode visualizar a programação provisória.
- O gerente pode acompanhar, conversar, editar, reagendar, trocar técnico/carro, mudar prioridade, cancelar e configurar campos/etapas; não é uma aprovação obrigatória do fluxo.
- O PDF do relatório de campo permanece totalmente intacto: conteúdo, aparência, gerador, templates, arquivos, rotas, contratos de entrada/saída e comportamento de download.

O fato de o gerente poder reatribuir uma agenda não o autoriza a retirar silenciosamente um carro reservado para outra pessoa. Deve valer a mesma regra de vínculo: qualquer reatribuição necessária é explícita, validada e registrada antes da retirada.

## 2. Pesquisa: o que o Field Control documenta

Pesquisa realizada em fontes públicas oficiais em 17/09/2026, sem entrar em conta privada ou testar ações de produção.

| Recurso documentado | Referência oficial | Aproveitamento proposto no ATEM |
| --- | --- | --- |
| Seleção do veículo por lista ou QR Code; retirada com quilometragem, comentário e foto do hodômetro; devolução com quilometragem final, comentário e foto | [Retirada e devolução pelo aplicativo, atualizado em 29/05/2026](https://ajuda.fieldcontrol.com.br/pt-br/articles/190-como-fazer-a-retirada-e-devolucao-de-um-veiculo-pelo-aplicativo) | Fluxo curto de saída/retorno, identificação clara e evidências ligadas à movimentação |
| Histórico com usuário, horários, KM inicial/final e tempo de uso; filtros e indicadores de disponibilidade e utilização | [Histórico de uso pelo painel, atualizado em 12/01/2026](https://ajuda.fieldcontrol.com.br/pt-br/articles/160-como-acompanhar-o-historico-de-uso-dos-veiculos-pelo-painel) | Consulta operacional por veículo, usuário e período; trilha de cada viagem |
| Cadastro do carro com características e foto; QR Code; observações sobre anormalidades | [Controle de KM, artigo de 29/07/2022](https://fieldcontrol.com.br/blog/controle-de-km.html) | Cadastro identificável e registro de ocorrências; o artigo antigo é referência complementar, não garantia da configuração atual |

As fontes consultadas não comprovam um questionário nativo específico de danos, abastecimento e calibragem na devolução, nem a restrição de retirada por participante da agenda. Esses pontos são requisitos próprios do ATEM, solicitados pelo usuário. QR Code e foto do hodômetro na devolução são sugestões inspiradas no produto; ainda precisam entrar no escopo aprovado do ATEM.

Não se inclui rastreamento GPS contínuo, telemetria, roteirização automática, cálculo de multas ou avaliação automática do condutor nesta proposta.

## 3. Conceitos que não podem ser misturados

| Conceito | Significado operacional | Exemplo |
| --- | --- | --- |
| Reserva de agenda | Compromisso de disponibilidade em um período planejado, criado antes da confirmação do cliente | Carro reservado para uma equipe amanhã, das 08h às 12h |
| Posse física | Saída real e responsabilidade pelo carro, da retirada até seu retorno registrado | Usuário saiu hoje às 14h e ainda não devolveu |
| Condição do veículo | Aptidão para nova saída, considerando revisão, danos ou manutenção | Está no pátio, mas indisponível por avaria |
| Pendência administrativa | Falta de evidência, divergência ou conferência após um fato físico | Carro retornou, mas a foto final ainda não foi enviada |

Proposta: mostrar esses eixos separadamente. Um carro pode estar fisicamente disponível agora e reservado para amanhã, com uso anterior por terceiro permitido se respeitar horários e margem de retorno. Uma devolução física pode coexistir com pendência de conferência. “Reserva sem expiração automática” não significa que todo o calendário futuro esteja ocupado: ainda faltam a duração da margem e regras de antecipação.

O responsável por uma saída é um usuário identificável do sistema, não obrigatoriamente um registro de técnico. Comercial, supervisor, gerente e técnico devem ser contemplados; a habilitação operacional para dirigir e seu eventual controle documental são políticas a confirmar.

## 4. Menu e navegação propostos

Adicionar uma entrada principal **Frota**, mantendo o restante da navegação do ATEM. Dentro dela, organizar quatro destinos; não criar uma nova árvore extensa de menus.

| Destino | Conteúdo prioritário | Ações principais |
| --- | --- | --- |
| Veículos | Lista com placa/nome, condição, posse atual, próxima reserva e conflito quando houver | Abrir veículo; retirar quando elegível; devolver o veículo em uso |
| Minhas saídas | Saída em andamento em primeiro lugar, depois devoluções pendentes e histórico próprio | Continuar preenchimento; registrar retorno; concluir pendências |
| Programação | Reservas por veículo e período, diferenciando provisória e confirmada | Abrir agenda vinculada; solicitar alteração; editar se autorizado |
| Histórico e pendências | Movimentações, divergências de KM, danos reportados e evidências incompletas | Filtrar; conferir ocorrência; resolver pendência com motivo |

Cadastro, questionários e regras ficam em **Configurações da frota**, acesso secundário autorizado. A abrangência da visão de outros usuários para comercial e técnico ainda precisa ser aprovada; retirar um veículo não implica acesso irrestrito às fotos e aos deslocamentos de todos.

### Detalhe de um veículo

- Cabeçalho compacto: nome, placa, foto opcional e condição operacional.
- Linha operacional: quem está com o carro, desde quando, retorno previsto e KM conhecido com data/origem do registro.
- Próxima reserva: período, situação provisória/confirmada e responsável autorizado, de acordo com o escopo de visibilidade.
- Ação contextual: “Retirar veículo”, “Devolver veículo” ou motivo claro de indisponibilidade.
- Seções: programação, movimentações, ocorrências e cadastro. Histórico longo paginado.
- Não apresentar “disponível” sem avaliar posse, condição, reservas e período informado para uso.

### Direção visual e acessibilidade

Seguir o sistema aprovado em `design-system/atem-field/TASTE.md`: Geist, azul ATEM, superfícies neutras, Lucide, dados organizados e ausência de banners decorativos. A skill UI/UX Pro Max orienta rótulos claros, foco, feedback, tratamento de erros, alvos de toque e preservação do estado da navegação. A pesquisa genérica da skill trouxe recomendações de marketing/paleta incompatíveis com o produto; elas não foram adotadas. As orientações locais de redesign foram consultadas para preservar o padrão existente, sem reformular o frontend nesta fase.

- Desktop: lista operacional com filtros de estado, placa/nome e período; dados comparáveis em colunas, sem excesso de cartões.
- Celular: foco na saída em andamento, seleção do carro e captura de evidências; campos em coluna única e ações de pelo menos 44px.
- Formulários de retirada/devolução em página dedicada com etapas curtas. Evitar longos formulários em janelas empilhadas.
- Diálogos apenas para confirmações curtas ou visualização de foto; na futura implementação, usar o `ModalOverlay` já existente, com portal, foco e retorno ao acionador.
- Rótulos persistentes, erros junto ao campo, resumo acessível de erros e indicação de upload por foto. Nunca depender apenas de cor.
- Navegação com animação sutil já adotada no ATEM; respeitar movimento reduzido, sem retardar ações ou animar dimensões de conteúdo.
- Voltar preserva filtros, posição e rascunho quando seguro. Confirmar antes de abandonar alterações não salvas.
- Validação futura em 375, 768, 1024 e 1440px, teclado, zoom, leitor de tela e movimento reduzido.

## 5. Retirada: fluxo e formulário propostos

1. Usuário abre Frota, seleciona o carro ou, se aprovado no escopo, lê seu QR Code.
2. Sistema informa condição, eventual posse ativa, próxima reserva e elegibilidade para o período pretendido.
3. Usuário confirma a finalidade, agenda vinculada quando houver e previsão de retorno. Campos adicionais e obrigatoriedade precisam ser aprovados.
4. Preenche KM atual, anexa foto legível do hodômetro e responde ao questionário de danos.
5. Revê resumo: carro, responsável, horário, vínculo da agenda, retorno previsto e ocorrências.
6. Ao confirmar, o servidor revalida disponibilidade e autorização e registra uma única retirada. A tela só exibe “retirada confirmada” após sucesso efetivo.

| Informação | Origem/regra proposta |
| --- | --- |
| Carro e usuário responsável | Seleção do carro; identidade da sessão, sem impersonar outro usuário |
| Agenda/atividade relacionada | Automática quando a ação parte da agenda; opcional para saída avulsa, conforme política |
| Horário real de saída | Registro do evento; correções posteriores identificadas, justificadas e autorizadas |
| Retorno previsto | Proposto para checar compatibilidade com próximas reservas, não para presumir devolução automática |
| KM atual | Obrigatório por decisão do usuário; numérico e não negativo |
| Foto atual do hodômetro | Obrigatória por decisão do usuário; mostrar prévia e permitir refazer antes de confirmar |
| Danos existentes | Resposta explícita; nunca pré-marcar “sem danos” |
| Detalhamento de dano | Proposta: localização, descrição, foto e classificação para conferência |
| Observações | Campo complementar, não substitui pergunta obrigatória |

Questionário candidato: “Há avaria visível?”, “Há problema percebido em pneus, luzes ou funcionamento?” e “Há algum dano diferente do último registro?”. As perguntas finais serão validadas pela operação. Mostrar ocorrências anteriores sem induzir resposta; histórico não prova automaticamente que um novo usuário causou ou não causou um dano.

### Roteiro inicial de vistoria — proposta para discussão

As perguntas abaixo detalham os grupos pedidos pelo usuário, mas seu texto, obrigatoriedade e tratamento ainda não estão aprovados. Não substituir inspeção qualificada por uma declaração de aptidão mecânica gerada pelo sistema.

| Momento | Pergunta candidata | Respostas e desdobramento propostos |
| --- | --- | --- |
| Saída | Há dano visível na carroceria, vidros, retrovisores ou interior? | Sim / não / não consegui verificar. Se sim: local, descrição e foto; se não verificou: motivo e encaminhamento conforme política. |
| Saída | Há problema percebido nos pneus, luzes ou funcionamento? | Sim / não / não consegui verificar. Registrar descrição; impeditivos e responsável pela avaliação a definir. |
| Saída | As ocorrências anteriores ainda estão presentes? | Por ocorrência: presente / não identificada / não verificada. Uma resposta não apaga nem encerra o histórico anterior. |
| Retorno | Percebeu algum dano novo ou mudança em dano já registrado? | Sim / não / não consegui verificar. Se sim: descrição/local/foto propostos e comparação com a vistoria de saída. |
| Retorno | Houve incidente ou problema durante o uso que precise de atenção? | Sim / não. Se sim: relato e evidências disponíveis; não atribuir culpa automaticamente. |
| Retorno | Houve abastecimento durante este uso? | Sim / não. Se sim: permitir um ou mais registros com litros, valor e comprovante, conforme obrigatoriedade a aprovar. |
| Retorno | Foi realizada calibragem dos pneus durante este uso? | Sim / não / não se aplica, conforme política. Se sim: data e pressão opcional; se não: motivo apenas quando exigido. |

Proposta: rascunhos não pré-selecionam respostas positivas, negativas ou “sem danos”. Uma resposta obrigatória pode ser “não” ou “não consegui verificar”, mas o efeito operacional dessa resposta precisa ser definido; não confundir resposta preenchida com veículo liberado. O formulário final deve identificar sua versão, preservando o texto das perguntas/respostas históricas quando o gerente alterar o questionário para usos futuros.

### Regras de elegibilidade

- Saída avulsa não deve exigir criação de atendimento fictício.
- A retirada não depende de cargo técnico; depende de usuário ativo, política de acesso e elegibilidade para aquele veículo.
- Posse física ativa por outra pessoa impede nova retirada concorrente.
- Na janela protegida de uma reserva, qualquer integrante escalado na agenda pode retirar o carro; não liberar usuários externos à agenda nesse período.
- Mesmo com vários integrantes autorizados, há apenas uma posse ativa do carro. Registrar a identidade de quem efetivamente confirmou a retirada.
- Para uso fora da reserva, revalidar se o retorno previsto é compatível com a próxima agenda e seus intervalos de deslocamento/preparação.
- Dano ou condição classificada como impeditiva pode deixar o carro indisponível para nova saída, conforme política validada. Não decidir aptidão mecânica automaticamente com uma resposta genérica.
- Cancelar ou remover a reserva não encerra uma saída real nem apaga seu responsável.

## 6. Devolução: registrar o retorno e tratar pendências

1. Usuário abre sua saída em andamento e escolhe “Devolver veículo”.
2. Informa retorno físico, KM final, evidências e questionário de danos, abastecimento e pneus.
3. Sistema apresenta distância calculada quando os KMs forem válidos, diferenças reportadas e pendências.
4. Com informações consistentes, finaliza o uso e reavalia a disponibilidade para nova saída.
5. Se há falha de foto, divergência ou ocorrência que exige avaliação, permite registrar o retorno físico e mantém o caso **devolvido com pendência/em revisão**. Não indicar que o carro continua na rua por uma pendência administrativa.

Por padrão proposto, veículo devolvido com pendência relevante fica indisponível para nova saída até resolução autorizada. A classificação de pendências que bloqueiam circulação deve ser aprovada. A devolução não cancela reservas futuras e pode gerar aviso ao supervisor quando elas estiverem ameaçadas.

| Grupo | Perguntas/campos candidatos | Tratamento proposto |
| --- | --- | --- |
| Uso | KM final, horário de retorno e foto do hodômetro | KM/foto na devolução são propostas a confirmar; divergência abre conferência sem apagar o retorno físico |
| Danos | Há dano novo ou mudança no dano anterior? Qual? | Descrição e evidências quando aplicável; encaminhar ocorrência para conferência |
| Abastecimento | Abasteceu durante o uso? Sim/não. Se sim: combustível, litros, valor, momento e comprovante | Não interpretar “não” como falta ou impedir o retorno por padrão |
| Pneus | Realizou calibragem? Sim/não/não se aplica. Se sim: quando; pressão informada opcional | Não tornar calibragem obrigatória em toda viagem sem política explícita |
| Justificativa | Se não abasteceu/calibrou, registrar motivo quando a política exigir | Pergunta respondida é diferente de serviço executado |
| Observações | Algo precisa de atenção antes do próximo uso? | Abrir ocorrência e deixar claro quem receberá a pendência |

Não calcular consumo real apenas por dividir KM por litros abastecidos em uma viagem; isso pode ser enganoso sem método consistente de medição do tanque. Métricas iniciais: KM rodado, tempo de posse, quantidade de saídas, pendências e reservas afetadas.

## 7. Reservas, posse e exceções

### Reservas e previsão

- Quando o carro já foi escolhido, sua reserva começa na validação do supervisor. Se for definido depois, proposta: validar disponibilidade e reservar ao efetivar a vinculação, mesmo com agenda provisória. Sem carro escolhido, não existe reserva fictícia.
- Falta de mudanças por dois dias pode produzir notificação, mas nunca libera o recurso automaticamente.
- Duração do período reservado, horário de retirada permitido e tolerâncias antes/depois do atendimento são decisões pendentes.
- Reserva de amanhã não deve ser confundida com posse hoje. Uso avulso hoje por outro usuário está aprovado, desde que os horários e a margem de retorno sejam respeitados. Falta definir o valor da margem.
- Agenda cuja data passou sem resolução continua visível com indicação de atraso/pendência. Preservar o estado real até uma transição autorizada; a passagem do tempo não conclui/cancela o atendimento nem libera uma posse física.

### Casos que a futura implementação deve tratar

| Situação | Comportamento proposto |
| --- | --- |
| Dois usuários confirmam retirada ao mesmo tempo | Uma única confirmação vence; a outra recebe explicação e atualização da disponibilidade, sem duplicar posse |
| Carro fica reservado enquanto outro usuário preenche o formulário | Revalidar no envio; informar conflito e preservar o preenchimento recuperável sem confirmar saída indevida |
| Upload falha antes da retirada | Não confirmar retirada sem foto exigida; permitir tentar novamente, refazer foto ou cancelar com segurança |
| Rede cai depois de confirmar | Consultar o resultado registrado antes de repetir; repetir ação não cria uma segunda movimentação |
| Rede indisponível | Rascunho local, se aprovado, não é autorização de retirada; definir canal operacional de contingência. Não prometer funcionamento offline completo na primeira versão |
| Foto/KM diverge do último registro | Mostrar discrepância e caminho de correção/conferência; não alterar silenciosamente a leitura anterior |
| KM final inferior ao inicial | Abrir divergência; não produzir KM rodado negativo nem ajustar automaticamente. Registrar retorno físico separadamente |
| Retorno previsto ultrapassa próxima reserva | Bloquear nova retirada conflitante ou encaminhar ajuste explícito, conforme política definida; nunca apagar a próxima reserva |
| Veículo em uso atrasa e ameaça uma agenda | Marcar conflito real, avisar responsáveis e permitir replanejamento; não supor que o carro retornou no horário planejado |
| Agenda é reagendada com carro em uso | Recalcular reservas; preservar a posse real e notificar quem está com o carro. Mudança de agenda não transfere responsabilidade física |
| Agenda é cancelada com carro em uso | Liberar apenas o compromisso futuro aplicável, mantendo saída, responsável e obrigação de retorno registrados |
| Técnico é removido da agenda após retirar | Encaminhar regularização; não apagar sua responsabilidade pela saída nem impedir registrar o retorno por perda do vínculo anterior |
| Usuário fica inativo enquanto está com o carro | Manter histórico; prever regularização supervisionada com identidade do operador e do responsável real, sem falsificar sessão |
| Carro retorna com dano | Registrar retorno físico e ocorrência; deixar em revisão/manutenção quando necessário, sem disponibilização automática |
| Gerente precisa usar carro reservado para outro | Aplicar regra de vínculo; eventual reatribuição formal precede a retirada e deixa histórico. Não existir botão de bypass invisível |
| Terceiro devolve ou há troca de condutor | Política ainda pendente; se permitida, manter quem retirou, quem devolveu/assumiu, horário e motivo, sem reescrever o passado |

Transferência de posse no meio da viagem não é equivalente a cancelar uma retirada e criar outra retroativamente. Se for necessária, deve ganhar ação própria e critérios aprovados em fase posterior.

## 8. Histórico, fotos e acesso

Proposta de histórico de domínio: registrar criação/alteração de reserva, retirada, retorno físico, encerramento de pendência, ajuste de KM, reatribuição, cancelamento e mudança de condição. Cada evento preserva autor real, momento, motivo quando pertinente e vínculo com a agenda/saída. Correções acrescentam rastreabilidade; não apagam evidências anteriores.

- Fotos não ficam em endereço público permanente; autorização deve ser conferida também ao acessar o arquivo, não só na tela.
- Separar quem pode consultar, anexar, corrigir, baixar e administrar retenção. O gerente tem atuação global de negócio, mas não precisa de acesso técnico irrestrito a credenciais ou infraestrutura.
- Validar tamanho, tipo real e conteúdo aceito; preparar envio em rede móvel, prévia e recuperação por arquivo. A foto precisa manter legibilidade do hodômetro.
- Considerar dados incidentais capturados nas fotos; orientar a enquadrar o veículo/painel e evitar pessoas/documentos desnecessários.
- Definir retenção, exclusão autorizada, acesso a comprovantes e tratamento de metadados antes da implementação. Não declarar conformidade jurídica automática.
- Não confiar em QR Code para autorizar uso: ele identifica o veículo, e a sessão/regras determinam o acesso.
- Não transformar detecção de dano em responsabilização automática de um colaborador.

O histórico proposto é operacional, não promessa de auditoria imutável certificada. Recursos de histórico/auditoria da edição NocoBase escolhida e eventuais complementos devem ser avaliados no plano geral.

## 9. Integração planejada com o workflow

- Agenda e Frota compartilham os mesmos compromissos de veículo; não manter duas listas independentes de reservas.
- Supervisor valida equipe e carro se já escolhido; pode definir veículo depois. Comercial confirma cliente sem duplicar reservas; técnico vê provisória. Proposta: vinculação posterior verifica conflitos e efetiva a reserva do veículo.
- Retirada/devolução alteram a situação física do carro, não confirmam automaticamente o cliente nem encerram o atendimento.
- Ações gerenciais passam pelas mesmas validações de conflito e deixam motivo/histórico.
- O responsável de uma saída e os membros técnicos de uma agenda são conceitos distintos. A ligação entre usuários ATEM/NocoBase precisa ser estabelecida antes de prototipar permissões reais.
- NocoBase coordena workflow e configurações de negócio; a localização final das telas, autenticação unificada e origem autoritativa da disponibilidade dependem da decisão arquitetural do plano geral.
- O calendário não deve ser tratado como garantia de prevenção de concorrência; a confirmação de reserva/retirada precisa de uma decisão única e consistente no serviço responsável.
- Nenhuma dependência de integração comercial do Field Control é exigida por este plano.
- Fotos e questionários de frota permanecem no módulo Frota, sem alterar o formulário ou PDF de relatório de campo existente.

## 10. Decisões que antecedem a implementação

1. **Margem e janela:** quantos minutos/horas proteger para retorno, deslocamento e preparação? Qual antecedência de retirada? O uso anterior por terceiros sem conflito já está autorizado.
2. **Mudança de equipe:** qualquer integrante escalado já pode retirar. Como comunicar remoção/substituição de integrantes e tratar quem já está com o carro? Não apagar sua posse real.
3. **Carro posterior — resolvido:** supervisor pode definir depois, sem bloquear validação/confirmação. Resta definir tratamento operacional de atendimento próximo ainda com carro a definir.
4. **Agenda provisória:** enxergar está autorizado, mas o usuário já pode retirar antes da confirmação do cliente? Em qual condição?
5. **Saída avulsa:** quais campos e retorno previsto são obrigatórios? Precisa de justificativa, centro de custo ou autorização adicional? A escolha não pode presumir que cargos inferiores precisam de aprovação se isso não for solicitado.
6. **Devolução:** KM final e foto do hodômetro serão obrigatórios? Quem confere divergências? Há local ou entrega de chaves a registrar?
7. **Terceiros:** outra pessoa pode devolver ou assumir a condução? Como validar essa transferência?
8. **Questionários:** perguntas exatas, fotos de dano obrigatórias, regras de combustível/pneu e casos “não se aplica”. Abastecer/calibrar em toda viagem não está confirmado.
9. **Condição operacional:** quem cadastra, bloqueia para manutenção, recebe ocorrências e libera um carro em revisão? Quais danos impedem a retirada?
10. **Aviso de dois dias:** dias corridos ou úteis; qual mudança reinicia a contagem; para quem enviar; repetição e escalonamento. Não presumir que simples comentário ou login deve reiniciar o prazo.
11. **Visibilidade e arquivos:** escopo para técnico/comercial, fotos de terceiros, comprovantes, retenção e políticas de correção.
12. **Identidade/habilitação:** todos os usuários ativos podem dirigir, ou há autorização individual adicional? Como tratar usuário desativado com saída aberta?

## 11. Critérios de aceite previstos

Estes são testes a executar somente após autorização para implementação, preferencialmente com dados fictícios isolados.

- Comercial, supervisor, gerente e técnico elegíveis conseguem fazer uma saída avulsa; não se exige perfil técnico artificial.
- Usuário fora da agenda não retira carro reservado na janela definida, inclusive gerente sem reatribuição formal.
- Qualquer integrante escalado pode retirar o carro da agenda, mas tentativas simultâneas registram apenas uma posse ativa e identificam o retirante efetivo.
- Outro usuário consegue retirar hoje um carro reservado para amanhã se o período pretendido, incluindo margem, não conflitar; a reserva futura não é cancelada nem transferida.
- Programação provisória fica visível ao técnico com identificação clara; isso não concede permissão de retirada automaticamente.
- Validação reserva os recursos; dois dias sem alteração geram o aviso aprovado, sem expirar reserva.
- Dois cliques ou duas sessões simultâneas não criam duas posses ativas do mesmo carro.
- KM atual, foto e questionário exigidos são validados no servidor e na interface.
- Dado digitado/foto pendente não aparece como retirada concluída antes de confirmação efetiva.
- Uma falha de upload não perde o restante do formulário nem esconde a ação de recuperação.
- Devolução física pode ser registrada com pendência; veículo não fica disponível antes da resolução exigida pela política.
- Cancelamento/reagendamento não encerra posse física nem elimina o histórico de uma saída em curso.
- Perguntas de abastecimento e pneus aceitam as respostas previstas, sem obrigação automática de executar ambos em toda viagem.
- KM inconsistente não gera distância negativa nem sobrescreve a leitura anterior sem trilha de correção.
- Carro devolvido com dano impeditivo continua indisponível e a reserva afetada gera aviso operacional.
- Fotos e registros de outro usuário não podem ser acessados fora do escopo autorizado, inclusive por URL direta.
- Tela responde adequadamente nos quatro tamanhos definidos, teclado e movimento reduzido; formulários e diálogos não reproduzem o bug anterior de sobreposição.
- Nenhum teste, alteração ou integração muda o PDF do relatório de campo, seus contratos ou arquivos.

## 12. Fases propostas após ordem expressa

1. Fechar decisões acima e aprovar fluxo, permissões e questionários.
2. Validar arquitetura/edição NocoBase, identidade e origem única da disponibilidade, sem migração antecipada.
3. Prototipar o menu e os formulários com dados fictícios; revisar com um usuário de cada perfil.
4. Implementar cadastro, posse, evidências, histórico e validações de concorrência; executar os testes isolados.
5. Integrar reservas da agenda e alertas, incluindo atrasos, alterações e devoluções com pendências.
6. Pilotar com poucos veículos e usuários; ajustar questionário e mensagens antes de expandir.

Esta entrega encerra apenas o planejamento. Não instalar NocoBase, escrever código de aplicação, configurar automações, enviar notificações reais, migrar dados, alterar produção ou publicar o módulo sem a próxima ordem do usuário.
## Atualização de execução — 21/09/2026

Incluir teste de validação/confirmação sem carro e posterior vinculação com verificação de disponibilidade. Não criar veículo ou reserva fictícios para completar formulário. Identificar o carro antes da retirada; essa regra não decide se a saída com cliente ainda não confirmado será permitida. Nenhuma implementação autorizada.
