import { AlertCircle, ArrowDownLeft, ArrowRight, ArrowUpRight, Box, CalendarDays, CheckCircle2, Clock3, MapPin, PackageCheck, RefreshCw } from 'lucide-react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import type { OperationalInsights } from '../lib/operationalInsights';
import './OperationalOverview.css';

interface DashboardStats {
  availableAnalyzers: number;
  totalAnalyzers: number;
  reservedAnalyzers: number;
  inUseAnalyzers: number;
  todayAppointments: number;
}
interface DashboardAppointment {
  id: number;
  appointment_date: string;
  appointment_time?: string;
  client_name?: string;
  title?: string;
  client_address?: string;
  technician_names?: string;
  technician_name?: string;
  status?: string;
}
interface RecentReservation {
  id: number | string;
  asset_tag?: string;
  analyzer_name?: string;
  technician_name?: string;
  client_name?: string;
  status?: string;
}
interface DashboardViewProps {
  stats: DashboardStats | null;
  recentReservations: RecentReservation[];
  appointments: DashboardAppointment[];
  insights: OperationalInsights;
  onOpenOperationalAppointment: (id: number) => void;
  onNavigate: (tab: string) => void;
  onOpenReservation: (id: number) => void;
  onRetry: () => void;
}
const number = (value: number) => Number(value || 0).toLocaleString('pt-BR');

