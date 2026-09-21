import { useCallback, useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { safeFetchJson } from '../lib/api';
import { CalendarEventEditor, type CalendarAppointment, type CalendarTechnician } from '../components/CalendarEventEditor';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  UserRound,
  UsersRound
} from 'lucide-react';

interface AppointmentsViewProps {
  appointments: CalendarAppointment[];
  onOpenChecklistModal: (apptId: number) => void;
  currentUser?: { role?: string } | null;
  onRefresh?: () => Promise<void>;
}

interface GoogleSyncStatus {
  unavailable?: boolean;
  authenticated?: boolean;
  write_authorized?: boolean;
  running?: boolean;
  pending?: number;
  conflicts?: number;
  errors?: number;
}

const pad = (value: number) => String(value).padStart(2, '0');
const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const dateKey = (date: Date) => `${monthKey(date)}-${pad(date.getDate())}`;
const safeDate = (value: string) => new Date(`${value}T12:00:00`);

function moveMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + offset, 1));
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}
export function AppointmentsView({ appointments, onOpenChecklistModal, currentUser, onRefresh }: AppointmentsViewProps) {
  const today = new Date();
  const todayKey = dateKey(today);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(today));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTech, setSelectedTech] = useState('ALL');
  const [technicians, setTechnicians] = useState<CalendarTechnician[]>([]);
  const [workflowActionId, setWorkflowActionId] = useState<number | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<CalendarAppointment | null>(null);
  const [syncStatus, setSyncStatus] = useState<GoogleSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const isAdmin = currentUser?.role === 'admin';

  const loadSyncStatus = useCallback(async () => {
    try {
      const result = await safeFetchJson('/api/sync/google/status', { cache: 'no-store' });
      if (result.success) setSyncStatus(result);
      else setSyncStatus({ unavailable: true });
    } catch { setSyncStatus({ unavailable: true }); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadSyncStatus(), 0);
    const timer = window.setInterval(() => void loadSyncStatus(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadSyncStatus]);

  const hasPendingSync = appointments.some(appointment => ['pending', 'error'].includes(appointment.google_sync_status));
  useEffect(() => {
    if (!hasPendingSync) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void Promise.all([onRefresh?.(), loadSyncStatus()]);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasPendingSync, onRefresh, loadSyncStatus]);

  const synchronize = async () => {
    setSyncing(true); setActionError(''); setNotice('');
    try {
      const result = await safeFetchJson('/api/sync/agenda-online', { method: 'POST' });
      if (!result.success) throw new Error(result.error || 'Não foi possível sincronizar a agenda.');
      await onRefresh?.();
      setNotice(result.message || 'Sincronização concluída. Confira os estados de cada atendimento.');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Falha na sincronização.');
    } finally { await loadSyncStatus(); setSyncing(false); }
  };

  const connectGoogle = async () => {
    setConnecting(true); setActionError('');
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      const result = await safeFetchJson('/api/sync/get-google-auth-url', { method: 'POST' });
      if (!result.success || !result.auth_url) throw new Error(result.error || 'Não foi possível abrir a autorização Google.');
      const url = new URL(result.auth_url);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('O endereço de autorização Google é inválido.');
      if (popup) popup.location.href = url.href;
      else throw new Error('Permita pop-ups neste site e tente conectar novamente.');
      setNotice('Conclua a autorização na janela do Google e depois clique em Sincronizar agora.');
    } catch (error) {
      popup?.close();
      setActionError(error instanceof Error ? error.message : 'Falha ao conectar ao Google.');
    } finally { setConnecting(false); }
  };

  useEffect(() => {
    safeFetchJson('/api/technicians', { cache: 'no-store' })
      .then(data => {
        if (data.success) {
          setTechnicians([...(data.technicians || [])].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')));
        }
      })
      .catch(error => console.error('Erro ao carregar técnicos:', error));
  }, []);

  const monthAppointments = useMemo(() => appointments.filter(appointment => (
    typeof appointment.appointment_date === 'string'
    && appointment.appointment_date.startsWith(selectedMonth)
    && String(appointment.status || '').toLocaleLowerCase('pt-BR') !== 'cancelado'
  )), [appointments, selectedMonth]);

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('pt-BR');
    return monthAppointments
      .filter(appointment => {
        const technicianNames = String(appointment.technician_names || appointment.technician_name || '');
        if (selectedTech !== 'ALL' && !technicianNames.toLocaleLowerCase('pt-BR').includes(selectedTech.toLocaleLowerCase('pt-BR'))) {
          return false;
        }
        if (!query) return true;
        return [appointment.client_name, appointment.title, appointment.client_address, technicianNames]
          .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
      })
      .sort((left, right) => (
        String(left.appointment_date).localeCompare(String(right.appointment_date))
        || String(left.appointment_time || '').localeCompare(String(right.appointment_time || ''))
        || String(left.client_name || left.title || '').localeCompare(String(right.client_name || right.title || ''), 'pt-BR')
      ));
  }, [monthAppointments, searchTerm, selectedTech]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, CalendarAppointment[]>();
    filtered.forEach(appointment => {
      const key = appointment.appointment_date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(appointment);
    });
    return [...groups.entries()];
  }, [filtered]);

  const activeFilters = Number(Boolean(searchTerm.trim())) + Number(selectedTech !== 'ALL');

  const scheduledTechsCount = useMemo(() => {
    const techSet = new Set<string>();
    monthAppointments.forEach(appt => {
      const names = String(appt.technician_names || appt.technician_name || '');
      names.split(',').map(n => n.trim()).filter(Boolean).forEach(n => techSet.add(n));
    });
    return techSet.size;
  }, [monthAppointments]);

  const workflowNextStatus = (status: string) => ({
    'Data provisória': 'Aguardando validação do supervisor',
    'Aguardando validação do supervisor': 'Validado pelo supervisor',
    'Validado pelo supervisor': 'Confirmado com cliente'
  } as Record<string, string>)[status];

  const advanceWorkflow = async (appointment: CalendarAppointment) => {
    const currentStatus = appointment.workflow_status || 'Data provisória';
    const nextStatus = workflowNextStatus(currentStatus);
    if (!nextStatus) return;
    setWorkflowActionId(Number(appointment.id));
    setActionError('');
    try {
      const result = await safeFetchJson(`/api/appointments/${appointment.id}/workflow`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow_status: nextStatus })
      });
      if (!result.success) throw new Error(result.error || 'Não foi possível avançar o workflow.');
      await onRefresh?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível avançar o workflow.');
    } finally { setWorkflowActionId(null); }
  };

  return (
    <div className="agenda-page field-dashboard">
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Planejamento de Campo</span>
          <h1>Agenda de atendimentos.</h1>
          <p>Atendimentos por dia, com equipe, equipamentos e reservas vinculadas.</p>
        </div>

        <div className="agenda-month-navigation" aria-label="Navegação por mês" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelectedMonth(moveMonth(selectedMonth, -1))}
            aria-label="Mês anterior"
            style={{ width: '38px', height: '38px', padding: 0, display: 'grid', placeItems: 'center' }}
          >
            <ChevronLeft size={18} />
          </button>
          <label className="agenda-month-picker" style={{ display: 'flex', alignItems: 'center', position: 'relative', cursor: 'pointer', padding: '0 14px', minHeight: '38px', border: '1px solid var(--border-color)', borderRadius: '8px', background: '#fff' }}>
            <span style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-main)', textTransform: 'capitalize' }}>{monthLabel(selectedMonth)}</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={event => event.target.value && setSelectedMonth(event.target.value)}
              aria-label="Selecionar mês"
              style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%', inset: 0, cursor: 'pointer' }}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelectedMonth(moveMonth(selectedMonth, 1))}
            aria-label="Próximo mês"
            style={{ width: '38px', height: '38px', padding: 0, display: 'grid', placeItems: 'center' }}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelectedMonth(monthKey(new Date()))}
            style={{ height: '38px', padding: '0 14px' }}
          >
            Hoje
          </button>
        </div>
      </header>

      <section className="agenda-sync" aria-label="Sincronização com o Google Agenda">
        <div className="agenda-sync__summary">
          <ArrowLeftRight size={20} aria-hidden="true" />
          <div><strong>{!syncStatus ? 'Verificando conexão com o Google…' : syncStatus.unavailable ? 'Status da conexão indisponível' : syncStatus.write_authorized ? 'Google Agenda em duas vias' : 'Google Agenda precisa de autorização'}</strong>
            <p>{syncStatus?.unavailable ? 'Tente atualizar para consultar o estado da sincronização.' : syncStatus?.write_authorized ? 'Edições no ATEM e no Google são sincronizadas. Alterações simultâneas pedem revisão.' : syncStatus ? 'Autorize o acesso de edição para enviar alterações do ATEM Field ao Google.' : 'Consultando as permissões e as alterações pendentes.'}</p>
            {syncStatus && !syncStatus.unavailable && <div className="agenda-sync__counts"><span>{Number(syncStatus.pending || 0)} pendentes</span><span>{Number(syncStatus.conflicts || 0)} para revisar</span><span>{Number(syncStatus.errors || 0)} com falha</span></div>}
          </div>
        </div>
        {isAdmin && <div className="agenda-sync__actions">
          {syncStatus && !syncStatus.unavailable && !syncStatus.write_authorized && <button type="button" className="btn btn-secondary" disabled={connecting} onClick={() => void connectGoogle()}>{connecting ? 'Abrindo Google…' : syncStatus.authenticated ? 'Autorizar edição' : 'Conectar Google'}</button>}
          <button type="button" className="btn btn-secondary" disabled={syncing || syncStatus?.running} onClick={() => void synchronize()}><RefreshCw size={16} />{syncing || syncStatus?.running ? 'Sincronizando…' : 'Sincronizar agora'}</button>
        </div>}
      </section>
      {notice && <p className="calendar-notice" role="status"><CheckCircle2 size={18} />{notice}</p>}
      {actionError && <p className="calendar-notice calendar-notice--error" role="alert"><AlertCircle size={18} />{actionError}</p>}

      <section className="field-metrics" aria-label="Indicadores da agenda">
        <div className="field-metric available">
          <span className="field-metric-label">
            Total no mês
            <CalendarDays size={17} aria-hidden="true" />
          </span>
          <strong>{monthAppointments.length}</strong>
          <span className="field-metric-detail">Em {dateGroups.length} dias programados</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Hoje
            <Clock3 size={17} aria-hidden="true" />
          </span>
          <strong>{monthAppointments.filter(a => a.appointment_date === todayKey).length}</strong>
          <span className="field-metric-detail">Atendimentos na data</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Com padrões
            <ClipboardCheck size={17} aria-hidden="true" />
          </span>
          <strong>{monthAppointments.filter(a => (a.reservations?.length || 0) > 0).length}</strong>
          <span className="field-metric-detail">Reservas vinculadas</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Técnicos escalados
            <UsersRound size={17} aria-hidden="true" />
          </span>
          <strong>{scheduledTechsCount}</strong>
          <span className="field-metric-detail">Profissionais em campo</span>
        </div>
      </section>

      <section className="field-surface agenda-filters">
        <div className="agenda-filters__controls">
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="search"
              className="input-field"
              style={{ paddingLeft: '36px', height: '40px', fontSize: '0.84rem' }}
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Buscar por hospital, cidade, título ou técnico..."
              aria-label="Buscar atendimentos"
            />
          </div>

          <div>
            <select
              className="select-field"
              style={{ height: '40px', fontSize: '0.84rem' }}
              value={selectedTech}
              aria-label="Filtrar por técnico"
              onChange={event => setSelectedTech(event.target.value)}
            >
              <option value="ALL">Todos os técnicos</option>
              {technicians.map(technician => <option key={technician.id} value={technician.name}>{technician.name}</option>)}
            </select>
          </div>

          {activeFilters > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ height: '40px' }}
              onClick={() => { setSearchTerm(''); setSelectedTech('ALL'); }}
            >
              Limpar
            </button>
          )}
        </div>
      </section>

      {dateGroups.length ? (
        <section className="agenda-month-list" aria-label={`Atendimentos de ${monthLabel(selectedMonth)}`}>
          {dateGroups.map(([day, dayAppointments]) => {
            const date = safeDate(day);
            const isToday = day === todayKey;
            const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');
            const shortMonth = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '');

            return (
              <article key={day} className={`agenda-day${isToday ? ' agenda-day--today' : ''}`}>
                <header className="agenda-day__date">
                  <strong>{pad(date.getDate())}</strong><span>{weekday}</span><small>{shortMonth}</small>
                  {isToday && <em>Hoje</em>}
                </header>

                <div className="agenda-day__appointments">
                  {dayAppointments.map(appointment => {
                    const technicianNames = String(appointment.technician_names || appointment.technician_name || 'Equipe de Campo');
                    const technicianList = technicianNames.split(',').map(name => name.trim()).filter(Boolean);
                    const displayTitle = appointment.client_name || appointment.title || 'Atendimento';
                    const hasSubtitle = appointment.title && appointment.title !== displayTitle;
                    const reservationCount = appointment.reservations?.length || 0;

                    const isNonTech = isNonTechnicalAppointment(appointment);
                    const workflowStatus = appointment.workflow_status || 'Data provisória';
                    const nextStatus = workflowNextStatus(workflowStatus);
                    const eventSyncStatus = appointment.google_sync_status || 'unlinked';
                    const eventSyncLabel = ({ synced: 'Sincronizado', pending: 'Envio pendente', error: 'Falha no envio', conflict: 'Revisar alterações', unlinked: 'Vínculo pendente' } as Record<string, string>)[eventSyncStatus] || 'Vínculo pendente';

                    return (
                      <div key={appointment.id} className="agenda-appointment-card">
                        <div className="agenda-appointment-card__time"><Clock3 size={16} /><time>{appointment.all_day ? 'Dia inteiro' : appointment.appointment_time || 'Dia inteiro'}</time></div>
                        <div className="agenda-appointment-card__main">
                          <div className="agenda-appointment-card__identity">
                            <h3>{displayTitle}</h3>
                            {hasSubtitle && <p>{appointment.title}</p>}
                            <div className="agenda-appointment-card__location"><MapPin size={15} /><span>{appointment.client_address || 'Endereço não informado'}</span></div>
                          </div>
                          <div className="agenda-appointment-card__team" aria-label="Equipe atribuída">
                            <div className="agenda-team-label"><UsersRound size={14} /> {technicianList.length > 1 ? `${technicianList.length} técnicos` : 'Técnico'}</div>
                            <div className="agenda-team-badges">
                              {technicianList.map(name => <span key={name}><UserRound size={12} /> {name}</span>)}
                            </div>
                          </div>
                          <div className="agenda-workflow-status" title="Etapa do fluxo de agendamento"><span>{workflowStatus}</span>{isAdmin && nextStatus && <button type="button" className="btn btn-secondary btn-sm" disabled={workflowActionId === Number(appointment.id)} onClick={() => void advanceWorkflow(appointment)}><CheckCircle2 size={14} /> {workflowActionId === Number(appointment.id) ? 'Salvando…' : 'Avançar'}</button>}</div>
                          {isNonTech ? (
                            <span className="badge" style={{ alignSelf: 'flex-start', padding: '0.4rem 0.75rem', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                              Não requer padrão
                            </span>
                          ) : (
                            <button type="button" onClick={() => onOpenChecklistModal(appointment.id)} className="btn btn-primary btn-sm agenda-checklist-button">
                              <ClipboardCheck size={15} /> Checklist e reserva <ChevronRight size={14} />
                            </button>
                          )}
                        </div>
                        <div className="agenda-appointment-card__sync">
                          <span className={`calendar-state calendar-state--${['synced', 'pending', 'error', 'conflict'].includes(eventSyncStatus) ? eventSyncStatus : 'unlinked'}`}><span aria-hidden="true" />{eventSyncLabel}</span>
                          {appointment.google_sync_error && <span className="agenda-appointment-card__sync-error">{appointment.google_sync_error}</span>}
                          {isAdmin && <button type="button" className="btn btn-secondary btn-sm" aria-label={`${eventSyncStatus === 'conflict' ? 'Revisar alterações de' : 'Editar atendimento de'} ${displayTitle}`} onClick={() => setEditingAppointment(appointment)}><Pencil size={14} />{eventSyncStatus === 'conflict' ? 'Revisar alterações' : 'Editar atendimento'}</button>}
                        </div>
                        {!isNonTech && (
                          <div className="agenda-appointment-card__equipment">
                            <span className={reservationCount ? 'is-reserved' : ''}>
                              {reservationCount} {reservationCount === 1 ? 'padrão reservado' : 'padrões reservados'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="field-empty field-surface" style={{ padding: '48px 24px' }}>
          <CalendarDays size={36} />
          <h3>Nenhum atendimento neste mês</h3>
          <p>Ajuste os filtros ou selecione outro mês no controle de navegação.</p>
        </div>
      )}
      {editingAppointment && <CalendarEventEditor appointment={editingAppointment} technicians={technicians} onDismiss={() => setEditingAppointment(null)} onSaved={async message => { setNotice(message); setActionError(''); await Promise.all([onRefresh?.(), loadSyncStatus()]); }} />}
    </div>
  );
}
