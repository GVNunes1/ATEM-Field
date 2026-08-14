import { useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
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
  UsersRound,
  Wrench
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
    fetch('/api/technicians', { cache: 'no-store' })
      .then(response => response.json())
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

  return (
    <div className="agenda-page animate-fade-in">
      <section className="glass-panel agenda-control-panel" aria-labelledby="agenda-title">
        <div className="agenda-control-panel__top">
          <div>
            <h2 id="agenda-title" className="agenda-title"><CalendarDays size={23} /> Agenda mensal</h2>
            <p>Atendimentos do Google Agenda agrupados por dia, com equipe, equipamentos e reservas.</p>
            <span className="agenda-result-summary">
              <strong>{filtered.length}</strong> atendimento(s) em <strong>{dateGroups.length}</strong> dia(s)
            </span>
          </div>

          <div className="agenda-month-navigation" aria-label="Navegação por mês">
            <button type="button" className="icon-button agenda-month-arrow" onClick={() => setSelectedMonth(moveMonth(selectedMonth, -1))} aria-label="Mês anterior">
              <ChevronLeft size={19} />
            </button>
            <label className="agenda-month-picker">
              <span>{monthLabel(selectedMonth)}</span>
              <input type="month" value={selectedMonth} onChange={event => event.target.value && setSelectedMonth(event.target.value)} aria-label="Selecionar mês" />
            </label>
            <button type="button" className="icon-button agenda-month-arrow" onClick={() => setSelectedMonth(moveMonth(selectedMonth, 1))} aria-label="Próximo mês">
              <ChevronRight size={19} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedMonth(monthKey(new Date()))}>Hoje</button>
          </div>
        </div>

        <div className="agenda-filters">
          <label className="agenda-search">
            <Search size={17} />
            <input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Buscar hospital, cidade ou técnico" />
          </label>
          <label className="filter-field">
            <span>Técnico</span>
            <select value={selectedTech} onChange={event => setSelectedTech(event.target.value)}>
              <option value="ALL">Todos os técnicos</option>
              {technicians.map(technician => <option key={technician.id} value={technician.name}>{technician.name}</option>)}
            </select>
          </label>
          <div className="agenda-filter-state">
            <SlidersHorizontal size={16} />
            <span>{activeFilters ? `${activeFilters} filtro(s) ativo(s)` : 'Sem filtros adicionais'}</span>
            {activeFilters > 0 && <button type="button" onClick={() => { setSearchTerm(''); setSelectedTech('ALL'); }}>Limpar</button>}
          </div>
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
                    const equipment = appointment.equipments?.[0];
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
                        {!isNonTech && equipment && (
                          <div className="agenda-appointment-card__equipment">
                            <div><Wrench size={15} /><span>{equipment.category_name || 'Equipamento'}</span><strong>{equipment.model}</strong></div>
                            <span className={reservationCount ? 'is-reserved' : ''}>{reservationCount} analisador(es) reservado(s)</span>
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
        <div className="agenda-empty-state">
          <CalendarDays size={30} /><h3>Nenhum atendimento neste mês</h3><p>Ajuste os filtros ou navegue para outro mês.</p>
        </div>
      )}
    </div>
  );
}
