import { useMemo, useState } from 'react';
import { CalendarDays, ClipboardCheck, Clock3, MapPin, Pencil, Plus, Printer, Trash2, UsersRound, X } from 'lucide-react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { appointmentStage, appointmentTeam, appointmentTime, appointmentTitle, dateKey, groupMonthAppointments, lastAppointmentDay, localDate, monthDays } from '../lib/calendarMonth';
import { ModalOverlay } from './ModalOverlay';
import type { CalendarAppointment, CalendarTechnician } from './CalendarEventEditor';
import './MonthlySpreadsheetView.css';

export interface MonthlySpreadsheetViewProps {
  selectedMonth: string;
  appointments: CalendarAppointment[];
  technicians: CalendarTechnician[];
  canManage: boolean;
  isAdmin: boolean;
  onEditAppointment: (appointment: CalendarAppointment) => void;
  onCreateAppointment: (dateStr: string) => void;
  onDeleteAppointment: (appointment: CalendarAppointment) => void;
  onOpenChecklistModal: (appointmentId: number) => void;
  deletingId?: number | null;
  searchTerm?: string;
  selectedTech?: string;
}

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fullDate = (value: string) => localDate(value).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (value: string) => localDate(value).toLocaleDateString('pt-BR');
const syncLabels: Record<string, string> = { synced: 'Sincronizado', pending: 'Envio pendente', conflict: 'Revisar alterações', error: 'Erro de sincronização', local_only: 'Somente no ATEM Field' };

function reservationDescription(value: unknown) {
  if (!value || typeof value !== 'object') return 'Reserva vinculada';
  const record = value as Record<string, unknown>;
  return [record.asset_tag, record.analyzer_name || record.analyzer_type, record.status].filter(item => typeof item === 'string' && item).join(' · ') || 'Reserva vinculada';
}

