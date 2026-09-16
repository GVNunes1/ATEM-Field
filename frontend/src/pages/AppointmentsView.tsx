import { useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { safeFetchJson } from '../lib/api';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  MapPin,
  Search,
  SlidersHorizontal,
  UserRound,
  UsersRound
} from 'lucide-react';

interface AppointmentsViewProps {
  appointments: any[];
  onOpenChecklistModal: (apptId: number) => void;
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
export function AppointmentsView({ appointments, onOpenChecklistModal }: AppointmentsViewProps) {
  const today = new Date();
  const todayKey = dateKey(today);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(today));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTech, setSelectedTech] = useState('ALL');
  const [technicians, setTechnicians] = useState<any[]>([]);

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
    const groups = new Map<string, any[]>();
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

  return (
    <div className="agenda-page field-dashboard">
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Planejamento de Campo</span>
          <h1>Agenda de atendimentos.</h1>
          <p>Atendimentos do Google Agenda sincronizados por dia, com equipe, equipamentos e reservas vinculadas.</p>
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

      <section className="field-surface" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 260px) auto', gap: '12px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="search"
              className="input-field"
              style={{ paddingLeft: '36px', height: '40px', fontSize: '0.84rem' }}
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Buscar por hospital, cidade, título ou técnico..."
            />
          </div>

          <div>
            <select
              className="select-field"
              style={{ height: '40px', fontSize: '0.84rem' }}
              value={selectedTech}
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

                    return (
                      <div key={appointment.id} className="agenda-appointment-card">
                        <div className="agenda-appointment-card__time"><Clock3 size={16} /><time>{appointment.appointment_time || 'Dia inteiro'}</time></div>
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
    </div>
  );
}
