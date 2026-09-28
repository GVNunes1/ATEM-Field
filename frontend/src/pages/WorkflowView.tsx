import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, ClipboardList, GripVertical, MapPin, PackageCheck, Pencil, Search, UsersRound, X } from 'lucide-react';
import { AppointmentAssetsPanel } from '../components/AppointmentAssetsPanel';
import { AppointmentOperationsPanel } from '../components/AppointmentOperationsPanel';
import type { OperationalInsights } from '../lib/operationalInsights';
import { CalendarEventEditor, type CalendarAppointment, type CalendarTechnician } from '../components/CalendarEventEditor';
import { ModalOverlay } from '../components/ModalOverlay';
import { safeFetchJson } from '../lib/api';
import { canAdvanceWorkflow, missingWorkflowFields, nextWorkflowStatus, workflowStages, workflowStatus, type WorkflowStage } from '../lib/workflow';
import './WorkflowView.css';

interface Props {
  appointments: CalendarAppointment[];
  insights: OperationalInsights;
  technicians: CalendarTechnician[];
  role: string;
  currentUserId: number | string;
  onRefresh: () => Promise<void>;
}

const monthNow = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const dateText = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'Sem data';
const teamText = (appointment: CalendarAppointment) => {
  const names = String(appointment.technician_names || appointment.technician_name || '').trim();
  return names && names !== 'Equipe de Campo' ? names : 'Equipe a definir';
};

const profileRole = (value: string | undefined) => {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (/^(supervisor|supervisora)\b/.test(normalized)) return 'supervisor';
  if (/^(comercial|commercial|vendas|sales)\b/.test(normalized)) return 'commercial';
  if (/^(gerente|manager|admin)\b/.test(normalized)) return 'manager';
  return 'technician';
};

