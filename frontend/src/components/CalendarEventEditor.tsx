import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowLeftRight, Check, Plus, Trash2, X } from 'lucide-react';
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

interface CalendarOption {
  id: string;
  name: string;
  writable: boolean;
  primary?: boolean;
}

interface CalendarEventEditorProps {
  appointment?: CalendarAppointment | null;
  technicians: CalendarTechnician[];
  initialDate?: string;
  canManage?: boolean;
  canAssignTeam?: boolean;
  onDismiss: () => void;
  onSaved: (message: string) => Promise<void>;
  onDeleted?: (message: string) => Promise<void>;
}

function offsetDate(value: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function CalendarEventEditor({ appointment, technicians, initialDate, canManage, canAssignTeam = true, onDismiss, onSaved, onDeleted }: CalendarEventEditorProps) {
  const isCreateMode = !appointment;
  const [record, setRecord] = useState<CalendarAppointment | null>(appointment || null);
  const isAllDay = Boolean(appointment?.all_day);
  const defaultDate = initialDate || appointment?.appointment_date || todayDateString();

  const [form, setForm] = useState({
    title: appointment?.title || '',
    client_name: appointment?.client_name || '',
    client_address: appointment?.client_address || '',
    appointment_date: appointment?.appointment_date || defaultDate,
    appointment_time: appointment ? String(appointment.appointment_time || '').slice(0, 5) : '08:00',
    appointment_end_date: appointment
      ? (isAllDay ? offsetDate(appointment.appointment_end_date, -1) || appointment.appointment_date || '' : appointment.appointment_end_date || appointment.appointment_date || '')
      : defaultDate,
    appointment_end_time: appointment ? String(appointment.appointment_end_time || '').slice(0, 5) : '17:00',
    all_day: isAllDay,
    technician_ids: appointment
      ? ((Array.isArray(appointment.technician_ids) ? appointment.technician_ids : [appointment.technician_id]).filter(Boolean).map(Number) as number[])
      : [],
    notes: ''
  });

  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [loadingCalendars, setLoadingCalendars] = useState(isCreateMode);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!appointment?.id) return;
    const title = form.client_name || form.title || 'este atendimento';
    if (!window.confirm(`Deseja realmente excluir o agendamento "${title}"?\n\nEssa ação removerá o agendamento do sistema e do Google Agenda.`)) {
      return;
    }
    setDeleting(true);
    setError('');
    try {
      const result = await safeFetchJson(`/api/appointments/${appointment.id}`, { method: 'DELETE' });
      if (!result.success) {
        throw new Error(result.error || 'Não foi possível excluir o agendamento.');
      }
      const msg = result.message || 'Agendamento excluído com sucesso.';
      if (onDeleted) {
        await onDeleted(msg);
      } else {
        await onSaved(msg);
      }
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir o agendamento.');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (isCreateMode) {
      safeFetchJson('/api/calendar/calendars')
        .then(res => {
          if (res?.success && Array.isArray(res.calendars)) {
            const list: CalendarOption[] = res.calendars;
            setCalendars(list);
            const primary = list.find(c => c.primary) || list[0];
            if (primary) setSelectedCalendarId(primary.id);
          }
        })
        .catch(err => console.warn('Erro ao listar agendas Google:', err))
        .finally(() => setLoadingCalendars(false));
    }
  }, [isCreateMode]);

  const conflict = record?.google_sync_status === 'conflict' ? record.google_sync_conflict : null;
  const remote = conflict;
  const canEdit = canManage && (isCreateMode
    ? true
    : (record?.calendar_writable !== false && Boolean(record?.google_event_id && record?.google_calendar_id)));

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
      if (isCreateMode) {
        const result = await safeFetchJson('/api/appointments/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title.trim(),
            client_name: form.client_name.trim() || form.title.trim(),
            client_address: form.client_address.trim(),
            calendar_id: selectedCalendarId || undefined,
            notes: form.notes.trim(),
            all_day: form.all_day,
            appointment_date: form.appointment_date,
            appointment_time: form.all_day ? null : form.appointment_time,
            appointment_end_date: form.all_day ? offsetDate(form.appointment_end_date, 1) : form.appointment_end_date,
            appointment_end_time: form.all_day ? null : form.appointment_end_time,
            technician_ids: form.technician_ids
          })
        });
        if (!result.success) throw new Error(result.error || result.message || 'Não foi possível criar o atendimento.');
        await onSaved(result.message || 'Atendimento criado e sincronizado com o Google Agenda.');
        onDismiss();
      } else {
        const result = await safeFetchJson(`/api/appointments/${record!.id}/calendar`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            title: form.title.trim(),
            appointment_end_date: form.all_day ? offsetDate(form.appointment_end_date, 1) : form.appointment_end_date,
            appointment_time: form.all_day ? null : form.appointment_time,
            appointment_end_time: form.all_day ? null : form.appointment_end_time,
            expected_revision: Number(record!.google_sync_revision || 0)
          })
        });
        await processResult(result);
      }
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
          <div>
            <span className="field-overline">Google Agenda · ATEM Field</span>
            <h2 id="calendar-editor-title">{isCreateMode ? 'Novo atendimento' : (conflict ? 'Revisar alterações' : 'Editar atendimento')}</h2>
          </div>
          <div className="calendar-editor__heading-actions">
            {!isCreateMode && (
              <button
                type="button"
                className="btn btn-secondary btn-sm calendar-editor__delete"
                disabled={busy || deleting}
                onClick={() => void handleDelete()}
                title="Excluir este atendimento"
              >
                <Trash2 size={15} />
                {deleting ? 'Excluindo…' : 'Excluir atendimento'}
              </button>
            )}
            <button type="button" className="btn btn-secondary calendar-editor__close" aria-label="Fechar" disabled={busy} onClick={onDismiss}><X size={20} /></button>
          </div>
        </header>
        <p id="calendar-editor-description">
          {isCreateMode
            ? 'O atendimento será cadastrado e enviado imediatamente ao Google Agenda com equipe e detalhes sincronizados.'
            : 'Data, horário, título, local e equipe são sincronizados entre as agendas. Os horários seguem o fuso de Brasília.'}
        </p>
        {!isCreateMode && !canEdit && <p className="calendar-notice calendar-notice--warning"><AlertCircle size={18} />{record?.calendar_writable === false ? 'Sua conexão Google não permite editar esta agenda.' : 'Sincronize a agenda para identificar o evento Google antes de editar.'}</p>}
        {error && <p className="calendar-notice calendar-notice--error" role="alert"><AlertCircle size={18} />{error}</p>}
        {conflict && record ? (
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
              {isCreateMode && (
                <label className="calendar-editor__field calendar-editor__field--wide">
                  Agenda Google de destino
                  <select
                    className="select-field input-field"
                    value={selectedCalendarId}
                    onChange={event => setSelectedCalendarId(event.target.value)}
                    disabled={busy || loadingCalendars}
                  >
                    {calendars.length === 0 ? (
                      <option value="">{loadingCalendars ? 'Carregando agendas...' : 'Agenda Geral (tecnicosmultmed@gmail.com)'}</option>
                    ) : (
                      calendars.map(cal => (
                        <option key={cal.id} value={cal.id}>
                          {cal.name}{cal.primary ? ' (Principal)' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              )}
              <label className="calendar-editor__field calendar-editor__field--wide">
                Título do atendimento
                <input className="input-field" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex: Manutenção Preventiva - Philips Epiq 7" maxLength={500} required />
              </label>
              <label className="calendar-editor__field">
                Cliente / Unidade
                <input className="input-field" value={form.client_name} onChange={event => setForm({ ...form, client_name: event.target.value })} placeholder="Nome do hospital ou cliente" maxLength={500} />
              </label>
              <label className="calendar-editor__field">
                Local / endereço
                <input className="input-field" value={form.client_address} onChange={event => setForm({ ...form, client_address: event.target.value })} placeholder="Endereço da unidade" maxLength={1000} />
              </label>
              <label className="calendar-editor__check calendar-editor__field--wide">
                <input type="checkbox" checked={form.all_day} onChange={event => setForm({ ...form, all_day: event.target.checked })} />
                Dia inteiro
              </label>
              <label className="calendar-editor__field">
                Data de início
                <input className="input-field" type="date" value={form.appointment_date} onChange={event => setForm({ ...form, appointment_date: event.target.value })} required />
              </label>
              {!form.all_day && (
                <label className="calendar-editor__field">
                  Hora de início
                  <input className="input-field" type="time" value={form.appointment_time} onChange={event => setForm({ ...form, appointment_time: event.target.value })} required />
                </label>
              )}
              <label className="calendar-editor__field">
                {form.all_day ? 'Último dia' : 'Data de término'}
                <input className="input-field" type="date" value={form.appointment_end_date} min={form.appointment_date} onChange={event => setForm({ ...form, appointment_end_date: event.target.value })} required />
              </label>
              {!form.all_day && (
                <label className="calendar-editor__field">
                  Hora de término
                  <input className="input-field" type="time" value={form.appointment_end_time} onChange={event => setForm({ ...form, appointment_end_time: event.target.value })} required />
                </label>
              )}
              <fieldset className="calendar-editor__team calendar-editor__field--wide" disabled={!canAssignTeam}>
                <legend>Equipe escalada</legend>
                {!canAssignTeam && <p className="calendar-editor__hint">O supervisor define a equipe após receber a data provisória.</p>}
                <div>
                  {technicians.map(technician => (
                    <label className="calendar-editor__check" key={technician.id}>
                      <input
                        type="checkbox"
                        checked={form.technician_ids.includes(Number(technician.id))}
                        onChange={event => setForm({
                          ...form,
                          technician_ids: event.target.checked
                            ? [...form.technician_ids, Number(technician.id)]
                            : form.technician_ids.filter(id => id !== Number(technician.id))
                        })}
                      />
                      {technician.name}
                    </label>
                  ))}
                </div>
                {!technicians.length && <p className="calendar-editor__hint">Nenhum técnico disponível para seleção.</p>}
              </fieldset>
              {isCreateMode && (
                <label className="calendar-editor__field calendar-editor__field--wide">
                  Observações adicionais
                  <textarea
                    className="input-field"
                    rows={3}
                    value={form.notes}
                    onChange={event => setForm({ ...form, notes: event.target.value })}
                    placeholder="Observações do atendimento (são incluídas na descrição do evento Google)..."
                    maxLength={2000}
                    style={{ resize: 'vertical', minHeight: '64px' }}
                  />
                </label>
              )}
            </fieldset>
            <p className="calendar-editor__hint">
              {isCreateMode
                ? 'Ao criar, o evento é registrado no banco ATEM e criado imediatamente no Google Agenda.'
                : 'A atualização não envia convites ou e-mails aos participantes do Google.'}
            </p>
            <footer className="calendar-editor__actions">
              {!isCreateMode && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', marginRight: 'auto' }}
                  disabled={busy || deleting}
                  onClick={() => void handleDelete()}
                >
                  <Trash2 size={16} />
                  {deleting ? 'Excluindo…' : 'Excluir atendimento'}
                </button>
              )}
              <button className="btn btn-secondary" type="button" disabled={busy || deleting} onClick={onDismiss}>Cancelar</button>
              <button className="btn btn-primary" type="submit" disabled={busy || deleting || !canEdit}>
                {isCreateMode ? <Plus size={17} /> : <Check size={17} />}
                {busy ? (isCreateMode ? 'Criando…' : 'Salvando…') : (isCreateMode ? 'Criar e sincronizar' : 'Salvar e sincronizar')}
              </button>
            </footer>
          </form>
        )}
      </section>
    </ModalOverlay>
  );
}
