import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardSignature,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
  Wrench
} from 'lucide-react';
import { ServiceOrdersPanel } from '../features/service-orders/ServiceOrdersPanel';
import { AuthUser } from '../types/auth';
import './ProfileView.css';

interface ProfileViewProps {
  currentUser: AuthUser;
}

type ProfileSection = 'overview' | 'service-orders';

function sectionFromPath(): ProfileSection {
  const path = window.location.pathname.toLocaleLowerCase('pt-BR');
  return path.includes('ordens-de-servico') || path.includes('service-orders') ? 'service-orders' : 'overview';
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR') || 'AF';
}

export function ProfileView({ currentUser }: ProfileViewProps) {
  const [section, setSection] = useState<ProfileSection>(sectionFromPath);
  const userInitials = useMemo(() => initials(currentUser.name), [currentUser.name]);
  const roleLabel = currentUser.role === 'admin' ? 'Administrador Master' : 'Técnico de Campo';

  useEffect(() => {
    const popState = () => setSection(sectionFromPath());
    window.addEventListener('popstate', popState);
    return () => window.removeEventListener('popstate', popState);
  }, []);

  const navigate = (next: ProfileSection) => {
    window.history.pushState({}, '', next === 'service-orders' ? '/perfil/ordens-de-servico' : '/perfil');
    setSection(next);
  };

  if (section === 'service-orders') {
    return (
      <div className="profile-page profile-page--service-orders">
        <div className="profile-module-header">
          <button type="button" className="profile-back-button" onClick={() => navigate('overview')}>
            <ArrowLeft size={18} /> Voltar ao perfil
          </button>
          <nav className="profile-breadcrumb" aria-label="Caminho da página">
            <button type="button" onClick={() => navigate('overview')}>Perfil</button>
            <ChevronRight size={15} aria-hidden="true" />
            <span aria-current="page">Ordens de Serviço</span>
          </nav>
        </div>
        <div className="profile-module-title">
          <span><ClipboardSignature size={24} /></span>
          <div>
            <p>ATEM Field · Perfil de usuário</p>
            <h1>Ordens de Serviço</h1>
            <span>Gere, edite, assine e consulte relatórios de campo sem sair da sua sessão.</span>
          </div>
        </div>
        <ServiceOrdersPanel currentUser={currentUser} />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <header className="profile-heading">
        <div>
          <p>Conta e recursos do usuário</p>
          <h1>Meu perfil</h1>
          <span>Consulte seus dados e acesse ferramentas vinculadas à sua função.</span>
        </div>
        <span className="profile-role-badge"><ShieldCheck size={16} /> {roleLabel}</span>
      </header>

      <div className="profile-grid">
        <section className="profile-card profile-identity-card" aria-labelledby="profile-user-name">
          <div className="profile-avatar-large" aria-hidden="true">{userInitials}</div>
          <div>
            <span className="profile-card-label">Usuário conectado</span>
            <h2 id="profile-user-name">{currentUser.name}</h2>
            <p>{roleLabel}</p>
          </div>
          <dl className="profile-details">
            <div><dt><UserRound size={17} /> Identificador</dt><dd className="profile-technical-value">{currentUser.id}</dd></div>
            <div><dt><Mail size={17} /> E-mail</dt><dd>{currentUser.email || 'Não informado'}</dd></div>
            <div><dt><Phone size={17} /> Telefone</dt><dd>{currentUser.phone || 'Não informado'}</dd></div>
          </dl>
        </section>

        <section className="profile-card profile-access-card" aria-labelledby="profile-access-title">
          <div className="profile-access-icon"><ClipboardSignature size={27} /></div>
          <span className="profile-card-label">Ferramenta integrada</span>
          <h2 id="profile-access-title">Ordens de Serviço</h2>
          <p>
            As Ordens de Serviço agora fazem parte do ATEM Field. Acesse seus relatórios, pesquise equipamentos,
            colete assinaturas e gere o PDF final usando o mesmo perfil.
          </p>
          <ul>
            <li><Wrench size={16} /> Busca automática por número de série</li>
            <li><ClipboardSignature size={16} /> Assinatura digital de técnico e cliente</li>
            <li><ShieldCheck size={16} /> Acesso protegido pela sessão do ATEM Field</li>
          </ul>
          <button type="button" className="profile-primary-action" onClick={() => navigate('service-orders')}>
            Abrir Ordens de Serviço <ChevronRight size={18} />
          </button>
        </section>
      </div>
    </div>
  );
}

export default ProfileView;
