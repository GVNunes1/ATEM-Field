import { useCallback, useEffect, useRef, useState } from 'react';
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
import { FleetView } from './pages/FleetView';
import { WorkflowView } from './pages/WorkflowView';
import { AuthUser } from './types/auth';
import { safeFetchJson } from './lib/api';
import { SupportAssistant } from './features/support/SupportAssistant';
import { CalendarDays, ChevronRight, RefreshCw } from 'lucide-react';
import { PageSkeleton } from './components/PageSkeleton';
import type { OperationalInsights } from './lib/operationalInsights';

const noCacheFetchOptions: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' }
};

function normalizeTab(tab: string): string {
  return ['totem', 'tablet', 'kiosk'].includes(tab.toLowerCase()) ? 'totem' : tab;
}

function clearStoredSession() {
  try {
    localStorage.removeItem('atem.auth.user');
    localStorage.removeItem('atem.auth.token');
  } catch { /* Storage can be unavailable. */ }
}

function getInitialTab(): string {
  const path = window.location.pathname.toLowerCase().replace(/^\/+|\/+$/g, '');
  if (path === 'perfil' || path === 'profile' || path.startsWith('perfil/') || path.startsWith('profile/')) return 'profile';
  if (path === 'totem' || path === 'tablet' || path === 'kiosk') return 'totem';
  if (path === 'templates' || path === 'checklist') return 'templates';
  if (path === 'reservas' || path === 'operacoes' || path === 'operations') return 'operations';
  if (path === 'padroes' || path === 'inventory' || path === 'diagnostico') return 'inventory';
  if (path === 'tecnicos' || path === 'usuarios' || path === 'technicians') return 'technicians';
  if (path === 'historico' || path === 'history') return 'history';
  if (path === 'frota' || path === 'fleet') return 'fleet';
  if (path === 'agenda' || path === 'appointments') return 'appointments';
  if (path === 'workflow' || path === 'fluxo') return 'workflow';
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get('tab');
  if (tabParam) return normalizeTab(tabParam);
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
    if (getInitialTab() === 'totem') {
      clearStoredSession();
      return null;
    }
    try {
      const saved = localStorage.getItem('atem.auth.user');
      const token = localStorage.getItem('atem.auth.token');
      return saved && token ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState(getInitialTab);
  const activeTabRef = useRef(activeTab);
  const currentUserRef = useRef(currentUser);
  const sessionEpoch = useRef(0);
  const [renderedEpoch, setRenderedEpoch] = useState(0);
  const [sessionResetKey, setSessionResetKey] = useState(0);
  const sessionUserId = currentUser?.id;
  useEffect(() => {
    if (sessionUserId === undefined) return;
    let alive = true;
    const epoch = sessionEpoch.current;
    const refreshAccess = async () => {
      try {
        const result = await safeFetchJson('/api/auth/session', { cache: 'no-store' });
        if (alive && epoch === sessionEpoch.current && result.success && result.user?.role) setCurrentUser(previous => {
          if (!previous || String(previous.id) !== String(result.user.id)) return previous;
          const updated = { ...previous, ...result.user };
          localStorage.setItem('atem.auth.user', JSON.stringify(updated));
          return updated;
        });
      } catch { /* Keep the session display; server authorization fails closed. */ }
    };
    void refreshAccess();
    window.addEventListener('focus', refreshAccess);
    return () => { alive = false; window.removeEventListener('focus', refreshAccess); };
  }, [sessionUserId]);
  const [stats, setStats] = useState<any>(null);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [analyzers, setAnalyzers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [operationalInsights, setOperationalInsights] = useState<OperationalInsights>({ available: false, readiness: [], alerts: [] });
  const [focusedAppointmentId, setFocusedAppointmentId] = useState<number | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [selectedAppointmentForReservation, setSelectedAppointmentForReservation] = useState<number | string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [agendaRefreshError, setAgendaRefreshError] = useState('');

  const handleLoginSuccess = (user: AuthUser, token: string) => {
    sessionEpoch.current += 1;
    setRenderedEpoch(sessionEpoch.current);
    currentUserRef.current = user;
    setCurrentUser(user);
    try {
      localStorage.setItem('atem.auth.user', JSON.stringify(user));
      localStorage.setItem('atem.auth.token', token);
    } catch {
      // Ignore
    }
  };

  const handleLogout = useCallback(() => {
    sessionEpoch.current += 1;
    setRenderedEpoch(sessionEpoch.current);
    currentUserRef.current = null;
    clearStoredSession();
    setCurrentUser(null);
    setSupportOpen(false);
    setStats(null);
    setRecentReservations([]);
    setAnalyzers([]);
    setAppointments([]);
    setOperationalInsights({ available: false, readiness: [], alerts: [] });
    setFocusedAppointmentId(null);
    setCategories([]);
    setTechnicians([]);
    setSelectedAppointmentForReservation(null);
    setLoadError('');
    setAgendaRefreshError('');
    setLastUpdated(null);
    setRefreshing(false);
    setLoading(true);
    setSessionResetKey(previous => previous + 1);
  }, []);

  const openSupport = useCallback(() => setSupportOpen(true), []);
  const closeSupport = useCallback(() => setSupportOpen(false), []);

  const transitionTab = useCallback((tab: string) => {
    const nextTab = normalizeTab(tab);
    if (nextTab !== activeTabRef.current && (nextTab === 'totem' || activeTabRef.current === 'totem')) {
      handleLogout();
    }
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
  }, [handleLogout]);

  const handleTabChange = (requestedTab: string) => {
    const tab = normalizeTab(requestedTab);
    transitionTab(tab);
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
      } else if (tab === 'workflow') {
        window.history.pushState({}, '', '/workflow');
      } else if (tab === 'operations') {
        window.history.pushState({}, '', '/reservas');
      } else if (tab === 'technicians') {
        window.history.pushState({}, '', '/tecnicos');
      } else if (tab === 'history') {
        window.history.pushState({}, '', '/historico');
      } else if (tab === 'fleet') {
        window.history.pushState({}, '', '/frota');
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
  const openOperationalAppointment = (appointmentId: number) => {
    setFocusedAppointmentId(appointmentId);
    handleTabChange('appointments');
  };

  useEffect(() => {
    const onPopState = () => {
      transitionTab(getInitialTab());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [transitionTab]);

  const fetchAllData = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const authenticated = Boolean(currentUserRef.current);
    try {
      setLoadError('');
      const [statsData, analyzersData, apptsData, catsData, techsData, insightsData] = await Promise.all([
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/analyzers', noCacheFetchOptions).catch(() => ({ success: false })),
        authenticated ? safeFetchJson('/api/appointments', noCacheFetchOptions).catch(() => ({ success: false })) : Promise.resolve({ success: true, appointments: [] }),
        safeFetchJson('/api/categories', noCacheFetchOptions).catch(() => ({ success: false })),
        safeFetchJson('/api/technicians', noCacheFetchOptions).catch(() => ({ success: false })),
        authenticated ? safeFetchJson('/api/appointments/operational-insights', noCacheFetchOptions).catch(() => ({ success: false })) : Promise.resolve({ success: false })
      ]);

      if (epoch !== sessionEpoch.current) return;

      if (statsData?.success) {
        setStats(statsData.stats);
        setRecentReservations(statsData.recentReservations || []);
      }
      if (analyzersData?.success) setAnalyzers(analyzersData.analyzers || []);
      if (apptsData?.success) {
        setAppointments(apptsData.appointments || []);
        setAgendaRefreshError('');
      }
      if (catsData?.success) setCategories(catsData.categories || []);
      if (techsData?.success) setTechnicians(techsData.technicians || []);
      setOperationalInsights(insightsData?.success
        ? { available: true, readiness: insightsData.readiness || [], alerts: insightsData.alerts || [] }
        : { available: false, readiness: [], alerts: [] });
      const sources = [statsData, analyzersData, apptsData, catsData, techsData];
      const unavailable = sources.filter(source => !source?.success).length;
      if (unavailable) {
        setLoadError(unavailable === sources.length
          ? 'Não foi possível carregar a operação. Verifique sua conexão e tente novamente.'
          : 'Alguns dados não puderam ser atualizados. Tente novamente para completar a consulta.');
      } else {
        setLastUpdated(new Date());
      }
    } catch (err: any) {
      if (epoch === sessionEpoch.current) setLoadError(err.message || 'Falha ao carregar dados operacionais.');
    } finally {
      if (epoch === sessionEpoch.current) setLoading(false);
    }
  }, []);

  const refreshLiveInventory = useCallback(async () => {
    const epoch = sessionEpoch.current;
    try {
      const [analyzersData, statsData] = await Promise.all([
        safeFetchJson('/api/analyzers', noCacheFetchOptions).catch(() => null),
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions).catch(() => null)
      ]);

      if (epoch !== sessionEpoch.current) return;

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

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchAllData(); } finally { setRefreshing(false); }
  };

  useEffect(() => {
    if (publicPage) {
      setLoading(false);
      return;
    }
    void fetchAllData();
  }, [fetchAllData, publicPage, currentUser?.id, sessionResetKey]);

  useEffect(() => {
    if (publicPage) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveInventory();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [publicPage, refreshLiveInventory]);

  useEffect(() => {
    if (publicPage || !currentUser || activeTab !== 'dashboard') return;
    let alive = true;
    const epoch = sessionEpoch.current;
    const refreshInsights = async () => {
      try {
        const result = await safeFetchJson('/api/appointments/operational-insights', noCacheFetchOptions);
        if (alive && epoch === sessionEpoch.current) setOperationalInsights(result?.success
          ? { available: true, readiness: result.readiness || [], alerts: result.alerts || [] }
          : { available: false, readiness: [], alerts: [] });
      } catch {
        if (alive && epoch === sessionEpoch.current) setOperationalInsights({ available: false, readiness: [], alerts: [] });
      }
    };
    void refreshInsights();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshInsights(); }, 60_000);
    window.addEventListener('focus', refreshInsights);
    return () => { alive = false; window.clearInterval(interval); window.removeEventListener('focus', refreshInsights); };
  }, [activeTab, currentUser?.id, publicPage]);

  useEffect(() => {
    if (publicPage || !currentUser || !['appointments', 'workflow', 'totem'].includes(activeTab)) return;
    let alive = true;
    const epoch = sessionEpoch.current;
    const refreshAppointments = async () => {
      try {
        const [result, insightResult] = await Promise.all([
          safeFetchJson('/api/appointments', noCacheFetchOptions),
          safeFetchJson('/api/appointments/operational-insights', noCacheFetchOptions).catch(() => null)
        ]);
        if (!result?.success) throw new Error(result?.error || 'Não foi possível atualizar a agenda.');
        if (alive && epoch === sessionEpoch.current) {
          setAppointments(result.appointments || []);
          setOperationalInsights(insightResult?.success
            ? { available: true, readiness: insightResult.readiness || [], alerts: insightResult.alerts || [] }
            : { available: false, readiness: [], alerts: [] });
          setAgendaRefreshError('');
        }
      } catch (error) {
        if (alive && epoch === sessionEpoch.current) setAgendaRefreshError(error instanceof Error ? error.message : 'A agenda não pôde ser atualizada. Verifique a conexão.');
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshAppointments(); };
    void refreshAppointments();
    const interval = window.setInterval(onVisible, 30000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [activeTab, currentUser?.id, publicPage]);

  if (publicPage) {
    return <PublicInfoView page={publicPage} />;
  }

  // Se estiver no Modo Totem / Tablet de Setor (Full Screen Kiosk)
  if (activeTab === 'totem') {
    return (
      <TabletKioskView
        key={sessionResetKey}
        technicians={technicians}
        appointments={appointments}
        analyzers={analyzers}
        onRefresh={fetchAllData}
        agendaSyncError={agendaRefreshError}
        onAuthenticated={(user, token) => {
          if (activeTabRef.current === 'totem' && renderedEpoch === sessionEpoch.current) handleLoginSuccess(user, token);
        }}
        onSessionEnd={handleLogout}
        onExitKiosk={() => handleTabChange('dashboard')}
      />
    );
  }

  // Se não estiver logado, exibe a tela de login
  if (!currentUser) {
    return (
      <LoginView
        technicians={technicians}
        onLoginSuccess={(user, token) => {
          if (activeTabRef.current !== 'totem' && renderedEpoch === sessionEpoch.current) handleLoginSuccess(user, token);
        }}
      />
    );
  }

  return (
    <div className="app-layout">
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      <Navigation
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        currentUser={currentUser}
        onLogout={handleLogout}
        onOpenSupport={openSupport}
      />
      <div className="app-content-wrapper">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>ATEM Field</span><ChevronRight size={14} aria-hidden="true" /><strong>{({ dashboard: 'Dashboard', appointments: 'Agenda', workflow: 'Workflow', operations: 'Reservas', inventory: 'Padrões', fleet: 'Frota', technicians: 'Técnicos', history: 'Histórico', templates: 'Templates', checklist: 'Templates', profile: 'Perfil' } as Record<string, string>)[activeTab] || 'Área de trabalho'}</strong></div>
          <div className="workspace-tools">
            <span className="workspace-date"><CalendarDays size={15} aria-hidden="true" />{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            <button className="workspace-refresh" onClick={handleRefresh} disabled={refreshing} aria-label="Atualizar dados" title={lastUpdated ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR')}` : 'Atualizar dados'}><RefreshCw size={16} className={refreshing ? 'spin' : undefined} /><span>{refreshing ? 'Atualizando' : 'Atualizar'}</span></button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="app-main" data-page={activeTab}>
          {loadError && (
            <div className="load-error" role="alert">
              <span>{loadError}</span>
              <button className="btn btn-secondary btn-sm" onClick={fetchAllData}>Tentar novamente</button>
            </div>
          )}
          {agendaRefreshError && ['appointments', 'workflow'].includes(activeTab) && (
            <div className="load-error" role="alert">
              <span>Agenda não atualizada: {agendaRefreshError}</span>
              <button className="btn btn-secondary btn-sm" onClick={handleRefresh}>Tentar novamente</button>
            </div>
          )}

          {loading && activeTab !== 'profile' ? (
            <PageSkeleton />
          ) : (
            <div key={activeTab} className="page-transition">
              {activeTab === 'dashboard' && (
                <DashboardView stats={stats} recentReservations={recentReservations} appointments={appointments} insights={operationalInsights} onOpenOperationalAppointment={openOperationalAppointment} onNavigate={handleTabChange} onOpenReservation={handleOpenReservationForAppointment} onRetry={handleRefresh} />
              )}
              {activeTab === 'inventory' && (
                <InventoryView analyzers={analyzers} onRefresh={fetchAllData} currentUser={currentUser} />
              )}
              {activeTab === 'fleet' && (
                <FleetView appointments={appointments} currentUser={currentUser} onRefresh={fetchAllData} />
              )}
              {activeTab === 'appointments' && (
                <AppointmentsView appointments={appointments} insights={operationalInsights} focusAppointmentId={focusedAppointmentId} onFocusHandled={() => setFocusedAppointmentId(null)} onOpenChecklistModal={handleOpenReservationForAppointment} currentUser={currentUser} onRefresh={fetchAllData} />
              )}
              {activeTab === 'workflow' && (['admin', 'manager', 'supervisor', 'commercial', 'technician'].includes(currentUser.role)
                ? <WorkflowView appointments={appointments} insights={operationalInsights} technicians={technicians} role={currentUser.role} currentUserId={currentUser.id} onRefresh={fetchAllData} />
                : <div className="field-empty field-surface" role="alert"><h1>Acesso restrito</h1><p>O Workflow é destinado ao Comercial, Supervisão e Gerência.</p></div>)}
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
            </div>
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
