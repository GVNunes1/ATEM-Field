import { useCallback, useEffect, useState } from 'react';
import { Navigation } from './components/Navigation';
import { DashboardView } from './pages/DashboardView';
import { InventoryView } from './pages/InventoryView';
import { AppointmentsView } from './pages/AppointmentsView';
import { ChecklistView } from './pages/ChecklistView';
import { TechniciansView } from './pages/TechniciansView';
import { OperationsAdminView } from './pages/OperationsAdminView';
import { ReservationHistoryView } from './pages/ReservationHistoryView';
import { TabletKioskView } from './pages/TabletKioskView';
import { LoginView } from './pages/LoginView';
import { PublicInfoView, PublicPage } from './pages/PublicInfoView';
import { ProfileView } from './pages/ProfileView';
import { AuthUser } from './types/auth';
import { safeFetchJson } from './lib/api';
import { SupportAssistant } from './features/support/SupportAssistant';

const noCacheFetchOptions: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' }
};

function getInitialTab(): string {
  const path = window.location.pathname.toLowerCase().replace(/^\/+/, '');
  if (path === 'perfil' || path === 'profile' || path.startsWith('perfil/') || path.startsWith('profile/')) return 'profile';
  if (path === 'totem' || path === 'tablet' || path === 'kiosk') return 'totem';
  if (path === 'templates' || path === 'checklist') return 'templates';
  if (path === 'reservas' || path === 'operacoes' || path === 'operations') return 'operations';
  if (path === 'padroes' || path === 'inventory' || path === 'diagnostico') return 'inventory';
  if (path === 'tecnicos' || path === 'usuarios' || path === 'technicians') return 'technicians';
  if (path === 'historico' || path === 'history') return 'history';
  if (path === 'agenda' || path === 'appointments') return 'appointments';
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam) return tabParam;
  return 'dashboard';
}

function getPublicPage(): PublicPage | null {
  const path = window.location.pathname.toLowerCase().replace(/^\/+|\/+$/g, '');
  if (path === 'sobre' || path === 'about') return 'about';
  if (path === 'privacidade' || path === 'privacy') return 'privacy';
  if (path === 'termos' || path === 'terms') return 'terms';
  return null;
}

