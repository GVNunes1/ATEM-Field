import { useCallback, useEffect, useState } from 'react';
import { Navigation } from './components/Navigation';
import { DashboardView } from './pages/DashboardView';
import { InventoryView } from './pages/InventoryView';
import { AppointmentsView } from './pages/AppointmentsView';
import { ChecklistView } from './pages/ChecklistView';
import { TechniciansView } from './pages/TechniciansView';
import { OperationsAdminView } from './pages/OperationsAdminView';
import { ReservationHistoryView } from './pages/ReservationHistoryView';
import { safeFetchJson } from './lib/api';

const noCacheFetchOptions: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' }
};

function getInitialTab(): string {
  const path = window.location.pathname.toLowerCase().replace(/^\/+/, '');
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

export function App() {
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [stats, setStats] = useState<any>(null);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [analyzers, setAnalyzers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    try {
      if (tab === 'templates' || tab === 'checklist') {
        window.history.pushState({}, '', '/templates');
      } else if (tab === 'dashboard') {
        window.history.pushState({}, '', '/');
      } else if (tab === 'inventory') {
        window.history.pushState({}, '', '/padroes');
      } else if (tab === 'operations') {
        window.history.pushState({}, '', '/reservas');
      } else if (tab === 'technicians') {
        window.history.pushState({}, '', '/tecnicos');
      } else if (tab === 'history') {
        window.history.pushState({}, '', '/historico');
      }
    } catch {
      // Ignore in iframe / restricted environments
    }
  };

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(getInitialTab());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoadError('');
    try {
      const [statsRes, analyzersRes, apptsRes, catRes, techRes] = await Promise.all([
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions),
        safeFetchJson('/api/analyzers', noCacheFetchOptions),
        safeFetchJson('/api/appointments', noCacheFetchOptions),
        safeFetchJson('/api/categories', noCacheFetchOptions),
        safeFetchJson('/api/technicians', noCacheFetchOptions)
      ]);

      if (statsRes.success) {
        setStats(statsRes.stats);
        setRecentReservations(statsRes.recentReservations || []);
      }
      if (analyzersRes.success) setAnalyzers(analyzersRes.analyzers || []);
      if (apptsRes.success) setAppointments(apptsRes.appointments || []);
      if (catRes.success) setCategories(catRes.categories || []);
      if (techRes.success) setTechnicians(techRes.technicians || []);
    } catch (error) {
      console.error('Erro ao carregar dados da API:', error);
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLiveInventory = useCallback(async () => {
    try {
      const [statsRes, analyzersRes, appointmentsRes] = await Promise.all([
        safeFetchJson('/api/dashboard/stats', noCacheFetchOptions),
        safeFetchJson('/api/analyzers', noCacheFetchOptions),
        safeFetchJson('/api/appointments', noCacheFetchOptions)
      ]);
      if (statsRes.success) {
        setStats(statsRes.stats);
        setRecentReservations(statsRes.recentReservations || []);
      }
      if (analyzersRes.success) setAnalyzers(analyzersRes.analyzers || []);
      if (appointmentsRes.success) setAppointments(appointmentsRes.appointments || []);
    } catch (error) {
      console.warn('Atualização automática da agenda indisponível:', error);
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => void refreshLiveInventory(), 30_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshLiveInventory();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [refreshLiveInventory]);

  return (
    <div className="app-layout">
      <Navigation activeTab={activeTab} setActiveTab={handleTabChange} />
      <div className="app-content-wrapper">
        <main className="app-main">
          {loadError && (
            <div className="load-error" role="alert">
              <span>{loadError}</span>
              <button className="btn btn-secondary btn-sm" onClick={fetchAllData}>Tentar novamente</button>
            </div>
          )}

          {loading ? (
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
                <InventoryView analyzers={analyzers} onRefresh={fetchAllData} />
              )}
              {activeTab === 'appointments' && (
                <AppointmentsView appointments={appointments} onOpenChecklistModal={() => handleTabChange('operations')} />
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
                />
              )}
              {activeTab === 'history' && (
                <ReservationHistoryView
                  analyzers={analyzers}
                  technicians={technicians}
                  onRefresh={fetchAllData}
                />
              )}
            </>
          )}
        </main>

        <footer className="app-footer">
          ATEM Field © 2026 · Operações em campo e controle de patrimônio
        </footer>
      </div>
    </div>
  );
}

export default App;
