import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeftRight, Check, X } from 'lucide-react';
import { ModalOverlay } from './ModalOverlay';
import { safeFetchJson } from '../lib/api';

interface GoogleEventSnapshot {
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
  description?: string;
}

export interface CalendarTechnician { id: number; name: string }

export interface CalendarAppointment {
  id: number;
  title?: string;
  client_name?: string;
  client_address?: string;
  appointment_date: string;
  appointment_time?: string;
  appointment_end_date?: string;
  appointment_end_time?: string;
  all_day?: boolean;
  status?: string;
  workflow_status?: string;
  technician_id?: number;
  technician_ids?: number[];
  technician_names?: string;
  technician_name?: string;
  reservations?: unknown[];
  google_event_id?: string;
  google_calendar_id?: string;
  calendar_writable?: boolean;
  google_sync_revision?: number;
  google_sync_status?: string;
  google_sync_error?: string;
  google_sync_conflict?: GoogleEventSnapshot;
}

interface CalendarSaveResult {
  success?: boolean;
  appointment?: CalendarAppointment;
  sync_status?: string;
  error?: string;
  message?: string;
}

interface CalendarEventEditorProps {
  appointment: CalendarAppointment;
  technicians: CalendarTechnician[];
  onDismiss: () => void;
  onSaved: (message: string) => Promise<void>;
}

function offsetDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function describeRemoteTime(event: GoogleEventSnapshot | null) {
  if (event?.start?.date) {
    const lastDay = offsetDate(event.end?.date, -1) || event.start.date;
    return `${event.start.date}${lastDay !== event.start.date ? ` a ${lastDay}` : ''} · Dia inteiro`;
  }
  const format = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Não informado' : new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: event.start?.timeZone || 'America/Sao_Paulo'
    }).format(parsed);
  };
  return event?.start?.dateTime ? `${format(event.start.dateTime)} a ${format(event.end?.dateTime)}` : 'Não informado';
}

