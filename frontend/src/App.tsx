import { useCallback, useEffect, useState } from 'react';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { DashboardView } from './pages/DashboardView';
import { InventoryView } from './pages/InventoryView';
import { AppointmentsView } from './pages/AppointmentsView';
import { ChecklistView } from './pages/ChecklistView';
import { TechniciansView } from './pages/TechniciansView';
import { OperationsAdminView } from './pages/OperationsAdminView';
import { ReservationHistoryView } from './pages/ReservationHistoryView';

const noCacheFetchOptions: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' }
};

export function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState<any>(null);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [analyzers, setAnalyzers] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAllData = useCallback(async () => {
    setLoadError('');
    try {
      const responses = await Promise.all([
        fetch('/api/dashboard/stats', noCacheFetchOptions),
        fetch('/api/analyzers', noCacheFetchOptions),
        fetch('/api/appointments', noCacheFetchOptions),
        fetch('/api/categories', noCacheFetchOptions),
        fetch('/api/technicians', noCacheFetchOptions)
      ]);

      if (responses.some(response => !response.ok)) {
        throw new Error('Uma ou mais fontes de dados não responderam corretamente.');
      }

      const [statsRes, analyzersRes, apptsRes, catRes, techRes] = await Promise.all(
        responses.map(response => response.json())
      );

      if (statsRes.success) {
        setStats(statsRes.stats);
        setRecentReservations(statsRes.recentReservations || []);
      }
      if (analyzersRes.success) setAnalyzers(analyzersRes.analyzers || []);
      if (apptsRes.success) setAppointments(apptsRes.appointments || []);
      if (catRes.success) setCategories(catRes.categories || []);
      if (techRes.success) setTechnicians(techRes.technicians || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Erro ao carregar dados da API:', error);
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLiveInventory = useCallback(async () => {
    try {
      const [statsResponse, analyzersResponse, appointmentsResponse] = await Promise.all([
        fetch('/api/dashboard/stats', noCacheFetchOptions),
        fetch('/api/analyzers', noCacheFetchOptions),
        fetch('/api/appointments', noCacheFetchOptions)
      ]);
      if (!statsResponse.ok || !analyzersResponse.ok || !appointmentsResponse.ok) throw new Error('Atualização automática indisponível.');

      const [statsRes, analyzersRes, appointmentsRes] = await Promise.all([
        statsResponse.json(),
        analyzersResponse.json(),
        appointmentsResponse.json()
      ]);
      if (statsRes.success) {
        setStats(statsRes.stats);
        setRecentReservations(statsRes.recentReservations || []);
      }
      if (analyzersRes.success) setAnalyzers(analyzersRes.analyzers || []);
      if (appointmentsRes.success) setAppointments(appointmentsRes.appointments || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.warn('Atualização automática do inventário falhou:', error);
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
    <div className="app-shell">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRefresh={fetchAllData}
        analyzerCount={analyzers.length}
        lastUpdated={lastUpdated}
      />
      <Navigation activeTab={activeTab} setActiveTab={setActiveTab} />

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
            {activeTab === 'dashboard' && <DashboardView stats={stats} recentReservations={recentReservations} onNavigate={setActiveTab} />}
            {activeTab === 'inventory' && <InventoryView analyzers={analyzers} onRefresh={fetchAllData} />}
            {activeTab === 'appointments' && <AppointmentsView appointments={appointments} onOpenChecklistModal={() => setActiveTab('operations')} />}
            {activeTab === 'checklist' && <ChecklistView categories={categories} onRefresh={fetchAllData} />}
            {activeTab === 'technicians' && <TechniciansView technicians={technicians} onRefresh={fetchAllData} />}
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
  );
}

export default App;