export function WorkflowView({ appointments, insights, technicians, role, currentUserId, onRefresh }: Props) {
  const [month, setMonth] = useState(monthNow);
  const [allMonths, setAllMonths] = useState(role === 'technician');
  const [level, setLevel] = useState<WorkflowStage | 'all'>('all');
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(role === 'technician');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dragVisual, setDragVisual] = useState<{ id: number; x: number; y: number } | null>(null);
  const [dropStage, setDropStage] = useState<WorkflowStage | null>(null);
  const dragStart = useRef<{ id: number; x: number; y: number } | null>(null);
  const boardScroll = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<CalendarAppointment | null>(null);
  const [assetsAppointmentId, setAssetsAppointmentId] = useState<number | null>(null);
  const [operationsAppointmentId, setOperationsAppointmentId] = useState<number | null>(null);
  const [handoff, setHandoff] = useState<{ appointment: CalendarAppointment; target: WorkflowStage } | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({});

  const filtered = useMemo(() => appointments.filter(appointment => {
    if (/cancelad/i.test(`${appointment.status || ''} ${appointment.workflow_status || ''}`)) return false;
    if (!workflowStatus(appointment)) return false;
    if (mineOnly && (appointment.workflow_assignee_id == null || String(appointment.workflow_assignee_id) !== String(currentUserId))) return false;
    if (!allMonths && !String(appointment.appointment_date || '').startsWith(month)) return false;
    const search = query.trim().toLocaleLowerCase('pt-BR');
    return !search || [appointment.title, appointment.client_name, appointment.client_address, appointment.technician_names]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(search));
  }).sort((a, b) => String(a.appointment_date || '').localeCompare(String(b.appointment_date || ''))
    || String(a.appointment_time || '').localeCompare(String(b.appointment_time || ''))), [appointments, allMonths, month, query, mineOnly, currentUserId]);

  const shownStages = level === 'all' ? workflowStages : workflowStages.filter((stage, index) =>
    stage.id === level || workflowStages[index - 1]?.id === level);
  const moving = appointments.find(item => item.id === dragVisual?.id);
  const assetsAppointment = appointments.find(item => item.id === assetsAppointmentId);
  const operationsAppointment = appointments.find(item => item.id === operationsAppointmentId);
  const canDrop = (stage: WorkflowStage) => Boolean(moving && workflowStatus(moving) && nextWorkflowStatus(workflowStatus(moving)!) === stage && canAdvanceWorkflow(role, workflowStatus(moving)!));
  const handoffCandidates = useMemo(() => {
    if (!handoff) return [];
    const target = handoff.target;
    const expected = ['Aguardando validação do supervisor', 'Concluído'].includes(target) ? 'supervisor'
      : ['Validado pelo supervisor', 'Data provisória'].includes(target) ? 'commercial' : 'technician';
    const assignedIds = new Set([...(handoff.appointment.technician_ids || []), handoff.appointment.technician_id].filter(Boolean).map(Number));
    return technicians.filter(person => String(person.status || 'Ativo').toLowerCase() === 'ativo'
      && profileRole(person.role) === expected
      && (expected !== 'technician' || assignedIds.has(Number(person.id))));
  }, [handoff, technicians]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, appointment: CalendarAppointment, allowed: boolean) => {
    if (!allowed || busyId !== null || event.button !== 0 || (event.target as HTMLElement).closest('button') && !(event.target as HTMLElement).closest('.workflow-card__grip')) return;
    if (event.pointerType !== 'mouse' && !(event.target as HTMLElement).closest('.workflow-card__grip')) return;
    dragStart.current = { id: appointment.id, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    if (!dragVisual && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
    setDragVisual({ id: start.id, x: event.clientX, y: event.clientY });
    const scroll = boardScroll.current;
    if (scroll) {
      const bounds = scroll.getBoundingClientRect();
      if (event.clientX > bounds.right - 36) scroll.scrollLeft += 22;
      if (event.clientX < bounds.left + 36) scroll.scrollLeft -= 22;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.workflow-column');
    const stage = workflowStages.find(item => item.id === target?.dataset.stage)?.id || null;
    setDropStage(stage && canDrop(stage) ? stage : null);
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.workflow-column');
    const stage = workflowStages.find(item => item.id === target?.dataset.stage)?.id || null;
    const appointment = appointments.find(item => item.id === start?.id);
    if (dragVisual && appointment && stage && canDrop(stage)) requestAdvance(appointment, stage);
    dragStart.current = null; setDragVisual(null); setDropStage(null);
  };

  const requestAdvance = (appointment: CalendarAppointment, target: WorkflowStage) => {
    const current = workflowStatus(appointment);
    if (!current || nextWorkflowStatus(current) !== target || !canAdvanceWorkflow(role, current)) return;
    const missing = missingWorkflowFields(appointment, target);
    if (missing.length) {
      setError(`Para avançar “${appointment.client_name || appointment.title || 'atendimento'}”, preencha: ${missing.join(', ')}.`);
      setEditing(appointment);
      return;
    }
    setError(''); setNotice(''); setAssigneeId(''); setHandoff({ appointment, target });
  };

  const confirmHandoff = async () => {
    if (!handoff || !assigneeId) { setError('Escolha o colaborador responsável.'); return; }
    const { appointment, target } = handoff;
    if (!handoffCandidates.some(person => String(person.id) === assigneeId)) { setError('Escolha um colaborador permitido para esta etapa.'); return; }
    setBusyId(appointment.id); setError(''); setNotice('');
    try {
      const result = await safeFetchJson(`/api/appointments/${appointment.id}/workflow`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow_status: target, workflow_assignee_id: Number(assigneeId) })
      });
      if (!result.success) throw new Error(result.error || 'Não foi possível avançar o atendimento.');
      await onRefresh();
      if (level !== 'all') setLevel(target);
      setNotice(`Atendimento movido para ${target} e atribuído a ${handoffCandidates.find(person => String(person.id) === assigneeId)?.name}.`);
      setHandoff(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível avançar o atendimento.');
    } finally { setBusyId(null); setDropStage(null); }
  };

  return <div className="workflow-page">
    <header className="workflow-heading"><div><span className="field-overline">Operação de campo</span><h1>Workflow</h1><p>{role === 'technician' ? 'Acompanhe as atividades que foram encaminhadas a você em cada etapa.' : 'Acompanhe cada atendimento da proposta à conclusão. Arraste para a próxima etapa depois de completar os dados exigidos.'}</p></div><div className="workflow-total"><strong>{filtered.length}</strong><span>{filtered.length === 1 ? 'atendimento' : 'atendimentos'} no filtro</span></div></header>
    <section className="workflow-filters" aria-label="Filtros do workflow">
      <label className="workflow-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar atendimentos</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cliente, local, atividade ou técnico" aria-label="Buscar atendimentos" /></label>
      <label className="workflow-filter-field">Nível<select value={level} onChange={event => setLevel(event.target.value as WorkflowStage | 'all')} aria-label="Filtrar por nível"><option value="all">Todos os níveis</option>{workflowStages.map(stage => <option value={stage.id} key={stage.id}>{stage.short}</option>)}</select></label>
      <label className="workflow-filter-field">Mês<input type="month" value={month} onChange={event => setMonth(event.target.value)} disabled={allMonths} aria-label="Filtrar por mês" /></label>
      <label className="workflow-all-months"><input type="checkbox" checked={allMonths} onChange={event => setAllMonths(event.target.checked)} />Todos os meses</label>
      {role !== 'technician' && <label className="workflow-all-months"><input type="checkbox" checked={mineOnly} onChange={event => setMineOnly(event.target.checked)} />Minhas atividades</label>}
    </section>
    {error && <p className="workflow-message workflow-message--error" role="alert"><AlertCircle size={17} />{error}</p>}
    {notice && <p className="workflow-message" role="status">{notice}</p>}
    <div ref={boardScroll} className="workflow-board-scroll" aria-label="Quadro de etapas do workflow"><div className={`workflow-board${level !== 'all' ? ' workflow-board--focused' : ''}`} style={{ '--workflow-columns': shownStages.length } as CSSProperties}>
      {shownStages.map(stage => {
        const items = filtered.filter(appointment => workflowStatus(appointment) === stage.id);
        const limit = limits[stage.id] || 30;
        return <section key={stage.id} data-stage={stage.id} className={`workflow-column workflow-tone--${stage.tone}${dropStage === stage.id && canDrop(stage.id) ? ' workflow-column--target' : ''}`} aria-label={`${stage.id}: ${items.length} atendimentos`}>
          <header className="workflow-column__heading"><div><span className="workflow-column__marker" /><div><h2>{stage.short}</h2><small>{stage.owner}</small></div></div><strong aria-label={`${items.length} atendimentos`}>{items.length}</strong></header>
          <div className="workflow-column__cards">{items.slice(0, limit).map(appointment => {
            const next = nextWorkflowStatus(stage.id);
            const allowed = canAdvanceWorkflow(role, stage.id);
            const canEdit = ['admin', 'manager', 'supervisor'].includes(role) || (role === 'commercial' && ['Data provisória', 'Validado pelo supervisor'].includes(stage.id));
            const missing = next ? missingWorkflowFields(appointment, next) : [];
            return <article key={appointment.id} className={`workflow-card${busyId === appointment.id ? ' workflow-card--busy' : ''}${dragVisual?.id === appointment.id ? ' workflow-card--dragging' : ''}`} onPointerDown={event => startDrag(event, appointment, Boolean(next && allowed))} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { dragStart.current = null; setDragVisual(null); setDropStage(null); }} aria-label={`${appointment.client_name || appointment.title}, ${stage.id}`}>
              <div className="workflow-card__top"><span className="workflow-card__date"><CalendarDays size={14} />{dateText(appointment.appointment_date)}{!appointment.all_day && appointment.appointment_time && ` · ${appointment.appointment_time.slice(0, 5)}`}</span>{allowed && <span className="workflow-card__grip" aria-hidden="true"><GripVertical size={16} /></span>}</div>
              <h3>{appointment.client_name || appointment.title || 'Atendimento sem título'}</h3>{appointment.title && appointment.title !== appointment.client_name && <p className="workflow-card__activity">{appointment.title}</p>}
              <div className="workflow-card__facts"><span><MapPin size={14} />{appointment.client_address || 'Local a preencher'}</span><span><UsersRound size={14} />{teamText(appointment)}</span><span className="workflow-card__owner">Responsável: {appointment.workflow_assignee_name || technicians.find(person => Number(person.id) === Number(appointment.workflow_assignee_id))?.name || 'Não atribuído'}</span></div>
              {insights.readiness.find(item => item.appointment_id === appointment.id)?.state === 'attention' && <p className="workflow-card__missing"><AlertCircle size={14} />Preparação pendente</p>}
              {missing.length > 0 && allowed && <p className="workflow-card__missing"><AlertCircle size={14} />Falta: {missing.join(', ')}</p>}
              <div className="workflow-card__actions"><button type="button" onClick={() => setOperationsAppointmentId(appointment.id)} aria-label={`Prontidão e histórico de ${appointment.client_name || appointment.title}`}><ClipboardList size={14} />Prontidão e histórico</button><button type="button" onClick={() => setAssetsAppointmentId(appointment.id)} aria-label={`Carros e padrões de ${appointment.client_name || appointment.title}`}><PackageCheck size={14} />Carros e padrões</button>{canEdit && <button type="button" onClick={() => { setError(''); setEditing(appointment); }} aria-label={`Editar dados de ${appointment.client_name || appointment.title}`}><Pencil size={14} />Editar dados</button>}{next && allowed && <button type="button" onClick={() => requestAdvance(appointment, next)} disabled={busyId !== null} aria-label={`Avançar ${appointment.client_name || appointment.title} para ${next}`}>{busyId === appointment.id ? 'Salvando…' : 'Encaminhar'}<ArrowRight size={14} /></button>}</div>
            </article>;
          })}{items.length === 0 && <p className="workflow-column__empty">Nenhum atendimento nesta etapa.</p>}{items.length > limit && <button type="button" className="workflow-column__more" onClick={() => setLimits(previous => ({ ...previous, [stage.id]: limit + 30 }))}>Mostrar mais {Math.min(30, items.length - limit)} de {items.length - limit}</button>}</div>
        </section>;
      })}
    </div></div>
    {dragVisual && <div className="workflow-drag-ghost" style={{ left: dragVisual.x + 14, top: dragVisual.y + 14 }} aria-hidden="true">{appointments.find(item => item.id === dragVisual.id)?.client_name || appointments.find(item => item.id === dragVisual.id)?.title}</div>}
    {assetsAppointment && <ModalOverlay className="workflow-assets-overlay" onDismiss={() => setAssetsAppointmentId(null)}><section className="workflow-assets-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-assets-title"><header className="workflow-assets-dialog__header"><div><span className="field-overline">Ativos do atendimento</span><h2 id="workflow-assets-title">{assetsAppointment.client_name || assetsAppointment.title}</h2><p>{dateText(assetsAppointment.appointment_date)} · {workflowStatus(assetsAppointment)}</p></div><button type="button" className="workflow-assets-dialog__close" aria-label="Fechar carros e padrões" onClick={() => setAssetsAppointmentId(null)}><X size={20} /></button></header><AppointmentAssetsPanel key={assetsAppointment.id} appointment={assetsAppointment} technicians={technicians} currentUser={{ id: currentUserId, role }} onRefresh={onRefresh} /></section></ModalOverlay>}
    {operationsAppointment && <ModalOverlay className="workflow-assets-overlay" onDismiss={() => setOperationsAppointmentId(null)}><section className="workflow-assets-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-operations-title"><header className="workflow-assets-dialog__header"><div><span className="field-overline">Atendimento</span><h2 id="workflow-operations-title">{operationsAppointment.client_name || operationsAppointment.title}</h2><p>{dateText(operationsAppointment.appointment_date)} · {workflowStatus(operationsAppointment)}</p></div><button type="button" className="workflow-assets-dialog__close" aria-label="Fechar prontidão e histórico" onClick={() => setOperationsAppointmentId(null)}><X size={20} /></button></header><AppointmentOperationsPanel appointmentId={operationsAppointment.id} readiness={insights.readiness.find(item => item.appointment_id === operationsAppointment.id)} /></section></ModalOverlay>}
    {handoff && <ModalOverlay className="workflow-handoff-overlay" onDismiss={busyId !== null ? undefined : () => setHandoff(null)}><section className="workflow-handoff" role="dialog" aria-modal="true" aria-labelledby="workflow-handoff-title"><h2 id="workflow-handoff-title">Encaminhar atendimento</h2><p><strong>{handoff.appointment.client_name || handoff.appointment.title}</strong> irá para <strong>{handoff.target}</strong>.</p><label>Responsável nesta etapa<select value={assigneeId} onChange={event => setAssigneeId(event.target.value)} aria-label="Responsável pela próxima etapa" required><option value="">Selecione um colaborador</option>{handoffCandidates.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{handoffCandidates.length === 0 && <p className="workflow-handoff__hint" role="alert">Não há colaborador elegível. Confira os usuários ativos e a equipe escalada antes de avançar.</p>}{error && <p className="workflow-handoff__hint" role="alert">{error}</p>}<div className="workflow-handoff__actions"><button type="button" className="btn btn-secondary" disabled={busyId !== null} onClick={() => { setHandoff(null); setError(''); }}>Cancelar</button><button type="button" className="btn btn-primary" disabled={busyId !== null || !assigneeId || handoffCandidates.length === 0} onClick={() => void confirmHandoff()}>{busyId !== null ? 'Encaminhando…' : 'Confirmar encaminhamento'}</button></div></section></ModalOverlay>}
    {editing && <CalendarEventEditor key={editing.id} appointment={editing} technicians={technicians} canManage canAssignTeam={role !== 'commercial'} canDelete={role !== 'commercial'} onDismiss={() => setEditing(null)} onSaved={async message => { setEditing(null); setNotice(message); setError(''); await onRefresh(); }} />}
  </div>;
}
