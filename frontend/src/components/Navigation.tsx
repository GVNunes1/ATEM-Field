import React from 'react';
import {
  Box,
  Calendar,
  ClipboardList,
  Home,
  PackageCheck,
  TabletSmartphone,
  Users
} from 'lucide-react';
import './Navigation.css';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'appointments', label: 'Agenda', icon: Calendar },
  { id: 'operations', label: 'Reservas', icon: PackageCheck },
  { id: 'inventory', label: 'Padrões', icon: Box },
  { id: 'technicians', label: 'Técnicos', icon: Users },
  { id: 'history', label: 'Histórico', icon: ClipboardList }
];

export const Navigation: React.FC<NavigationProps> = ({ activeTab, setActiveTab }) => {
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
          <div className="sidebar-avatar" aria-hidden="true">
            <span>AP</span>
          </div>
          <div className="sidebar-user-info">
            <strong>Administrador</strong>
            <span>Admin</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Navigation;
