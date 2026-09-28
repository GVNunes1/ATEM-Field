import React, { useEffect, useState } from 'react';
import {
  Box,
  CarFront,
  CheckSquare,
  Calendar,
  ClipboardList,
  CircleHelp,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PackageCheck,
  Settings2,
  TabletSmartphone,
  Workflow,
  Users
} from 'lucide-react';
import { AuthUser } from '../types/auth';
import { roleLabel } from '../lib/permissions';
import { ModalOverlay } from './ModalOverlay';
import './Navigation.css';

const hiddenKey = (id: number | string | undefined) => `atem.sidebar.hidden.${id ?? 'guest'}`;
const defaultHidden = (role?: string) => role === 'manager' || role === 'supervisor' ? ['templates'] : [];
const readHidden = (id: number | string | undefined, role?: string): string[] => {
  try {
    const saved = localStorage.getItem(hiddenKey(id));
    if (saved === null) return defaultHidden(role);
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : defaultHidden(role);
  } catch { return defaultHidden(role); }
};

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser?: AuthUser | null;
  onLogout?: () => void;
  onOpenSupport?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onLogout,
  onOpenSupport
}) => {
  const isAdmin = currentUser?.role === 'admin';
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('atem.sidebar.collapsed') === 'true');
  const [hidden, setHidden] = useState<string[]>(() => readHidden(currentUser?.id, currentUser?.role));
  const [showPreferences, setShowPreferences] = useState(false);
  useEffect(() => setHidden(readHidden(currentUser?.id, currentUser?.role)), [currentUser?.id, currentUser?.role]);
  const toggleVisibility = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter(item => item !== id) : [...hidden, id];
    setHidden(next);
    localStorage.setItem(hiddenKey(currentUser?.id), JSON.stringify(next));
  };
  const toggleCollapsed = () => setCollapsed(value => {
    localStorage.setItem('atem.sidebar.collapsed', String(!value));
    return !value;
  });

  // Técnicos não veem gerenciamento de equipe/usuários
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'appointments', label: 'Agenda', icon: Calendar },
    ...(['admin', 'manager', 'supervisor', 'commercial'].includes(currentUser?.role || '') ? [{ id: 'workflow', label: 'Workflow', icon: Workflow }] : []),
    ...(currentUser?.role === 'technician' ? [{ id: 'workflow', label: 'Minhas atividades', icon: Workflow }] : []),
    { id: 'operations', label: 'Reservas', icon: PackageCheck },
    { id: 'inventory', label: 'Padrões', icon: Box },
    { id: 'fleet', label: 'Frota', icon: CarFront },
    ...(currentUser?.role !== 'technician' ? [{ id: 'templates', label: 'Templates', icon: CheckSquare }] : []),
    ...(isAdmin ? [{ id: 'technicians', label: 'Técnicos', icon: Users }] : []),
    { id: 'history', label: 'Histórico', icon: ClipboardList }
  ];

  const userInitials = (currentUser?.name || 'Admin')
    .split(' ')
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();

  return (
    <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`} aria-label="Navegação principal">
      {/* Top Logo */}
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <img
            src="/logomarca.png"
            alt="ATEM"
            onError={e => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
        <span className="sidebar-product">Field<span>Gestão de campo</span></span>
        <button type="button" className="sidebar-collapse" onClick={toggleCollapsed} aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} aria-expanded={!collapsed} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Área de trabalho</span>
        {navItems.filter(item => item.id === 'dashboard' || !hidden.includes(item.id)).map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-nav-icon">
                <Icon size={20} />
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Profile and Totem Shortcut */}
      <div className="sidebar-footer">
        <button type="button" className="sidebar-preferences-shortcut" onClick={() => setShowPreferences(true)} aria-label="Personalizar menu" title="Personalizar menu"><Settings2 size={18} aria-hidden="true" /><span>Personalizar menu</span></button>
        {onOpenSupport && (
          <button
            id="support-open-button"
            type="button"
            onClick={onOpenSupport}
            className="sidebar-support-shortcut"
            title="Abrir Ajuda ATEM"
            aria-label="Abrir Ajuda ATEM"
          >
            <CircleHelp size={18} aria-hidden="true" />
            <span>Ajuda ATEM</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('totem')}
          className="sidebar-totem-shortcut"
          title="Abrir o Totem / Tablet de Autoatendimento do Setor"
        >
          <TabletSmartphone size={18} />
          <span>Modo Tablet / Totem</span>
        </button>

        <div className="sidebar-user">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`sidebar-profile-btn ${activeTab === 'profile' ? 'sidebar-profile-btn--active' : ''}`}
            aria-current={activeTab === 'profile' ? 'page' : undefined}
            title="Abrir perfil e Ordens de Serviço"
          >
            <span className="sidebar-avatar" aria-hidden="true">
              <span>{userInitials || 'AP'}</span>
            </span>
            <span className="sidebar-user-info">
              <strong>{currentUser?.name || 'Administrador'}</strong>
              <span>{roleLabel(currentUser?.role)}</span>
            </span>
          </button>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="sidebar-logout-btn"
              title="Encerrar sessão"
              aria-label="Encerrar sessão"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
      {showPreferences && <ModalOverlay onDismiss={() => setShowPreferences(false)} className="sidebar-preferences-overlay"><section className="sidebar-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="sidebar-preferences-title"><div className="sidebar-preferences-heading"><div><h2 id="sidebar-preferences-title">Personalizar menu</h2><p>Escolha o que aparece na barra lateral. Dashboard permanece visível.</p></div><button type="button" onClick={() => setShowPreferences(false)} aria-label="Fechar personalização">×</button></div><div className="sidebar-preferences-list">{navItems.filter(item => item.id !== 'dashboard').map(item => { const Icon = item.icon; return <label key={item.id} className="sidebar-preferences-row"><Icon size={18} aria-hidden="true" /><span>{item.label}</span><input type="checkbox" checked={!hidden.includes(item.id)} onChange={() => toggleVisibility(item.id)} aria-label={`Mostrar ${item.label}`} /></label>; })}</div><button type="button" className="sidebar-preferences-done" onClick={() => setShowPreferences(false)}>Concluído</button></section></ModalOverlay>}
    </aside>
  );
};

export default Navigation;
