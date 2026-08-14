import { Box, Calendar, CheckSquare, History, LayoutDashboard, PackageCheck, Users } from 'lucide-react';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const tabs = [
  { id: 'dashboard', label: 'Painel geral', icon: LayoutDashboard },
  { id: 'inventory', label: 'Patrimônios', icon: Box },
  { id: 'appointments', label: 'Agenda', icon: Calendar },
  { id: 'checklist', label: 'Templates e checklist', icon: CheckSquare },
  { id: 'technicians', label: 'Técnicos', icon: Users },
  { id: 'operations', label: 'Reservas', icon: PackageCheck },
  { id: 'history', label: 'Histórico', icon: History }
];

export function Navigation({ activeTab, setActiveTab }: NavigationProps) {
  return (
    <nav className="app-navigation" aria-label="Navegação principal">
      <div className="app-navigation__scroll">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`nav-tab ${active ? 'nav-tab--active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
