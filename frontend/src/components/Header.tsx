import { useCallback, useEffect, useState } from 'react';
import { Calendar, Key, PackageCheck, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { safeFetchJson } from '../lib/api';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRefresh: () => Promise<void>;
  analyzerCount: number;
  lastUpdated: Date | null;
}

export function Header({ activeTab, setActiveTab, onRefresh, analyzerCount, lastUpdated }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{
    authenticated?: boolean;
    configured?: boolean;
    requires_auth?: boolean;
    automatic?: boolean;
    running?: boolean;
    lastSuccessAt?: string | null;
    lastError?: string | null;
  } | null>(null);

  const currentDate = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  const loadGoogleStatus = useCallback(async () => {
    try {
      const data = await safeFetchJson('/api/sync/google/status', { cache: 'no-store' });
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
      const data = await safeFetchJson('/api/sync/agenda-online', { method: 'POST' });
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
      const data = await safeFetchJson('/api/sync/get-google-auth-url', { method: 'POST' });
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
    ? 'Verificando Agenda'
    : googleStatus.running
      ? 'Sincronizando…'
      : requiresGoogleAccess
        ? 'Requer Acesso Google'
        : googleStatus.automatic
          ? 'Agenda Automática'
          : 'Google Agenda Conectado';

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <div className="topbar-context-tag">
          <strong>ATEM Field</strong>
          <span>· Assistência Técnica</span>
        </div>
        <span
          className={`sync-badge${requiresGoogleAccess ? ' sync-badge--warning' : ''}${googleStatus?.running ? ' sync-badge--running' : ''}`}
          title={googleStatus?.lastError || undefined}
        >
          {requiresGoogleAccess ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />} {statusText}
        </span>
      </div>

      <div className="topbar-right">
        <div className="topbar-meta">
          <span className="current-date">
            <Calendar size={14} />
            <span>{currentDate}</span>
          </span>
          <span className="meta-divider" />
          <span className="meta-stats">
            <strong>{analyzerCount.toLocaleString('pt-BR')}</strong> patrimônios
          </span>
        </div>

        <div className="topbar-actions">
          {requiresGoogleAccess && (
            <button onClick={handleGoogleLogin} disabled={loggingIn} className="btn btn-secondary btn-sm btn-google">
              <Key size={14} /> {loggingIn ? 'Gerando…' : 'Conectar Google'}
            </button>
          )}
          <button
            onClick={handleSyncAgendaOnline}
            disabled={syncing || googleStatus?.running}
            className="btn btn-primary btn-sm"
          >
            <RefreshCw size={14} className={syncing || googleStatus?.running ? 'spin' : undefined} />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          <button
            onClick={() => setActiveTab('operations')}
            className={`btn btn-sm ${activeTab === 'operations' ? 'btn-primary' : 'btn-soft'}`}
          >
            <PackageCheck size={14} /> Reservas
          </button>
        </div>
      </div>
    </header>
  );
}