export function MonthlySpreadsheetView({ selectedMonth, appointments, technicians, canManage, onEditAppointment, onCreateAppointment, onDeleteAppointment, onOpenChecklistModal, deletingId, searchTerm = '', selectedTech = 'ALL' }: MonthlySpreadsheetViewProps) {
  const today = dateKey(new Date());
  const days = useMemo(() => monthDays(selectedMonth), [selectedMonth]);
  const grouped = useMemo(() => groupMonthAppointments(days, appointments, technicians, searchTerm, selectedTech), [days, appointments, technicians, searchTerm, selectedTech]);
  const [selectedDay, setSelectedDay] = useState(today.startsWith(selectedMonth) ? today : `${selectedMonth}-01`);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  const selectedAppointment = appointments.find(appointment => appointment.id === openId);
  const visibleLimit = compact ? 4 : 2;
  const hasMatches = days.some(day => day.startsWith(selectedMonth) && (grouped.get(day)?.length || 0) > 0);

  const selectDay = (day: string) => {
    setSelectedDay(day);
    if (!window.matchMedia('(max-width: 959px)').matches) setOpenDay(day);
  };
  const showAppointment = (appointment: CalendarAppointment) => setOpenId(appointment.id);
  const dismiss = () => { setOpenId(null); setOpenDay(null); };
  // Keep the detail layer mounted beneath the editor so closing it restores
  // keyboard focus to the originating action, including from a day dialog.
  const edit = (appointment: CalendarAppointment) => onEditAppointment(appointment);
  const create = (day: string) => { dismiss(); onCreateAppointment(day); };

  const dayAgenda = (day: string) => {
    const items = grouped.get(day) || [];
    return <section className="month-day-agenda" aria-label={`Atendimentos de ${fullDate(day)}`}>
      <div className="month-day-agenda__heading">
        <div><h3>{fullDate(day)}</h3><span>{items.length} {items.length === 1 ? 'atendimento' : 'atendimentos'}</span></div>
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => create(day)}><Plus size={16} /> Novo</button>}
      </div>
      {items.length ? <div className="month-day-agenda__list">{items.map(appointment => {
        const stage = appointmentStage(appointment);
        return <button type="button" key={appointment.id} className={`month-day-event month-tone--${stage.tone}`} onClick={() => showAppointment(appointment)}>
          <span className="month-day-event__time">{appointmentTime(appointment, day)}{!appointment.all_day && appointment.appointment_end_time && <small>até {appointment.appointment_end_time.slice(0, 5)}</small>}</span>
          <span className="month-day-event__body">
            <strong>{appointmentTitle(appointment)}</strong>
            {appointment.title && appointment.title !== appointmentTitle(appointment) && <span>{appointment.title}</span>}
            <span><UsersRound size={14} />{appointmentTeam(appointment, technicians) || 'Equipe a definir'}</span>
            <span><MapPin size={14} />{appointment.client_address || 'Local não informado'}</span>
            <span className="month-day-event__tags"><span className="month-status">{stage.label}</span><span>{appointment.reservations?.length || 0} reservas vinculadas</span></span>
          </span>
        </button>;
      })}</div> : <p className="month-empty">{searchTerm || selectedTech !== 'ALL' ? 'Nenhum atendimento para os filtros selecionados.' : 'Nenhum atendimento neste dia.'}</p>}
    </section>;
  };

  return <section className={`month-calendar monthly-spreadsheet-wrapper${compact ? ' month-calendar--compact' : ''}`} aria-label="Calendário mensal">
    <div className="month-calendar__options monthly-spreadsheet-toolbar">
      <div className="month-calendar__legend" aria-label="Legenda de etapas"><span className="month-tone--provisional"><i />Provisória / em validação</span><span className="month-tone--confirmed"><i />Validada / confirmada</span><span className="month-tone--running"><i />Em execução</span></div>
      <div className="month-calendar__tools"><label className="month-density"><input type="checkbox" checked={compact} onChange={event => setCompact(event.target.checked)} /> Compacta</label><button type="button" className="month-print" onClick={() => window.print()} aria-label="Imprimir agenda" title="Imprimir agenda"><Printer size={17} /></button></div>
    </div>
    {!hasMatches && <p className="month-filter-notice" role="status">{searchTerm || selectedTech !== 'ALL' ? 'Nenhum atendimento neste mês corresponde aos filtros.' : 'Este mês ainda não tem atendimentos.'}</p>}
    <div className="month-calendar__grid" aria-label={localDate(`${selectedMonth}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}>
      {weekdays.map(day => <div key={day} className="month-calendar__weekday">{day}</div>)}
      {days.map(day => {
        const items = grouped.get(day) || [];
        const outside = !day.startsWith(selectedMonth);
        const date = localDate(day);
        return <article key={day} data-date={day} className={`month-cell${outside ? ' month-cell--outside' : ''}${day === today ? ' month-cell--today' : ''}${day === selectedDay ? ' month-cell--selected' : ''}`} aria-label={fullDate(day)}>
          <div className="month-cell__heading">
            <button type="button" className="month-date" aria-label={`${fullDate(day)}, ${items.length} atendimentos`} aria-current={day === today ? 'date' : undefined} aria-pressed={day === selectedDay} onClick={() => selectDay(day)}><span>{date.getDate()}</span>{(date.getDate() === 1 || day === days[0]) && <small>{date.toLocaleDateString('pt-BR', { month: 'short' })}</small>}</button>
            {canManage && <button type="button" className="month-add day-add-btn" aria-label={`Novo atendimento em ${shortDate(day)}`} onClick={() => create(day)}><Plus size={14} /></button>}
          </div>
          <div className="month-cell__events">{items.slice(0, visibleLimit).map(appointment => {
            const stage = appointmentStage(appointment);
            const team = appointmentTeam(appointment, technicians) || 'Equipe a definir';
            const reservations = appointment.reservations?.length || 0;
            return <button type="button" key={appointment.id} className={`month-event month-tone--${stage.tone}${appointment.all_day ? ' month-event--all-day' : ''}`} onClick={() => showAppointment(appointment)} aria-label={`${appointmentTime(appointment, day)}, ${appointmentTitle(appointment)}, ${team}, ${stage.full}, ${reservations} reservas vinculadas`} title={`${appointmentTitle(appointment)}\n${team}\n${appointment.client_address || 'Local não informado'}\n${stage.full}`}>
              <span className="month-event__main"><time>{appointmentTime(appointment, day)}</time><strong>{appointmentTitle(appointment)}</strong></span>
              <span className="month-event__team"><UsersRound size={12} /><span>{team}</span></span>
              <span className="month-event__meta"><span>{stage.label}</span>{reservations > 0 && <span title={`${reservations} reservas vinculadas`}><ClipboardCheck size={12} />{reservations}</span>}{['error', 'conflict', 'pending'].includes(appointment.google_sync_status || '') && <span className="month-event__sync" title={syncLabels[appointment.google_sync_status || '']}>!</span>}</span>
            </button>;
          })}
          {items.length > visibleLimit && <button type="button" className="month-more" onClick={() => { setSelectedDay(day); setOpenDay(day); }} aria-label={`Ver mais ${items.length - visibleLimit} atendimentos de ${fullDate(day)}`}>Mais {items.length - visibleLimit}</button>}
          </div>
          <span className="month-mobile-count" aria-hidden="true">{items.length ? `${items.length} ag.` : 'Livre'}</span>
        </article>;
      })}
    </div>
    <div className="month-calendar__mobile-agenda">{dayAgenda(selectedDay)}</div>
    {openDay && <ModalOverlay className="month-overlay" onDismiss={dismiss} onClick={event => { if (event.target === event.currentTarget) dismiss(); }}><div role="dialog" aria-modal="true" aria-label={`Agenda de ${fullDate(openDay)}`} className="month-dialog"><button type="button" className="month-dialog__close" onClick={dismiss} aria-label="Fechar agenda do dia"><X size={20} /></button>{dayAgenda(openDay)}</div></ModalOverlay>}
    {selectedAppointment && <ModalOverlay className="month-overlay" onDismiss={() => setOpenId(null)} onClick={event => { if (event.target === event.currentTarget) setOpenId(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="month-event-title" className={`month-dialog month-event-detail month-tone--${appointmentStage(selectedAppointment).tone}`}>
        <header><span className="month-status">{appointmentStage(selectedAppointment).label}</span><button type="button" className="month-dialog__close" onClick={() => setOpenId(null)} aria-label="Fechar detalhes do atendimento"><X size={20} /></button><h2 id="month-event-title">{appointmentTitle(selectedAppointment)}</h2>{selectedAppointment.title && selectedAppointment.title !== appointmentTitle(selectedAppointment) && <p>{selectedAppointment.title}</p>}</header>
        <dl className="month-event-detail__fields">
          <div><dt><CalendarDays size={17} /> Data</dt><dd>{shortDate(selectedAppointment.appointment_date.slice(0, 10))}{lastAppointmentDay(selectedAppointment) !== selectedAppointment.appointment_date.slice(0, 10) && ` a ${shortDate(lastAppointmentDay(selectedAppointment))}`}</dd></div>
          <div><dt><Clock3 size={17} /> Horário</dt><dd>{appointmentTime(selectedAppointment)}{!selectedAppointment.all_day && selectedAppointment.appointment_end_time && ` até ${selectedAppointment.appointment_end_time.slice(0, 5)}${selectedAppointment.appointment_end_date && selectedAppointment.appointment_end_date !== selectedAppointment.appointment_date ? ` de ${shortDate(selectedAppointment.appointment_end_date.slice(0, 10))}` : ''}`}</dd></div>
          <div><dt><UsersRound size={17} /> Equipe</dt><dd>{appointmentTeam(selectedAppointment, technicians) || 'Equipe a definir'}</dd></div>
          <div><dt><MapPin size={17} /> Local</dt><dd>{selectedAppointment.client_address || 'Local não informado'}</dd></div>
          <div><dt>Etapa do agendamento</dt><dd>{appointmentStage(selectedAppointment).full}</dd></div>
          <div><dt>Google Agenda</dt><dd>{syncLabels[selectedAppointment.google_sync_status || ''] || (selectedAppointment.google_event_id ? 'Evento vinculado' : 'Sem vínculo com o Google')}{selectedAppointment.google_sync_error && <span className="month-sync-error">{selectedAppointment.google_sync_error}</span>}</dd></div>
        </dl>
        <section className="month-event-detail__reservations"><h3><ClipboardCheck size={17} /> Padrões e analisadores</h3>{selectedAppointment.reservations?.length ? <><p>{selectedAppointment.reservations.length} reservas vinculadas, incluindo histórico.</p><ul>{selectedAppointment.reservations.map((reservation, index) => <li key={index}>{reservationDescription(reservation)}</li>)}</ul></> : <p>Nenhuma reserva vinculada.</p>}</section>
        <footer className="month-dialog__actions">
          {!isNonTechnicalAppointment(selectedAppointment) && <button type="button" className="btn btn-primary" onClick={() => { dismiss(); onOpenChecklistModal(selectedAppointment.id); }}><ClipboardCheck size={16} /> Checklist e reservas</button>}
          {canManage && <button type="button" className="btn btn-secondary" onClick={() => edit(selectedAppointment)}><Pencil size={16} />{selectedAppointment.google_sync_status === 'conflict' ? 'Revisar alterações' : 'Editar'}</button>}
          {canManage && <button type="button" className="btn btn-secondary month-delete" disabled={deletingId === Number(selectedAppointment.id)} onClick={() => { dismiss(); onDeleteAppointment(selectedAppointment); }}><Trash2 size={16} />{deletingId === Number(selectedAppointment.id) ? 'Excluindo…' : 'Excluir'}</button>}
        </footer>
      </section>
    </ModalOverlay>}
  </section>;
}
