import { useCallback, useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { safeFetchJson } from '../lib/api';
import { CalendarEventEditor, type CalendarAppointment, type CalendarTechnician } from '../components/CalendarEventEditor';
import { MonthlySpreadsheetView } from '../components/MonthlySpreadsheetView';
import { canAdvanceSchedule, canCreateSchedule, canManageSchedule } from '../lib/permissions';
import { appointmentStage } from '../lib/calendarMonth';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  LayoutGrid,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
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
  can_authorize_browser?: boolean;
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
  const target = new Date(year, month - 1 + offset, 1);
  return monthKey(target);
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
  const [todayRequest, setTodayRequest] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTech, setSelectedTech] = useState('ALL');
  const [technicians, setTechnicians] = useState<CalendarTechnician[]>([]);
  const [workflowActionId, setWorkflowActionId] = useState<number | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<CalendarAppointment | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [syncStatus, setSyncStatus] = useState<GoogleSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'spreadsheet' | 'cards'>(() => {
    try {
      return (localStorage.getItem('atem_agenda_view_mode') as 'spreadsheet' | 'cards') || 'spreadsheet';
    } catch {
      return 'spreadsheet';
    }
  });

  const changeViewMode = (mode: 'spreadsheet' | 'cards') => {
    setViewMode(mode);
    try {
      localStorage.setItem('atem_agenda_view_mode', mode);
    } catch {
      // ignore
    }
  };

  const isAdmin = currentUser?.role === 'admin';
  const canManage = canManageSchedule(currentUser?.role);
  const canCreate = canCreateSchedule(currentUser?.role);

  const handleDeleteAppointment = async (appointment: CalendarAppointment) => {
    const displayTitle = appointment.client_name || appointment.title || 'este atendimento';
    if (!window.confirm(`Deseja realmente excluir o agendamento "${displayTitle}"?\n\nEssa ação removerá o agendamento do sistema e do Google Agenda.`)) {
      return;
    }
    setDeletingId(Number(appointment.id));
    setActionError('');
    setNotice('');
    try {
      const result = await safeFetchJson(`/api/appointments/${appointment.id}`, { method: 'DELETE' });
      if (!result.success) throw new Error(result.error || 'Não foi possível excluir o agendamento.');
      setNotice(result.message || 'Agendamento excluído com sucesso.');
      await Promise.all([onRefresh?.(), loadSyncStatus()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Falha ao excluir agendamento.');
    } finally {
      setDeletingId(null);
    }
  };

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
    try {
      const result = await safeFetchJson('/api/sync/get-google-auth-url', { method: 'POST' });
      if (!result.success || !result.auth_url) throw new Error(result.error || 'Não foi possível abrir a autorização Google.');
      const url = new URL(result.auth_url);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') throw new Error('O endereço de autorização Google é inválido.');
      window.open(url.href, '_blank', 'noopener,noreferrer');
      setNotice('Conclua a autorização na janela do Google e depois clique em Sincronizar agora.');
    } catch (error) {
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

  const syncNeedsAttention = Boolean(syncStatus && (
    syncStatus.unavailable || !syncStatus.write_authorized || syncStatus.conflicts || syncStatus.errors
  ));
  const syncLabel = !syncStatus ? 'Verificando Google Agenda…'
    : syncStatus.unavailable ? 'Google: conexão indisponível'
    : !syncStatus.write_authorized ? 'Google: autorize a edição'
    : syncStatus.running || syncing ? 'Google: sincronizando…'
    : syncStatus.conflicts || syncStatus.errors ? 'Google: requer atenção'
    : 'Google Agenda · duas vias';

  return (
    <div className="agenda-page agenda-calendar-page field-dashboard">
      <header className="agenda-calendar-toolbar">
        <h1 aria-label="Agenda de atendimentos."><CalendarDays size={22} aria-hidden="true" />Agenda</h1>
        <nav className="agenda-calendar-nav" aria-label="Navegação por mês">
          <button
            type="button"
            className="btn btn-secondary btn-sm agenda-today-button"
            onClick={() => { setSelectedMonth(monthKey(new Date())); setTodayRequest(value => value + 1); }}
          >
            Hoje
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelectedMonth(moveMonth(selectedMonth, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSelectedMonth(moveMonth(selectedMonth, 1))}
            aria-label="Próximo mês"
          >
            <ChevronRight size={18} />
          </button>
          <label className="agenda-month-picker">
            <span aria-live="polite">{monthLabel(selectedMonth).replace(/^./, letter => letter.toLocaleUpperCase('pt-BR'))}</span>
            <ChevronDown size={15} aria-hidden="true" />
            <input
              type="month"
              value={selectedMonth}
              onChange={event => event.target.value && setSelectedMonth(event.target.value)}
              aria-label="Selecionar mês"
            />
          </label>
        </nav>
        <div className="agenda-calendar-toolbar__actions">
          <div className="agenda-view-selector" role="group" aria-label="Visualização da agenda">
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'spreadsheet' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeViewMode('spreadsheet')}
              aria-pressed={viewMode === 'spreadsheet'}
              title="Visualização em calendário mensal"
            >
              <CalendarDays size={15} /> Mês
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'cards' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              title="Visualização detalhada em cartões"
            >
              <LayoutGrid size={15} /> Cartões
            </button>
          </div>
          {canCreate && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setCreateDate(undefined); setIsCreating(true); }}
            >
              <Plus size={16} /> Novo Atendimento
            </button>
          )}
        </div>
      </header>

      <div className="agenda-calendar-overview">
        <section className="agenda-calendar-metrics" aria-label="Indicadores da agenda">
          <span><strong>{monthAppointments.length}</strong> no mês</span>
          <span><Clock3 size={14} aria-hidden="true" /><strong>{monthAppointments.filter(a => a.appointment_date === todayKey).length}</strong> hoje</span>
          <span><ClipboardCheck size={14} aria-hidden="true" /><strong>{monthAppointments.filter(a => (a.reservations?.length || 0) > 0).length}</strong> com padrões</span>
          <span><UsersRound size={14} aria-hidden="true" /><strong>{scheduledTechsCount}</strong> técnicos</span>
        </section>
        <details className={`agenda-calendar-sync${syncNeedsAttention ? ' agenda-calendar-sync--attention' : ''}`}>
          <summary>
            <ArrowLeftRight size={15} aria-hidden="true" />
            <span>{syncLabel}</span>
            {Boolean(syncStatus?.pending) && <span className="agenda-calendar-sync__count">{syncStatus?.pending} pendentes</span>}
            {Boolean(syncStatus?.conflicts) && <span className="agenda-calendar-sync__count">{syncStatus?.conflicts} para revisar</span>}
            {Boolean(syncStatus?.errors) && <span className="agenda-calendar-sync__count">{syncStatus?.errors} com falha</span>}
            <ChevronDown size={14} className="agenda-calendar-sync__chevron" aria-hidden="true" />
          </summary>
          <div className="agenda-calendar-sync__body">
            <p>{syncStatus?.unavailable ? 'Tente atualizar para consultar o estado da sincronização.' : syncStatus?.write_authorized ? 'Edições no ATEM e no Google são sincronizadas. Alterações simultâneas pedem revisão.' : syncStatus?.can_authorize_browser === false ? 'A credencial configurada é do tipo Desktop. Execute renovar-google-agenda.bat no computador do administrador, atualize GOOGLE_CALENDAR_TOKEN_JSON na Northflank e reinicie o serviço.' : syncStatus ? 'Autorize o acesso de edição para enviar alterações do ATEM Field ao Google.' : 'Consultando as permissões e as alterações pendentes.'}</p>
            {isAdmin && <div className="agenda-sync__actions">
              {syncStatus && !syncStatus.unavailable && !syncStatus.write_authorized && syncStatus.can_authorize_browser !== false && <button type="button" className="btn btn-secondary btn-sm" disabled={connecting} onClick={() => void connectGoogle()}>{connecting ? 'Abrindo Google…' : syncStatus.authenticated ? 'Autorizar edição' : 'Conectar Google'}</button>}
              <button type="button" className="btn btn-secondary btn-sm" disabled={syncing || syncStatus?.running} onClick={() => void synchronize()}><RefreshCw size={15} />{syncing || syncStatus?.running ? 'Sincronizando…' : 'Sincronizar agora'}</button>
            </div>}
          </div>
        </details>
      </div>
      {notice && <p className="calendar-notice" role="status"><CheckCircle2 size={18} />{notice}</p>}
      {actionError && <p className="calendar-notice calendar-notice--error" role="alert"><AlertCircle size={18} />{actionError}</p>}

      <section className="agenda-filters" aria-label="Filtros da agenda">
        <div className="agenda-filters__controls">
          <div className="agenda-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              className="input-field"
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Buscar cliente, local ou técnico"
              aria-label="Buscar atendimentos"
            />
          </div>

          <div>
            <select
              className="select-field"
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
              onClick={() => { setSearchTerm(''); setSelectedTech('ALL'); }}
            >
              Limpar
            </button>
          )}
        </div>
      </section>

      {viewMode === 'spreadsheet' ? (
        <MonthlySpreadsheetView
          key={`${selectedMonth}-${todayRequest}`}
          selectedMonth={selectedMonth}
          appointments={appointments}
          technicians={technicians}
          canManage={canManage}
          canCreate={canCreate}
          canAdvanceAppointment={appointment => canAdvanceSchedule(currentUser?.role, appointment.workflow_status || 'Data provisória') && Boolean(workflowNextStatus(appointment.workflow_status || 'Data provisória'))}
          onAdvanceAppointment={appointment => { void advanceWorkflow(appointment); }}
          workflowActionId={workflowActionId}
          isAdmin={isAdmin}
          searchTerm={searchTerm}
          selectedTech={selectedTech}
          deletingId={deletingId}
          onEditAppointment={appointment => setEditingAppointment(appointment)}
          onCreateAppointment={dateStr => { setCreateDate(dateStr); setIsCreating(true); }}
          onDeleteAppointment={handleDeleteAppointment}
          onOpenChecklistModal={onOpenChecklistModal}
        />
      ) : dateGroups.length ? (
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
                  {canCreate && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: '8px', padding: '3px 6px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px', width: '100%', justifyContent: 'center' }}
                      title={`Novo atendimento em ${day}`}
                      onClick={() => { setCreateDate(day); setIsCreating(true); }}
                    >
                      <Plus size={13} /> Novo
                    </button>
                  )}
                </header>

                <div className="agenda-day__appointments">
                  {dayAppointments.map(appointment => {
                    const technicianNames = String(appointment.technician_names || appointment.technician_name || 'Equipe de Campo');
                    const technicianList = technicianNames.split(',').map(name => name.trim()).filter(Boolean);
                    const displayTitle = appointment.client_name || appointment.title || 'Atendimento';
                    const hasSubtitle = appointment.title && appointment.title !== displayTitle;
                    const reservationCount = appointment.reservations?.length || 0;

                    const isNonTech = isNonTechnicalAppointment(appointment);
                    const workflowStatus = appointmentStage(appointment).full;
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
                          <div className="agenda-workflow-status" title="Etapa do fluxo de agendamento"><span>{workflowStatus}</span>{canAdvanceSchedule(currentUser?.role, workflowStatus) && nextStatus && <button type="button" className="btn btn-secondary btn-sm" disabled={workflowActionId === Number(appointment.id)} onClick={() => void advanceWorkflow(appointment)}><CheckCircle2 size={14} /> {workflowActionId === Number(appointment.id) ? 'Salvando…' : 'Avançar'}</button>}</div>
                          {isNonTech ? (
                            <span className="agenda-no-checklist badge">
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
                          {canManage && <div className="agenda-appointment-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              aria-label={`${eventSyncStatus === 'conflict' ? 'Revisar alterações de' : 'Editar atendimento de'} ${displayTitle}`}
                              onClick={() => setEditingAppointment(appointment)}
                            >
                              <Pencil size={14} />
                              {eventSyncStatus === 'conflict' ? 'Revisar alterações' : 'Editar atendimento'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm agenda-delete-button"
                              aria-label={`Excluir atendimento de ${displayTitle}`}
                              title={`Excluir atendimento de ${displayTitle}`}
                              disabled={deletingId === Number(appointment.id)}
                              onClick={() => void handleDeleteAppointment(appointment)}
                            >
                              <Trash2 size={14} />
                              {deletingId === Number(appointment.id) ? 'Excluindo…' : 'Excluir'}
                            </button>
                          </div>}
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
        <div className="field-empty field-surface agenda-empty-state--month">
          <CalendarDays size={36} />
          <h3>Nenhum atendimento neste mês</h3>
          <p>Ajuste os filtros ou selecione outro mês no controle de navegação.</p>
        </div>
      )}
      {(editingAppointment || isCreating) && (
        <CalendarEventEditor
          appointment={editingAppointment}
          initialDate={createDate}
          technicians={technicians}
          canManage={isCreating ? canCreate : canManage}
          canAssignTeam={canManage}
          onDismiss={() => { setEditingAppointment(null); setIsCreating(false); }}
          onSaved={async message => {
            setNotice(message);
            setActionError('');
            await Promise.all([onRefresh?.(), loadSyncStatus()]);
          }}
          onDeleted={async message => {
            setNotice(message);
            setActionError('');
            await Promise.all([onRefresh?.(), loadSyncStatus()]);
          }}
        />
      )}
    </div>
  );
}
