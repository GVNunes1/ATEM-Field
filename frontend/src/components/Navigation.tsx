import React from 'react';
import {
  Box,
  Calendar,
  ClipboardList,
  Home,
  LogOut,
  PackageCheck,
  TabletSmartphone,
  Users
} from 'lucide-react';
import { AuthUser } from '../types/auth';
import './Navigation.css';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onLogout
}) => {
  const isAdmin = currentUser?.role === 'admin';

  // Técnicos não veem gerenciamento de equipe/usuários
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'appointments', label: 'Agenda', icon: Calendar },
    { id: 'operations', label: 'Reservas', icon: PackageCheck },
    { id: 'inventory', label: 'Padrões', icon: Box },
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
    <aside className="app-sidebar" aria-label="Navegação principal">
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
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
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
              <span>{isAdmin ? 'Admin Master' : 'Técnico de Campo'}</span>
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
    </aside>
  );
};

export default Navigation;
