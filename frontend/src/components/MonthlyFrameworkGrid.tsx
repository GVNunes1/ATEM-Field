import { useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import themePlugin from '@fullcalendar/react/themes/monarch';
import ptBr from '@fullcalendar/react/locales/pt-br';
import { ClipboardCheck, Plus, UsersRound } from 'lucide-react';
import { appointmentStage, appointmentTeam, appointmentTime, appointmentTitle, dateKey, shiftDate } from '../lib/calendarMonth';
import type { CalendarAppointment, CalendarTechnician } from './CalendarEventEditor';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/monarch/theme.css';
import '@fullcalendar/react/themes/monarch/palettes/blue.css';
import './MonthlyFrameworkGrid.css';

interface Props {
  month: string;
  grouped: Map<string, CalendarAppointment[]>;
  technicians: CalendarTechnician[];
  compact: boolean;
  canCreate: boolean;
  onDay: (day: string) => void;
  onEvent: (appointment: CalendarAppointment) => void;
  onCreate: (day: string) => void;
}

export function MonthlyFrameworkGrid({ month, grouped, technicians, compact, canCreate, onDay, onEvent, onCreate }: Props) {
  // Daily segments retain the ATEM appointment identity while exposing every
  // day of a multi-day visit. They never mutate the Google event payload.
  const events = useMemo(() => [...grouped].flatMap(([day, appointments]) => appointments.map(appointment => ({
    id: `${appointment.id}-${day}`, title: appointmentTitle(appointment),
    start: appointment.all_day ? day : `${day}T${appointment.appointment_time?.slice(0, 5) || '00:00'}:00`,
    end: appointment.all_day ? shiftDate(day, 1) : undefined,
    allDay: Boolean(appointment.all_day), extendedProps: { appointment, day },
  }))), [grouped]);

  return <div className="atem-fullcalendar" aria-label="Calendário mensal" onClickCapture={event => {
    const link = (event.target as HTMLElement).closest('.framework-more');
    const day = link?.closest('[data-date]')?.getAttribute('data-date');
    if (day) { event.preventDefault(); event.stopPropagation(); onDay(day); }
  }}>
    <FullCalendar
      plugins={[dayGridPlugin, themePlugin]}
      initialView="dayGridMonth" initialDate={`${month}-01`} locale={ptBr} firstDay={0}
      headerToolbar={false} fixedWeekCount={false} showNonCurrentDates expandRows
      height="auto" events={events} editable={false} eventInteractive
      dayMaxEvents={compact ? 7 : 5} eventDisplay="block" displayEventTime={false}
      eventOrder="start,title" eventOrderStrict
      dayHeaderContent={info => <span className="framework-weekday">{info.weekdayText.replace('.', '')}</span>}
      dayCellClass="framework-day"
      dayCellDidMount={info => { info.el.dataset.date = dateKey(info.date); }}
      dayCellTopContent={info => {
        const day = dateKey(info.date);
        return <div className="framework-day-heading"><button type="button" className="framework-date" aria-current={info.isToday ? 'date' : undefined} onClick={() => onDay(day)} aria-label={`Ver atendimentos de ${info.date.toLocaleDateString('pt-BR')}`}>{info.dayNumberText}</button>{canCreate && <button type="button" className="framework-add" aria-label={`Novo atendimento em ${info.date.toLocaleDateString('pt-BR')}`} onClick={() => onCreate(day)}><Plus size={14} /></button>}</div>;
      }}
      eventClass={info => `framework-event month-tone--${appointmentStage(info.event.extendedProps.appointment).tone}`}
      eventClick={info => { info.jsEvent.preventDefault(); onEvent(info.event.extendedProps.appointment); }}
      eventDidMount={info => {
        const appointment = info.event.extendedProps.appointment as CalendarAppointment;
        info.el.setAttribute('aria-label', `${appointmentTime(appointment)}, ${appointmentTitle(appointment)}, ${appointmentTeam(appointment, technicians)}, ${appointmentStage(appointment).full}`);
        info.el.setAttribute('title', `${appointmentTitle(appointment)}\n${appointmentTeam(appointment, technicians)}\n${appointment.client_address || 'Local não informado'}`);
      }}
      eventContent={info => {
        const appointment = info.event.extendedProps.appointment as CalendarAppointment;
        return <div className="framework-event-content">
          <span className="framework-event-title"><time>{appointmentTime(appointment, info.event.extendedProps.day)}</time><strong>{appointmentTitle(appointment)}</strong></span>
          <span className="framework-event-team"><UsersRound size={12} /><span>{appointmentTeam(appointment, technicians) || 'Equipe a definir'}</span>{!compact && Boolean(appointment.reservations?.length) && <span className="framework-event-reservations"><ClipboardCheck size={12} />{appointment.reservations?.length}</span>}</span>
        </div>;
      }}
      moreLinkText={count => `Mais ${count}`}
      moreLinkClass="framework-more"
      moreLinkClick={info => { onDay(dateKey(info.date)); }}
    />
  </div>;
}