export function DashboardView({ stats, recentReservations, appointments, insights, onOpenOperationalAppointment, onNavigate, onOpenReservation, onRetry }: DashboardViewProps) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todaysAppointments = appointments.filter(item => item.appointment_date === today && item.status?.toLocaleLowerCase('pt-BR') !== 'cancelado')
    .sort((a, b) => (a.appointment_time || '').localeCompare(b.appointment_time || ''));
  const available = Math.max(0, Number(stats?.availableAnalyzers || 0));
  const total = Math.max(0, Number(stats?.totalAnalyzers || 0));
  const availability = total ? Math.min(100, Math.round(available / total * 100)) : 0;
  const readiness = insights.readiness.filter(item => item.state !== 'planning');
  const readyCount = readiness.filter(item => item.state === 'ready').length;
  const alertGroups = [...insights.alerts.reduce((groups, alert) => {
    const current = groups.get(alert.appointment_id);
    if (current) current.messages.push(alert.message);
    else groups.set(alert.appointment_id, { appointment_id: alert.appointment_id, severity: alert.severity, messages: [alert.message] });
    return groups;
  }, new Map<number, { appointment_id: number; severity: 'warning' | 'critical'; messages: string[] }>()).values()];
  const alerts = alertGroups.slice(0, 6);
  const appointmentById = new Map(appointments.map(item => [item.id, item]));

  return (
    <div className="field-dashboard">
      <header className="field-page-heading">
        <div><span className="field-overline">Visão operacional</span><h1>Seu dia em campo.</h1><p>Agenda, equipe e padrões. Tudo pronto para o próximo atendimento.</p></div>
        <button onClick={() => onNavigate('operations')} className="btn btn-primary"><PackageCheck size={17} /> Administrar reservas <ArrowUpRight size={16} /></button>
      </header>
      {!stats ? (
        <section className="field-unavailable" role="status"><Box size={28} /><h2>Indicadores indisponíveis</h2><p>Atualize os dados para consultar a situação dos padrões.</p><button className="btn btn-secondary" onClick={onRetry}><RefreshCw size={16} /> Tentar novamente</button></section>
      ) : (
        <section className="field-metrics" aria-label="Indicadores da operação">
          {[
            { label: 'Padrões disponíveis', value: available, detail: `de ${number(total)} cadastrados`, icon: CheckCircle2, destination: 'inventory', tone: 'available' },
            { label: 'Reservados', value: stats.reservedAnalyzers, detail: 'Separados para atendimento', icon: PackageCheck, destination: 'operations', tone: '' },
            { label: 'Em campo', value: stats.inUseAnalyzers, detail: 'Em uso pela equipe técnica', icon: Box, destination: 'inventory', tone: '' },
            { label: 'Atendimentos hoje', value: stats.todayAppointments, detail: 'Horários e responsáveis', icon: CalendarDays, destination: 'appointments', tone: '' }
          ].map(metric => <button className={`field-metric ${metric.tone}`} key={metric.label} onClick={() => onNavigate(metric.destination)}><span className="field-metric-label">{metric.label}<metric.icon size={17} aria-hidden="true" /></span><strong>{number(metric.value)}</strong><span className="field-metric-detail">{metric.detail}<ArrowUpRight size={14} aria-hidden="true" /></span></button>)}
        </section>
      )}
      <section className="operational-overview field-surface" aria-labelledby="operational-overview-title">
        <div className="operational-overview__heading"><div><span className="field-overline">Próximos 14 dias</span><h2 id="operational-overview-title">Prontidão e exceções</h2><p>{insights.available ? `${readyCount} de ${readiness.length} atendimentos confirmados prontos para sair.` : 'Aguardando dados operacionais.'}</p></div><button className="field-text-button" onClick={() => onNavigate('appointments')}>Abrir agenda <ArrowRight size={16} /></button></div>
        {!insights.available ? <p className="operational-overview__empty" role="status">Prontidão indisponível no momento. Atualize os dados para tentar novamente.</p> : alerts.length ? <ul className="operational-overview__alerts">{alerts.map(alert => {
          const appointment = appointmentById.get(alert.appointment_id);
          return <li key={alert.appointment_id}><button type="button" onClick={() => onOpenOperationalAppointment(alert.appointment_id)}>
            <AlertCircle size={17} aria-hidden="true" /><span><strong>{appointment?.client_name || appointment?.title || 'Atendimento'} · {alert.messages[0]}{alert.messages.length > 1 ? ` e mais ${alert.messages.length - 1} pendência(s)` : ''}</strong><small>{appointment?.appointment_date ? new Date(`${appointment.appointment_date}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem data'} · {alert.severity === 'critical' ? 'Ação prioritária' : 'Acompanhar'}</small></span><ArrowUpRight size={15} aria-hidden="true" />
          </button></li>;
        })}</ul> : <p className="operational-overview__empty"><CheckCircle2 size={17} /> Nenhuma exceção identificada no período.</p>}
        {alertGroups.length > alerts.length && <p className="operational-overview__more">Mais {alertGroups.length - alerts.length} atendimento(s) com alertas; consulte a Agenda.</p>}
      </section>
      <div className="field-overview-grid">
        <section className="field-agenda field-surface" aria-labelledby="daily-agenda-title">
          <header className="field-section-heading"><div><h2 id="daily-agenda-title">Agenda de hoje <span className="field-count">{todaysAppointments.length}</span></h2><p>{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><button className="field-text-button" onClick={() => onNavigate('appointments')}>Ver agenda <ArrowRight size={16} /></button></header>
          {todaysAppointments.length ? <div className="field-visit-list">{todaysAppointments.slice(0, 5).map(visit => (
            <article className="field-visit" key={visit.id}>
              <time className="field-visit-time"><Clock3 size={14} />{visit.appointment_time?.slice(0, 5) || 'A definir'}</time>
              <div className="field-visit-info"><h3>{visit.client_name || visit.title || 'Atendimento'}</h3><p><MapPin size={13} />{visit.client_address || 'Endereço não informado'}</p><span>{visit.technician_names || visit.technician_name || 'Equipe a definir'}</span></div>
              {isNonTechnicalAppointment(visit) ? <span className="field-visit-note">Sem padrão</span> : <button className="field-visit-action" onClick={() => onOpenReservation(visit.id)} aria-label={`Abrir reserva de ${visit.client_name || visit.title || 'atendimento'}`}><ArrowUpRight size={19} /></button>}
            </article>
          ))}</div> : <div className="field-empty"><CalendarDays size={30} /><h3>Agenda livre por aqui</h3><p>Nenhum atendimento encontrado para hoje. Consulte a agenda para planejar os próximos dias.</p><button className="field-text-button" onClick={() => onNavigate('appointments')}>Consultar agenda <ArrowRight size={16} /></button></div>}
          {todaysAppointments.length > 5 && <button className="field-list-more" onClick={() => onNavigate('appointments')}>Ver mais {todaysAppointments.length - 5} atendimento(s)<ArrowRight size={15} /></button>}
        </section>
        <aside className="field-readiness field-surface" aria-labelledby="readiness-title">
          <span className="field-overline">Patrimônio</span><h2 id="readiness-title">Prontos para sair.</h2><p>Disponibilidade dos padrões para a próxima operação.</p>
          <div className="field-readiness-number"><strong>{stats ? `${availability}%` : 'N/D'}</strong><span>do acervo disponível</span></div>
          <meter className="field-capacity" min={0} max={100} value={availability} aria-label="Percentual de padrões disponíveis" />
          <dl className="field-availability-list"><div><dt>Disponíveis</dt><dd>{stats ? number(available) : 'N/D'}</dd></div><div><dt>Reservados</dt><dd>{stats ? number(stats.reservedAnalyzers) : 'N/D'}</dd></div><div><dt>Em uso</dt><dd>{stats ? number(stats.inUseAnalyzers) : 'N/D'}</dd></div></dl>
          <button className="btn btn-secondary" onClick={() => onNavigate('inventory')}>Consultar padrões <ArrowUpRight size={16} /></button>
        </aside>
      </div>
      <section className="field-surface field-recent" aria-labelledby="recent-title">
        <header className="field-section-heading"><div><h2 id="recent-title">Últimas reservas</h2><p>Movimentações recentes dos padrões da equipe.</p></div><button className="field-text-button" onClick={() => onNavigate('history')}>Histórico completo <ArrowRight size={16} /></button></header>
        {recentReservations.length ? <div className="field-table-scroll"><table className="field-table"><thead><tr><th scope="col">Padrão / patrimônio</th><th scope="col">Responsável</th><th scope="col">Cliente</th><th scope="col">Situação</th></tr></thead><tbody>{recentReservations.slice(0, 6).map(reservation => <tr key={reservation.id}><td><div className="field-asset"><span className="field-asset-icon"><ArrowDownLeft size={18} /></span><div><strong>{reservation.analyzer_name || 'Padrão'}</strong><code>{reservation.asset_tag || 'Sem patrimônio'}</code></div></div></td><td>{reservation.technician_name || 'Não informado'}</td><td>{reservation.client_name || 'Não informado'}</td><td><span className={`badge ${reservation.status === 'Em Uso' ? 'badge-warning' : reservation.status === 'Reservado' ? 'badge-info' : 'badge-success'}`}>{reservation.status || 'Não informada'}</span></td></tr>)}</tbody></table></div> : <div className="field-empty field-empty--compact"><PackageCheck size={25} /><div><h3>Nenhuma reserva recente</h3><p>As movimentações aparecerão aqui após a primeira reserva.</p></div></div>}
      </section>
    </div>
  );
}
