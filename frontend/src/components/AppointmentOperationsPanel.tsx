import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import type { AppointmentReadiness } from '../lib/operationalInsights';
import './AppointmentOperationsPanel.css';

interface TimelineEvent {
  id: number;
  event_type: string;
  actor_name: string;
  occurred_at: string;
  details: Record<string, unknown>;
}

const eventNames: Record<string, string> = {
  created: 'Atendimento criado',
  workflow: 'Etapa ou responsável alterado',
  vehicle: 'Carro da agenda alterado',
  google_update: 'Agenda atualizada no Google',
  calendar_edit: 'Agenda editada no ATEM',
  pattern_reserved: 'Padrão reservado',
  pattern_checkout: 'Padrão retirado',
  pattern_return: 'Padrão devolvido',
  pattern_status: 'Reserva atualizada',
  vehicle_checkout: 'Carro retirado',
  vehicle_return: 'Carro devolvido'
};

function eventDetail(event: TimelineEvent): string {
  const details = event.details || {};
  if (event.event_type === 'workflow') {
    return [[details.from, details.to].filter(Boolean).join(' → '),
      details.assignee_name ? `Responsável: ${details.assignee_name}` : ''].filter(Boolean).join(' · ');
  }
  if (event.event_type === 'pattern_reserved' || event.event_type === 'pattern_checkout' || event.event_type === 'pattern_return') {
    return String(details.analyzer_name || (details.analyzer_id ? `Padrão #${details.analyzer_id}` : ''));
  }
  if (event.event_type === 'vehicle' || event.event_type === 'vehicle_checkout' || event.event_type === 'vehicle_return') {
    return String(details.vehicle_name || (details.to_vehicle_id || details.vehicle_id ? `Carro #${details.to_vehicle_id || details.vehicle_id}` : 'Reserva removida'));
  }
  if (event.event_type === 'calendar_edit') {
    const labels: Record<string, string> = { summary: 'título e equipe', location: 'local', start: 'data/horário', end: 'término', description: 'descrição' };
    const fields = Array.isArray(details.fields) ? details.fields.map(field => labels[String(field)] || String(field)) : [];
    return fields.length ? `Campos: ${fields.join(', ')}` : '';
  }
  if (event.event_type === 'google_update') {
    const before = details.before as Record<string, unknown> | undefined;
    const after = details.after as Record<string, unknown> | undefined;
    if (!before || !after) return '';
    const labels: Record<string, string> = { title: 'título', date: 'data', time: 'horário', team: 'equipe' };
    return Object.entries(labels).filter(([key]) => before[key] !== after[key]).map(([, label]) => label).join(', ');
  }
  if (event.event_type === 'created') return String(details.title || '');
  return '';
}

export function AppointmentOperationsPanel({ appointmentId, readiness }: { appointmentId: number; readiness?: AppointmentReadiness }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [resolvedReadiness, setResolvedReadiness] = useState<AppointmentReadiness | null>(readiness || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const currentReadiness = readiness || resolvedReadiness;
  useEffect(() => {
    let alive = true;
    Promise.all([
      safeFetchJson(`/api/appointments/${appointmentId}/timeline`, { cache: 'no-store' }),
      safeFetchJson(`/api/appointments/${appointmentId}/readiness`, { cache: 'no-store' }).catch(() => ({ success: false }))
    ]).then(([result, readinessResult]) => {
        if (!alive) return;
        if (!result.success) throw new Error(result.error || 'Não foi possível carregar o histórico.');
        setEvents(result.events || []);
        if (readinessResult.success) setResolvedReadiness(readinessResult.readiness || null);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o histórico.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [appointmentId, attempt]);

  return <div className="appointment-operations">
    {currentReadiness && <section aria-labelledby="appointment-readiness-title">
      <div className="appointment-operations__heading">
        <h3 id="appointment-readiness-title">Pronto para sair</h3>
        <span className={`appointment-operations__state appointment-operations__state--${currentReadiness.state}`}>
          {currentReadiness.state === 'ready' ? 'Pronto' : currentReadiness.state === 'planning' ? 'Em planejamento' : 'Atenção'}
        </span>
      </div>
      <ul className="appointment-operations__checks">{currentReadiness.checks.map(check => <li key={check.key} className={check.ok ? '' : 'is-missing'}>
        {check.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
        <span><strong>{check.label}</strong><small>{check.detail}</small></span>
      </li>)}</ul>
    </section>}
    <section aria-labelledby="appointment-timeline-title">
      <div className="appointment-operations__heading"><h3 id="appointment-timeline-title">Linha do tempo</h3></div>
      {loading ? <p role="status">Carregando histórico…</p>
        : error ? <div className="appointment-operations__error" role="alert"><span>{error}</span><button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}><RefreshCw size={14} />Tentar novamente</button></div>
          : events.length ? <ol className="appointment-operations__timeline">{events.map(event => <li key={event.id}>
            <Clock3 size={15} aria-hidden="true" />
            <div><strong>{eventNames[event.event_type] || 'Alteração registrada'}</strong><span>{eventDetail(event)}</span><small>{event.actor_name} · {new Date(event.occurred_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></div>
          </li>)}</ol> : <p>As próximas alterações deste atendimento aparecerão aqui.</p>}
    </section>
  </div>;
}
