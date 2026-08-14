import { useCallback, useEffect, useState } from 'react';
import { Calendar, Key, PackageCheck, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRefresh: () => Promise<void>;
  analyzerCount: number;
  lastUpdated: Date | null;
}

interface GoogleSyncStatus {
  authenticated: boolean;
  configured: boolean;
  requires_auth: boolean;
  automatic: boolean;
  running: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export function Header({ activeTab, setActiveTab, onRefresh, analyzerCount, lastUpdated }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleSyncStatus | null>(null);

  const currentDate = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  const loadGoogleStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/sync/google/status', { cache: 'no-store' });
      const data = await response.json();
      if (data.success) setGoogleStatus(data);
    } catch (error) {
      console.warn('Status do Google Agenda indisponível:', error);
    }
  }, []);

  useEffect(() => {
    void loadGoogleStatus();
    const interval = window.setInterval(() => void loadGoogleStatus(), 30_000);
    return () => window.clearInterval(interval);
  }, [loadGoogleStatus]);

  const handleSyncAgendaOnline = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/sync/agenda-online', { method: 'POST' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Falha na sincronização.');
      await onRefresh();
      await loadGoogleStatus();
      alert(`Agenda sincronizada: ${data.message}`);
    } catch (error) {
      await loadGoogleStatus();
      alert(`Erro ao sincronizar a agenda: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    try {
      const response = await fetch('/api/sync/get-google-auth-url', { method: 'POST' });
      const data = await response.json();
      if (!data.success || !data.auth_url) throw new Error(data.error || 'Link de acesso indisponível.');
      window.open(data.auth_url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => void loadGoogleStatus(), 8_000);
    } catch (error) {
      alert(`Erro no login Google: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    } finally {
      setLoggingIn(false);
    }
  };

  const requiresGoogleAccess = Boolean(googleStatus && (!googleStatus.authenticated || googleStatus.requires_auth));
  const statusText = !googleStatus
    ? 'Verificando Google Agenda'
    : googleStatus.running
      ? 'Google Agenda sincronizando'
      : requiresGoogleAccess
        ? 'Google Agenda requer acesso'
        : googleStatus.automatic
          ? 'Google Agenda automático'
          : 'Google Agenda conectado';

  return (
    <header className="app-header">
      <div className="app-header__top">
        <div className="brand-block">
          <div className="brand-logo">
            <img src="/logomarca.png" alt="ATEM Diagnóstico" onError={event => { event.currentTarget.style.display = 'none'; }} />
          </div>
          <div className="brand-copy">
            <div className="brand-title-row">
              <h1>ATEM Field <span>· Gestão de Campo</span></h1>
              <span className={`sync-badge${requiresGoogleAccess ? ' sync-badge--warning' : ''}${googleStatus?.running ? ' sync-badge--running' : ''}`} title={googleStatus?.lastError || undefined}>
                {requiresGoogleAccess ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} {statusText}
              </span>
            </div>
            <p>Engenharia clínica, equipe técnica e patrimônio em uma única operação.</p>
          </div>
        </div>
        <div className="current-date"><Calendar size={17} /><span>{currentDate}</span></div>
      </div>

      <div className="header-toolbar">
        <div className="toolbar-context" aria-live="polite">
          <span><strong>{analyzerCount.toLocaleString('pt-BR')}</strong> patrimônios</span>
          <span>Atualizado {lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora'}</span>
        </div>
        <div className="header-actions">
          {requiresGoogleAccess && (
            <button onClick={handleGoogleLogin} disabled={loggingIn} className="btn btn-secondary btn-sm btn-google">
              <Key size={16} /> {loggingIn ? 'Gerando acesso…' : 'Conectar Google'}
            </button>
          )}
          <button onClick={handleSyncAgendaOnline} disabled={syncing || googleStatus?.running} className="btn btn-primary btn-sm">
            <RefreshCw size={16} className={syncing || googleStatus?.running ? 'spin' : undefined} /> {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
          <button onClick={() => setActiveTab('operations')} className={`btn btn-sm ${activeTab === 'operations' ? 'btn-primary' : 'btn-soft'}`}>
            <PackageCheck size={16} /> Administrar reservas
          </button>
        </div>
      </div>
    </header>
  );
}