export function CalendarEventEditor({ appointment, technicians, onDismiss, onSaved }: CalendarEventEditorProps) {
  const [record, setRecord] = useState(appointment);
  const isAllDay = Boolean(appointment.all_day);
  const [form, setForm] = useState({
    title: appointment.title || '',
    client_name: appointment.client_name || '',
    client_address: appointment.client_address || '',
    appointment_date: appointment.appointment_date || '',
    appointment_time: String(appointment.appointment_time || '').slice(0, 5),
    appointment_end_date: isAllDay
      ? offsetDate(appointment.appointment_end_date, -1) || appointment.appointment_date || ''
      : appointment.appointment_end_date || appointment.appointment_date || '',
    appointment_end_time: String(appointment.appointment_end_time || '').slice(0, 5),
    all_day: isAllDay,
    technician_ids: (Array.isArray(appointment.technician_ids) ? appointment.technician_ids : [appointment.technician_id])
      .filter(Boolean).map(Number) as number[]
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const conflict = record.google_sync_status === 'conflict' ? record.google_sync_conflict : null;
  const remote = conflict;
  const canEdit = record.calendar_writable !== false && Boolean(record.google_event_id && record.google_calendar_id);

  const processResult = async (result: CalendarSaveResult) => {
    if (result.appointment && (result.success || result.appointment.google_sync_status === 'conflict')) setRecord(result.appointment);
    if (!result.success) throw new Error(result.error || result.message || 'Não foi possível salvar o atendimento.');
    if (result.sync_status === 'conflict') {
      setError(result.message || 'O evento também mudou no Google. Compare as versões antes de continuar.');
      return;
    }
    const message = result.message || (result.sync_status === 'synced'
      ? 'Atendimento atualizado no ATEM Field e no Google Agenda.'
      : 'Alterações salvas no ATEM Field. O envio ao Google permanece pendente.');
    await onSaved(message);
    onDismiss();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const start = `${form.appointment_date}T${form.all_day ? '00:00' : form.appointment_time}`;
    const end = `${form.appointment_end_date}T${form.all_day ? '23:59' : form.appointment_end_time}`;
    if (!form.title.trim()) { setError('Informe o título do atendimento.'); return; }
    if (end <= start) { setError('O término precisa ser posterior ao início do atendimento.'); return; }
    setBusy(true);
    try {
      const result = await safeFetchJson(`/api/appointments/${record.id}/calendar`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          appointment_end_date: form.all_day ? offsetDate(form.appointment_end_date, 1) : form.appointment_end_date,
          appointment_time: form.all_day ? null : form.appointment_time,
          appointment_end_time: form.all_day ? null : form.appointment_end_time,
          expected_revision: Number(record.google_sync_revision || 0)
        })
      });
      await processResult(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível salvar o atendimento.');
    } finally { setBusy(false); }
  };

  const resolveConflict = async (resolution: 'google' | 'atem') => {
    setBusy(true); setError('');
    try {
      const result = await safeFetchJson(`/api/appointments/${record.id}/calendar/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, expected_revision: Number(record.google_sync_revision || 0) })
      });
      await processResult(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível resolver a diferença entre as agendas.');
    } finally { setBusy(false); }
  };

  return (
    <ModalOverlay className="calendar-editor-overlay" onDismiss={busy ? undefined : onDismiss}>
      <section className="calendar-editor" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title" aria-describedby="calendar-editor-description" aria-busy={busy}>
        <header className="calendar-editor__heading">
          <div><span className="field-overline">Google Agenda · ATEM Field</span><h2 id="calendar-editor-title">{conflict ? 'Revisar alterações' : 'Editar atendimento'}</h2></div>
          <button type="button" className="btn btn-secondary calendar-editor__close" aria-label="Fechar edição" disabled={busy} onClick={onDismiss}><X size={20} /></button>
        </header>
        <p id="calendar-editor-description">Data, horário, título, local e equipe são sincronizados entre as agendas. Os horários seguem o fuso de Brasília.</p>
        {!canEdit && <p className="calendar-notice calendar-notice--warning"><AlertCircle size={18} />{record.calendar_writable === false ? 'Sua conexão Google não permite editar esta agenda.' : 'Sincronize a agenda para identificar o evento Google antes de editar.'}</p>}
        {error && <p className="calendar-notice calendar-notice--error" role="alert"><AlertCircle size={18} />{error}</p>}
        {conflict ? (
          <section className="calendar-conflict" aria-label="Comparação das alterações">
            <p><ArrowLeftRight size={18} /> O atendimento mudou nos dois sistemas. Escolha a versão que será mantida.</p>
            <div className="calendar-conflict__versions">
              <article><h3>ATEM Field</h3><dl>
                <dt>Título</dt><dd>{record.title || 'Não informado'}</dd>
                <dt>Cliente</dt><dd>{record.client_name || 'Não informado'}</dd>
                <dt>Período</dt><dd>{record.appointment_date} {record.all_day ? '· Dia inteiro' : record.appointment_time} a {record.all_day ? offsetDate(record.appointment_end_date, -1) : record.appointment_end_date} {record.all_day ? '' : record.appointment_end_time}</dd>
                <dt>Local</dt><dd>{record.client_address || 'Não informado'}</dd>
                <dt>Equipe</dt><dd>{record.technician_names || technicians.filter(tech => (record.technician_ids || []).map(Number).includes(Number(tech.id))).map(tech => tech.name).join(', ') || 'Não informada'}</dd>
              </dl></article>
              <article><h3>Google Agenda</h3><dl>
                <dt>Título</dt><dd>{remote?.summary || 'Não informado'}</dd>
                <dt>Período</dt><dd>{describeRemoteTime(remote)}</dd>
                <dt>Local</dt><dd>{remote?.location || 'Não informado'}</dd>
                <dt>Situação</dt><dd>{remote?.status === 'cancelled' ? 'Excluído no Google' : 'Evento alterado'}</dd>
                {remote?.description && <><dt>Descrição</dt><dd className="calendar-conflict__description">{String(remote.description)}</dd></>}
              </dl></article>
            </div>
            <p className="calendar-editor__hint">A escolha vale para os dados do evento. As reservas e a etapa do workflow continuam vinculadas ao atendimento.</p>
            <footer className="calendar-editor__actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void resolveConflict('google')}>Usar versão do Google</button>
              <button type="button" className="btn btn-primary" disabled={busy || !canEdit || remote?.status === 'cancelled'} onClick={() => void resolveConflict('atem')}>{busy ? 'Salvando…' : 'Enviar versão do ATEM'}</button>
            </footer>
          </section>
        ) : (
          <form onSubmit={submit}>
            <fieldset className="calendar-editor__fields" disabled={busy || !canEdit}>
              <label className="calendar-editor__field calendar-editor__field--wide">Título<input className="input-field" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} maxLength={500} required /></label>
              <label className="calendar-editor__field">Cliente<input className="input-field" value={form.client_name} onChange={event => setForm({ ...form, client_name: event.target.value })} maxLength={500} /></label>
              <label className="calendar-editor__field">Local / endereço<input className="input-field" value={form.client_address} onChange={event => setForm({ ...form, client_address: event.target.value })} maxLength={1000} /></label>
              <label className="calendar-editor__check calendar-editor__field--wide"><input type="checkbox" checked={form.all_day} onChange={event => setForm({ ...form, all_day: event.target.checked })} />Dia inteiro</label>
              <label className="calendar-editor__field">Data de início<input className="input-field" type="date" value={form.appointment_date} onChange={event => setForm({ ...form, appointment_date: event.target.value })} required /></label>
              {!form.all_day && <label className="calendar-editor__field">Hora de início<input className="input-field" type="time" value={form.appointment_time} onChange={event => setForm({ ...form, appointment_time: event.target.value })} required /></label>}
              <label className="calendar-editor__field">{form.all_day ? 'Último dia' : 'Data de término'}<input className="input-field" type="date" value={form.appointment_end_date} min={form.appointment_date} onChange={event => setForm({ ...form, appointment_end_date: event.target.value })} required /></label>
              {!form.all_day && <label className="calendar-editor__field">Hora de término<input className="input-field" type="time" value={form.appointment_end_time} onChange={event => setForm({ ...form, appointment_end_time: event.target.value })} required /></label>}
              <fieldset className="calendar-editor__team calendar-editor__field--wide"><legend>Equipe escalada</legend>
                <div>{technicians.map(technician => <label className="calendar-editor__check" key={technician.id}><input type="checkbox" checked={form.technician_ids.includes(Number(technician.id))} onChange={event => setForm({ ...form, technician_ids: event.target.checked ? [...form.technician_ids, Number(technician.id)] : form.technician_ids.filter(id => id !== Number(technician.id)) })} />{technician.name}</label>)}</div>
                {!technicians.length && <p className="calendar-editor__hint">Nenhum técnico disponível para seleção.</p>}
              </fieldset>
            </fieldset>
            <p className="calendar-editor__hint">A atualização não envia convites ou e-mails aos participantes do Google.</p>
            <footer className="calendar-editor__actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={onDismiss}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={busy || !canEdit}><Check size={17} />{busy ? 'Salvando…' : 'Salvar e sincronizar'}</button></footer>
          </form>
        )}
      </section>
    </ModalOverlay>
  );
}
