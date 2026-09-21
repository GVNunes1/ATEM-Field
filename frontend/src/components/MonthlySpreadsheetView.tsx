import { useMemo } from 'react';
import { Calendar, ClipboardCheck, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import type { CalendarAppointment, CalendarTechnician } from './CalendarEventEditor';
import './MonthlySpreadsheetView.css';

export interface MonthlySpreadsheetViewProps {
  selectedMonth: string; // "YYYY-MM"
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

const pad = (n: number) => String(n).padStart(2, '0');

export function MonthlySpreadsheetView({
  selectedMonth,
  appointments,
  canManage,
  onEditAppointment,
  onCreateAppointment,
  onDeleteAppointment,
  onOpenChecklistModal,
  deletingId,
  searchTerm = '',
  selectedTech = 'ALL'
}: MonthlySpreadsheetViewProps) {
  const [yearStr, monthStr] = selectedMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Mapeamento dos agendamentos indexados pela data (YYYY-MM-DD)
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();

    const query = searchTerm.trim().toLowerCase();
    const techFilter = selectedTech.toLowerCase();

    for (const appt of appointments) {
      if (!appt.appointment_date || !appt.appointment_date.startsWith(selectedMonth)) continue;

      // Filtro por busca ou técnico se aplicável
      if (techFilter !== 'all') {
        const techNames = String(appt.technician_names || appt.technician_name || '').toLowerCase();
        if (!techNames.includes(techFilter)) continue;
      }

      if (query) {
        const searchPool = [
          appt.client_name,
          appt.title,
          appt.client_address,
          appt.technician_names,
          appt.technician_name
        ].map(v => String(v || '').toLowerCase()).join(' ');

        if (!searchPool.includes(query)) continue;
      }

      const key = appt.appointment_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(appt);
    }

    // Ordenar horários do dia
    for (const [, list] of map.entries()) {
      list.sort((a, b) => {
        if (a.all_day && !b.all_day) return -1;
        if (!a.all_day && b.all_day) return 1;
        return (
          String(a.appointment_time || '').localeCompare(String(b.appointment_time || '')) ||
          String(a.client_name || a.title || '').localeCompare(String(b.client_name || b.title || ''), 'pt-BR')
        );
      });
    }

    return map;
  }, [appointments, selectedMonth, searchTerm, selectedTech]);

  // Divisão clássica em 4 colunas verticais como no print da planilha física / Excel
  const columns = useMemo(() => [
    { colNumber: 1, startDay: 1, endDay: Math.min(8, daysInMonth) },
    { colNumber: 2, startDay: 9, endDay: Math.min(16, daysInMonth) },
    { colNumber: 3, startDay: 17, endDay: Math.min(24, daysInMonth) },
    { colNumber: 4, startDay: 25, endDay: daysInMonth }
  ], [daysInMonth]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
      .format(new Date(year, month - 1, 1));
  }, [year, month]);

  return (
    <div className="monthly-spreadsheet-wrapper">
      <div className="monthly-spreadsheet-toolbar">
        <div className="monthly-spreadsheet-toolbar__title">
          <h2>Planilha Mensal de Atendimentos — {monthLabel}</h2>
          <span>Quadro operacional (dias 1 a 31 em 4 colunas)</span>
        </div>

        <div className="monthly-spreadsheet-legend">
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--green" />
            Sobreaviso / Fim de Semana
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--yellow" />
            Treinamento / Prova / Geral
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--red" />
            Cancelado
          </span>
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--today" />
            Hoje
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
            title="Imprimir quadro mensal"
            style={{ height: '30px', padding: '0 10px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
          >
            <Printer size={13} /> Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="monthly-spreadsheet-scroll">
        <div className="monthly-spreadsheet-grid">
          {columns.map(col => {
            const daysInCol: number[] = [];
            for (let d = col.startDay; d <= col.endDay; d++) {
              daysInCol.push(d);
            }

            return (
              <div key={col.colNumber} className="monthly-spreadsheet-col">
                {daysInCol.map(dayNum => {
                  const dayKey = `${year}-${pad(month)}-${pad(dayNum)}`;
                  const dateObj = new Date(year, month - 1, dayNum);
                  const dayOfWeek = dateObj.getDay(); // 0 = Dom, 6 = Sab
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                  const weekdayShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dayOfWeek];
                  const isToday = dayKey === todayKey;

                  const dayAppointments = appointmentsByDate.get(dayKey) || [];

                  // Detecta se é sobreaviso ou fim de semana para colorir em verde claro
                  const hasSobreaviso = dayAppointments.some(a => (
                    isNonTechnicalAppointment(a) ||
                    String(a.title || '').toLowerCase().includes('sobreaviso') ||
                    String(a.client_name || '').toLowerCase().includes('sobreaviso')
                  ));
                  const isGreenDay = isWeekend || hasSobreaviso;

                  // Sempre exibe no mínimo 5 linhas (1º ao 5º agendamento), ou mais se houver
                  const totalSlots = Math.max(5, dayAppointments.length);
                  const slotIndices = Array.from({ length: totalSlots }, (_, i) => i);

                  return (
                    <article
                      key={dayKey}
                      className={`spreadsheet-day-block ${isGreenDay ? 'is-green-day' : 'is-normal-day'}`}
                    >
                      <table className="spreadsheet-day-table">
                        <colgroup>
                          <col className="col-w-dia" />
                          <col className="col-w-local" />
                          <col className="col-w-hora" />
                          <col className="col-w-tecs" />
                        </colgroup>
                        <thead>
                          <tr className="spreadsheet-day-header">
                            <th className="col-dia">
                              <span className="day-header-title">
                                DIA {dayNum} <span style={{ opacity: 0.8, fontSize: '0.66rem', fontWeight: 500 }}>({weekdayShort})</span>
                                {isToday && <span className="day-header-today-pill">Hoje</span>}
                              </span>
                              {canManage && (
                                <button
                                  type="button"
                                  className="day-add-btn"
                                  title={`Novo atendimento no dia ${dayNum}`}
                                  onClick={() => onCreateAppointment(dayKey)}
                                >
                                  <Plus size={11} />
                                </button>
                              )}
                            </th>
                            <th className="col-local">LOCAL</th>
                            <th className="col-hora">HORA</th>
                            <th className="col-tecnicos">TECNICOS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slotIndices.map(index => {
                            const slotNumber = index + 1;
                            const slotLabel = `${slotNumber}º Agendamento`;
                            const appt = dayAppointments[index];

                            if (!appt) {
                              // Linha vazia
                              return (
                                <tr
                                  key={`empty-${dayKey}-${index}`}
                                  className="spreadsheet-row row-empty"
                                  onClick={() => onCreateAppointment(dayKey)}
                                  title={`Clique para agendar novo atendimento no dia ${dayNum}`}
                                >
                                  <td className="cell-label">{slotLabel}</td>
                                  <td className="cell-local">
                                    <span className="empty-slot-content">
                                      <Plus size={11} /> Agendar
                                    </span>
                                  </td>
                                  <td className="cell-hora" />
                                  <td className="cell-tecs" />
                                </tr>
                              );
                            }

                            // Agendamento preenchido
                            const displayTitle = appt.client_name || appt.title || 'Atendimento';
                            const hasDifferentTitle = appt.title && appt.title !== displayTitle;

                            const isCancelled =
                              String(appt.status || '').toLowerCase() === 'cancelado' ||
                              String(appt.title || '').toLowerCase().includes('cancelado') ||
                              String(appt.client_name || '').toLowerCase().includes('cancelado');

                            const isYellowHighlight = [appt.title, appt.client_name].some(text => {
                              const lower = String(text || '').toLowerCase();
                              return (
                                lower.includes('prova') ||
                                lower.includes('todos') ||
                                lower.includes('treinamento') ||
                                lower.includes('cisa')
                              );
                            });

                            const timeDisplay = appt.all_day
                              ? 'dia'
                              : appt.appointment_time
                              ? String(appt.appointment_time).slice(0, 5)
                              : '08:00';

                            const techNames = (appt.technician_names || appt.technician_name || '')
                              .replace(/,/g, '; ');

                            const isNonTech = isNonTechnicalAppointment(appt);

                            return (
                              <tr
                                key={appt.id}
                                className={`spreadsheet-row row-occupied ${isYellowHighlight ? 'row-yellow' : ''}`}
                                onClick={() => onEditAppointment(appt)}
                                title={`${displayTitle}${hasDifferentTitle ? ` (${appt.title})` : ''}\nHorário: ${timeDisplay}\nEndereço: ${appt.client_address || 'Não informado'}\nTécnicos: ${techNames || 'Não informado'}`}
                              >
                                <td className="cell-label">{slotLabel}</td>
                                <td className="cell-local">
                                  <div className={`cell-local-text ${isCancelled ? 'text-cancelled' : ''}`}>
                                    {displayTitle}
                                  </div>
                                  <div className="slot-actions" onClick={e => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="slot-action-btn"
                                      title="Editar atendimento"
                                      onClick={() => onEditAppointment(appt)}
                                    >
                                      <Pencil size={11} />
                                    </button>
                                    {!isNonTech && (
                                      <button
                                        type="button"
                                        className="slot-action-btn"
                                        title="Checklist e reserva"
                                        onClick={() => onOpenChecklistModal(appt.id)}
                                      >
                                        <ClipboardCheck size={11} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="slot-action-btn slot-action-btn--delete"
                                      title="Excluir atendimento"
                                      disabled={deletingId === Number(appt.id)}
                                      onClick={() => onDeleteAppointment(appt)}
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </td>
                                <td className="cell-hora">
                                  <span className={isCancelled ? 'text-cancelled' : ''}>
                                    {timeDisplay}
                                  </span>
                                </td>
                                <td className="cell-tecs">
                                  <span className={isCancelled ? 'text-cancelled' : ''}>
                                    {techNames || '—'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