export function App() {
  const publicPage = getPublicPage();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('atem.auth.user');
      const token = localStorage.getItem('atem.auth.token');
      return saved && token ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [stats, setStats] = useState<any>(null);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [analyzers, setAnalyzers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [selectedAppointmentForReservation, setSelectedAppointmentForReservation] = useState<number | string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);

  const handleLoginSuccess = (user: AuthUser, token: string) => {
    setCurrentUser(user);
    try {
      localStorage.setItem('atem.auth.user', JSON.stringify(user));
      localStorage.setItem('atem.auth.token', token);
    } catch {
      // Ignore
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSupportOpen(false);
    try {
      localStorage.removeItem('atem.auth.user');
      localStorage.removeItem('atem.auth.token');
    } catch {
      // Ignore
    }
  };

  const openSupport = useCallback(() => setSupportOpen(true), []);
  const closeSupport = useCallback(() => setSupportOpen(false), []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try {
      if (tab === 'totem' || tab === 'tablet') {
        window.history.pushState({}, '', '/totem');
      } else if (tab === 'templates' || tab === 'checklist') {
        window.history.pushState({}, '', '/templates');
      } else if (tab === 'dashboard') {
        window.history.pushState({}, '', '/');
      } else if (tab === 'inventory') {
        window.history.pushState({}, '', '/padroes');
      } else if (tab === 'appointments') {
        window.history.pushState({}, '', '/agenda');
      } else if (tab === 'operations') {
        window.history.pushState({}, '', '/reservas');
      } else if (tab === 'technicians') {
        window.history.pushState({}, '', '/tecnicos');
      } else if (tab === 'history') {
        window.history.pushState({}, '', '/historico');
      } else if (tab === 'profile') {
        window.history.pushState({}, '', '/perfil');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch {
      // Ignore in iframe / restricted environments
    }
  };

  const handleOpenReservationForAppointment = (apptId: number) => {
    setSelectedAppointmentForReservation(apptId);
    handleTabChange('operations');
  };

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(getInitialTab());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchAllData = useCallback(async () => {
    try {
      setLoadError('');
      const [statsData, analyzersData, apptsData, catsData, techsData] = await Promise.all([
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/analyzers', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/appointments', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/categories', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/technicians', noCacheFetchOptions).catch(() => ({ success: false }))
      ]);

      if (statsData?.success) {
        setStats(statsData.stats);
        setRecentReservations(statsData.recentReservations || []);
      }
      if (analyzersData?.success) setAnalyzers(analyzersData.analyzers || []);
      if (apptsData?.success) setAppointments(apptsData.appointments || []);
      if (catsData?.success) setCategories(catsData.categories || []);
      if (techsData?.success) setTechnicians(techsData.technicians || []);
    } catch (err: any) {
      setLoadError(err.message || 'Falha ao carregar dados operacionais.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLiveInventory = useCallback(async () => {
    try {
      const [analyzersData, statsData] = await Promise.all([
        safeFetchJson('/api/analyzers', noCacheFetchOptions).catch(() => null),
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions).catch(() => null)
      ]);

      if (analyzersData?.success) {
        setAnalyzers(analyzersData.analyzers || []);
      }
      if (statsData?.success) {
        setStats(statsData.stats);
        setRecentReservations(statsData.recentReservations || []);
      }
    } catch {
      // Background inventory refresh error
    }
  }, []);

  useEffect(() => {
    if (publicPage) {
      setLoading(false);
      return;
    }
    void fetchAllData();
  }, [fetchAllData, publicPage]);

  useEffect(() => {
    if (publicPage) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveInventory();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [publicPage, refreshLiveInventory]);

  if (publicPage) {
    return <PublicInfoView page={publicPage} />;
  }

  // Se estiver no Modo Totem / Tablet de Setor (Full Screen Kiosk)
  if (activeTab === 'totem') {
    return (
      <TabletKioskView
        technicians={technicians}
        appointments={appointments}
        analyzers={analyzers}
        onRefresh={fetchAllData}
        onExitKiosk={() => handleTabChange('dashboard')}
      />
    );
  }

  // Se não estiver logado, exibe a tela de login
  if (!currentUser) {
    return (
      <LoginView
        technicians={technicians}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div className="app-layout">
      <Navigation
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenSupport={openSupport}
      />
      <div className="app-content-wrapper">
        <main className="app-main">
          {loadError && (
            <div className="load-error" role="alert">
              <span>{loadError}</span>
              <button className="btn btn-secondary btn-sm" onClick={fetchAllData}>Tentar novamente</button>
            </div>
          )}

          {loading && activeTab !== 'profile' ? (
            <div className="loading-state" aria-live="polite">
              <span className="loading-spinner" />
              <div>
                <strong>Carregando operação</strong>
                <p>Buscando agenda, equipe e patrimônios.</p>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <DashboardView stats={stats} recentReservations={recentReservations} onNavigate={handleTabChange} />
              )}
              {activeTab === 'inventory' && (
                <InventoryView analyzers={analyzers} onRefresh={fetchAllData} currentUser={currentUser} />
              )}
              {activeTab === 'appointments' && (
                <AppointmentsView appointments={appointments} onOpenChecklistModal={handleOpenReservationForAppointment} />
              )}
              {(activeTab === 'templates' || activeTab === 'checklist') && (
                <ChecklistView categories={categories} onRefresh={fetchAllData} />
              )}
              {activeTab === 'technicians' && (
                <TechniciansView technicians={technicians} onRefresh={fetchAllData} />
              )}
              {activeTab === 'operations' && (
                <OperationsAdminView
                  appointments={appointments}
                  analyzers={analyzers}
                  technicians={technicians}
                  onRefresh={fetchAllData}
                  initialAppointmentId={selectedAppointmentForReservation}
                  currentUser={currentUser}
                />
              )}
              {activeTab === 'history' && (
                <ReservationHistoryView
                  analyzers={analyzers}
                  technicians={technicians}
                  onRefresh={fetchAllData}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileView currentUser={currentUser} />
              )}
            </>
          )}
        </main>

        <footer className="app-footer">
          ATEM Field © 2026 · Operações em campo e controle de patrimônio
        </footer>
      </div>
      <SupportAssistant open={supportOpen} onClose={closeSupport} />
    </div>
  );
}

export default App;
