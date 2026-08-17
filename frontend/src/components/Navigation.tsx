import React from 'react';
import {
  Calendar,
  ClipboardList,
  Home,
  Layers,
  PackageCheck,
  Search,
  Users
} from 'lucide-react';
import './Navigation.css';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const navItems = [
  { id: 'dashboard', label: 'Início', icon: Home },
  { id: 'inventory', label: 'Diagnóstico', icon: Search },
  { id: 'appointments', label: 'Agenda', icon: Calendar },
  { id: 'checklist', label: 'Conhecimento', icon: Layers },
  { id: 'history', label: 'Histórico', icon: ClipboardList },
  { id: 'technicians', label: 'Usuários', icon: Users },
  { id: 'operations', label: 'Reservas', icon: PackageCheck }
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

      {/* Bottom Profile */}
      <div className="sidebar-footer">
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
