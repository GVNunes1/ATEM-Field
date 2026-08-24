import { useEffect } from 'react';
import { CalendarSync, ClipboardCheck, PackageSearch, ShieldCheck, UsersRound } from 'lucide-react';
import './PublicInfoView.css';

export type PublicPage = 'about' | 'privacy' | 'terms';

interface PublicInfoViewProps {
  page: PublicPage;
}

const updatedAt = '24 de agosto de 2026';

function PublicHeader() {
  return (
    <header className="public-header">
      <a href="/sobre" className="public-brand" aria-label="ATEM Field — página institucional">
        <img src="/logomarca_azul_clinico_sem_fundo.png" alt="ATEM" width="132" height="52" />
        <span>
          <strong>ATEM Field</strong>
          <small>Gestão de campo e engenharia clínica</small>
        </span>
      </a>
      <nav className="public-nav" aria-label="Navegação institucional">
        <a href="/sobre">Sobre</a>
        <a href="/privacidade">Privacidade</a>
        <a href="/termos">Termos</a>
        <a href="/" className="public-login-link">Acessar sistema</a>
      </nav>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>ATEM Hospitalar · Assistência Técnica © 2026</span>
      <nav aria-label="Links legais">
        <a href="/sobre">Sobre</a>
        <a href="/privacidade">Política de Privacidade</a>
        <a href="/termos">Termos de Uso</a>
      </nav>
    </footer>
  );
}

function AboutContent() {
  return (
    <>
      <section className="public-hero" aria-labelledby="public-title">
        <div className="public-eyebrow"><ShieldCheck size={17} /> Plataforma operacional interna</div>
        <h1 id="public-title">Assistência técnica organizada, do atendimento à reserva de padrões.</h1>
        <p>
          O ATEM Field apoia a operação de engenharia clínica da ATEM Hospitalar, reunindo agenda de campo,
          técnicos, analisadores, reservas e checklists em um ambiente controlado.
        </p>
        <a href="/" className="public-primary-action">Acessar o ATEM Field</a>
      </section>

      <section className="public-section" aria-labelledby="features-title">
        <div className="public-section-heading">
          <span>Funcionalidades</span>
          <h2 id="features-title">Visão operacional em um só lugar</h2>
        </div>
        <div className="public-feature-grid">
          <article><CalendarSync /><h3>Agenda de campo</h3><p>Importa atendimentos autorizados do Google Agenda para consulta operacional.</p></article>
          <article><UsersRound /><h3>Equipe técnica</h3><p>Organiza responsáveis e permite que cada técnico consulte sua própria programação.</p></article>
          <article><PackageSearch /><h3>Padrões e analisadores</h3><p>Mostra disponibilidade e vincula patrimônios aos atendimentos programados.</p></article>
          <article><ClipboardCheck /><h3>Reservas e checklists</h3><p>Centraliza preparação, acompanhamento e histórico dos recursos utilizados.</p></article>
        </div>
      </section>

      <section className="public-section public-google-disclosure" aria-labelledby="google-data-title">
        <CalendarSync size={28} />
        <div>
          <h2 id="google-data-title">Como usamos dados do Google Agenda</h2>
          <p>
            Com autorização do responsável, o ATEM Field lê calendários e dados de eventos necessários para
            montar a agenda operacional. A integração não cria, altera ou exclui eventos no Google Agenda e
            não utiliza esses dados para publicidade.
          </p>
          <a href="/privacidade">Conheça nossa Política de Privacidade</a>
        </div>
      </section>
    </>
  );
}

function PrivacyContent() {
  return (
    <article className="public-document" aria-labelledby="privacy-title">
      <header><span>Documento público</span><h1 id="privacy-title">Política de Privacidade</h1><p>Última atualização: {updatedAt}</p></header>
      <section><h2>1. Finalidade</h2><p>Esta política explica como o ATEM Field acessa e utiliza dados necessários à gestão interna de atendimentos técnicos, reservas de padrões e atividades de engenharia clínica da ATEM Hospitalar.</p></section>
      <section><h2>2. Dados do Google acessados</h2><p>Após autorização, a integração pode acessar a lista de calendários e informações dos eventos, incluindo identificador, título, data, horário, local, descrição e situação do evento. O acesso é utilizado exclusivamente para importar e manter atualizada a agenda operacional no ATEM Field.</p></section>
      <section><h2>3. Uso e compartilhamento</h2><p>Os dados importados são exibidos somente a usuários autorizados e usados para organizar atendimentos, equipes e recursos. Não vendemos dados do Google, não os utilizamos para publicidade e não os compartilhamos com terceiros para finalidades independentes.</p></section>
      <section><h2>4. Armazenamento e segurança</h2><p>Os dados operacionais são armazenados na infraestrutura contratada pela ATEM Hospitalar, incluindo banco de dados Supabase e serviços de hospedagem necessários ao funcionamento do sistema. Credenciais de integração são mantidas como segredos de servidor e não são enviadas ao navegador.</p></section>
      <section><h2>5. Retenção e exclusão</h2><p>As informações são mantidas pelo período necessário à operação e aos registros internos aplicáveis. Solicitações de correção ou exclusão devem ser encaminhadas ao canal corporativo de suporte informado aos colaboradores da ATEM Hospitalar.</p></section>
      <section><h2>6. Controle do usuário</h2><p>O responsável pela conta Google pode revogar o acesso do ATEM Field a qualquer momento nas configurações de segurança da Conta Google. A revogação interrompe novas importações, sem alterar registros operacionais já incorporados quando houver obrigação legítima de conservação.</p></section>
      <section><h2>7. Uso limitado</h2><p>O uso das informações recebidas das APIs do Google segue a Política de Dados do Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado.</p></section>
      <section><h2>8. Atualizações</h2><p>Esta política poderá ser atualizada para refletir mudanças no sistema, na infraestrutura ou em requisitos legais. A versão vigente permanecerá publicada nesta página.</p></section>
    </article>
  );
}

function TermsContent() {
  return (
    <article className="public-document" aria-labelledby="terms-title">
      <header><span>Documento público</span><h1 id="terms-title">Termos de Uso</h1><p>Última atualização: {updatedAt}</p></header>
      <section><h2>1. Escopo do serviço</h2><p>O ATEM Field é uma plataforma de uso operacional da ATEM Hospitalar destinada à gestão de atendimentos técnicos, profissionais, reservas de padrões, analisadores e checklists.</p></section>
      <section><h2>2. Usuários autorizados</h2><p>O acesso é restrito a administradores, técnicos e demais profissionais expressamente autorizados. Cada usuário deve proteger suas credenciais e utilizar o sistema somente para atividades relacionadas às suas atribuições.</p></section>
      <section><h2>3. Responsabilidade pelas informações</h2><p>Usuários devem conferir dados de agenda, reservas e disponibilidade antes de executar atividades de campo. O sistema auxilia a operação, mas não substitui procedimentos técnicos, normas de segurança ou validações profissionais aplicáveis.</p></section>
      <section><h2>4. Integração com o Google</h2><p>A leitura do Google Agenda depende de autorização válida da conta responsável. O usuário pode revogar esse acesso no Google. Interrupções ou limites do serviço do Google podem afetar temporariamente a atualização da agenda.</p></section>
      <section><h2>5. Uso aceitável</h2><p>É proibido tentar contornar controles de acesso, consultar informações sem autorização, interferir no funcionamento da plataforma ou utilizar os dados para finalidade diversa da operação institucional.</p></section>
      <section><h2>6. Disponibilidade e alterações</h2><p>O sistema poderá receber manutenções e atualizações. Funcionalidades podem ser ajustadas para segurança, melhoria operacional ou atendimento a requisitos técnicos e legais.</p></section>
      <section><h2>7. Privacidade</h2><p>O tratamento de informações pessoais e dados provenientes do Google Agenda está descrito na <a href="/privacidade">Política de Privacidade</a>.</p></section>
    </article>
  );
}

export function PublicInfoView({ page }: PublicInfoViewProps) {
  useEffect(() => {
    const metadata = {
      about: ['ATEM Field | Gestão de campo e engenharia clínica', 'Conheça o ATEM Field e como a plataforma organiza agenda, técnicos, padrões e reservas.'],
      privacy: ['Política de Privacidade | ATEM Field', 'Saiba como o ATEM Field acessa, utiliza e protege dados operacionais e do Google Agenda.'],
      terms: ['Termos de Uso | ATEM Field', 'Consulte as condições de uso da plataforma operacional ATEM Field.'],
    }[page];
    document.title = metadata[0];
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = metadata[1];
  }, [page]);

  return (
    <div className="public-page-root">
      <a className="public-skip-link" href="#public-content">Ir para o conteúdo</a>
      <PublicHeader />
      <main id="public-content" className="public-main">
        {page === 'about' && <AboutContent />}
        {page === 'privacy' && <PrivacyContent />}
        {page === 'terms' && <TermsContent />}
      </main>
      <PublicFooter />
    </div>
  );
}
