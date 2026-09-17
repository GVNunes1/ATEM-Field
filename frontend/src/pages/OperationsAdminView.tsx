import { ModalOverlay } from '../components/ModalOverlay';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { safeFetchJson } from '../lib/api';
import { AuthUser } from '../types/auth';
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  Clock3,
  Edit2,
  ExternalLink,
  LoaderCircle,
  Lock,
  MessageCircleMore,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X
} from 'lucide-react';
import './OperationsAdminView.css';

interface OperationsAdminViewProps {
  appointments: any[];
  analyzers: any[];
  technicians: any[];
  onRefresh: () => Promise<void>;
  initialAppointmentId?: number | string | null;
  currentUser?: AuthUser | null;
}

const ACTIVE_STATUSES = new Set(['Reservado', 'Em Uso', 'Aguardando Aprovação']);
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function hasUsablePhone(value: unknown) {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return Boolean(normalized && normalized !== 'pendente' && !normalized.startsWith('pendente ('));
}

function formatDate(value: string) {
  if (!value || value === 'N/A') return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`)).replace('.', '');
}

export function OperationsAdminView({
  appointments,
  analyzers,
  technicians,
  onRefresh,
  initialAppointmentId,
  currentUser
}: OperationsAdminViewProps) {
  const isAdmin = currentUser?.role === 'admin';
  const isTechnician = currentUser?.role === 'technician';
  const isEqat = currentUser?.name?.trim().toUpperCase() === 'EQAT' || (currentUser as any)?.username?.trim().toLowerCase() === 'eqat';
  const canSpecialOps = isAdmin || isEqat;

  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modos de Operação: Atendimento / Chamado / Calibração / Empréstimo
  const [operationType, setOperationType] = useState<'Atendimento' | 'Chamado' | 'Calibração' | 'Empréstimo'>('Atendimento');
  const [directDate, setDirectDate] = useState<string>(todayKey());
  const [directNotes, setDirectNotes] = useState<string>('');
  const [directCheckout, setDirectCheckout] = useState<boolean>(false);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string>(
    initialAppointmentId ? String(initialAppointmentId) : ''
  );
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>(
    isTechnician && currentUser ? String(currentUser.id) : ''
  );
  const [selectedAnalyzerIds, setSelectedAnalyzerIds] = useState<number[]>([]);
  const [analyzerSearch, setAnalyzerSearch] = useState('');
  const [checklist, setChecklist] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [searchTerm, setSearchTerm] = useState('');
  const [portalTechnicianId, setPortalTechnicianId] = useState('');
  const [portalLink, setPortalLink] = useState('');
  const [generatingLink, setGeneratingLink] = useState(false);

  // Edit Reservation Modal State (Admin only)
  const [editReservationModal, setEditReservationModal] = useState<any | null>(null);
  const [editResForm, setEditResForm] = useState<{
    technician_id: string;
    reserved_date: string;
    status: string;
  }>({ technician_id: '', reserved_date: '', status: 'Reservado' });

  useEffect(() => {
    if (initialAppointmentId) {
      setSelectedAppointmentId(String(initialAppointmentId));
    }
  }, [initialAppointmentId]);

  useEffect(() => {
    if (isTechnician && currentUser) {
      setSelectedTechnicianId(String(currentUser.id));
    }
  }, [isTechnician, currentUser]);

  const loadReservations = async () => {
    setLoadingReservations(true);
    try {
      const data = await safeFetchJson('/api/reservations', { cache: 'no-store' });
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar as reservas.');
      setReservations(data.reservations || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao carregar reservas.');
    } finally {
      setLoadingReservations(false);
    }
  };

  useEffect(() => { void loadReservations(); }, []);

  const activeTechnicians = useMemo(() => technicians
    .filter(technician => technician.status === 'Ativo')
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')), [technicians]);

  const upcomingAppointments = useMemo(() => {
    const current = todayKey();
    const finalDate = new Date(`${current}T12:00:00`);
    finalDate.setDate(finalDate.getDate() + 120);
    const limit = finalDate.toISOString().slice(0, 10);
    return appointments
    .filter(appointment => appointment.appointment_date >= current && appointment.appointment_date <= limit && String(appointment.status).toLowerCase() !== 'cancelado')
    .sort((left, right) => (
      String(left.appointment_date).localeCompare(String(right.appointment_date))
      || String(left.appointment_time || '').localeCompare(String(right.appointment_time || ''))
    ));
  }, [appointments]);

  const upcomingTechnicalAppointments = useMemo(() => {
    return upcomingAppointments.filter(appointment => !isNonTechnicalAppointment(appointment));
  }, [upcomingAppointments]);

  const selectedAppointment = useMemo(() => upcomingAppointments.find(item => String(item.id) === selectedAppointmentId), [upcomingAppointments, selectedAppointmentId]);

  useEffect(() => {
    if (!selectedAppointment) {
      setChecklist(null);
      if (!isTechnician) setSelectedTechnicianId('');
      setSelectedAnalyzerIds([]);
      setAnalyzerSearch('');
      return;
    }

    if (isTechnician && currentUser) {
      setSelectedTechnicianId(String(currentUser.id));
    } else {
      let preferredTechnician = selectedAppointment.technician_id
        || selectedAppointment.technician_ids?.[0]
        || (selectedAppointment.technicians && selectedAppointment.technicians[0]?.id);

      if (!preferredTechnician && selectedAppointment.technician_names) {
        const firstTechName = selectedAppointment.technician_names.split(/[,;]/)[0]?.trim().toLowerCase();
        if (firstTechName) {
          const found = activeTechnicians.find(t =>
            t.name.toLowerCase() === firstTechName ||
            t.name.toLowerCase().includes(firstTechName) ||
            firstTechName.includes(t.name.toLowerCase())
          );
          if (found) preferredTechnician = found.id;
        }
      }

      setSelectedTechnicianId(preferredTechnician ? String(preferredTechnician) : '');
    }

    setSelectedAnalyzerIds([]);
    setAnalyzerSearch('');
    safeFetchJson(`/api/appointments/${selectedAppointment.id}/checklist`, { cache: 'no-store' })
      .then(data => setChecklist(data.success ? data : null))
      .catch(() => setChecklist(null));
  }, [selectedAppointment, activeTechnicians, isTechnician, currentUser]);

  const availableAnalyzers = useMemo(() => {
    let targetDate = '';
    let apptId = 0;
    if (operationType === 'Atendimento') {
      if (!selectedAppointment || isNonTechnicalAppointment(selectedAppointment)) return [];
      targetDate = selectedAppointment.appointment_date;
      apptId = Number(selectedAppointment.id);
    } else {
      targetDate = directDate || todayKey();
    }

    const conflicts = new Set(reservations
      .filter(reservation => reservation.reserved_date === targetDate)
      .filter(reservation => ACTIVE_STATUSES.has(reservation.status))
      .filter(reservation => !apptId || Number(reservation.appointment_id) !== apptId)
      .map(reservation => reservation.analyzer_id));

    const alreadyReserved = new Set(
      apptId
        ? reservations
            .filter(reservation => Number(reservation.appointment_id) === apptId)
            .filter(reservation => ACTIVE_STATUSES.has(reservation.status))
            .map(reservation => reservation.analyzer_id)
        : []
    );

    return analyzers
      .filter(analyzer => !/manuten|indispon|baixado|inativ/i.test(analyzer.status || ''))
      .filter(analyzer => !conflicts.has(analyzer.id) && !alreadyReserved.has(analyzer.id))
      .sort((left, right) => String(left.asset_tag).localeCompare(String(right.asset_tag), 'pt-BR', { numeric: true }));
  }, [analyzers, reservations, selectedAppointment, operationType, directDate]);

  const selectedAnalyzers = useMemo(() => selectedAnalyzerIds
    .map(id => availableAnalyzers.find(analyzer => Number(analyzer.id) === id))
    .filter(Boolean), [availableAnalyzers, selectedAnalyzerIds]);

  const filteredAvailableAnalyzers = useMemo(() => {
    const query = analyzerSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return availableAnalyzers.filter(analyzer => !selectedAnalyzerIds.includes(Number(analyzer.id)));
    return availableAnalyzers
      .filter(analyzer => !selectedAnalyzerIds.includes(Number(analyzer.id)))
      .filter(analyzer => [analyzer.asset_tag, analyzer.name, analyzer.type, analyzer.brand_model]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)));
  }, [analyzerSearch, availableAnalyzers, selectedAnalyzerIds]);

  const filteredReservations = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('pt-BR');
    return reservations
      .filter(reservation => {
        // Se for técnico, só vê suas próprias reservas (a menos que seja admin ou EQAT)
        if (isTechnician && currentUser && !isEqat) {
          return Number(reservation.technician_id) === Number(currentUser.id);
        }
        return true;
      })
      .filter(reservation => statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? ACTIVE_STATUSES.has(reservation.status) : reservation.status === statusFilter))
      .filter(reservation => !query || [reservation.asset_tag, reservation.analyzer_name, reservation.technician_name, reservation.client_name, reservation.operation_type]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
      .sort((left, right) => String(right.reserved_date || '').localeCompare(String(left.reserved_date || '')) || Number(right.id) - Number(left.id));
  }, [reservations, searchTerm, statusFilter, isTechnician, currentUser, isEqat]);

  const metrics = useMemo(() => {
    const current = todayKey();
    const inSevenDays = new Date(`${current}T12:00:00`);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    const limit = inSevenDays.toISOString().slice(0, 10);
    const myRes = isTechnician && currentUser && !isEqat
      ? reservations.filter(r => Number(r.technician_id) === Number(currentUser.id))
      : reservations;

    return {
      active: myRes.filter(reservation => ACTIVE_STATUSES.has(reservation.status)).length,
      inUse: myRes.filter(reservation => reservation.status === 'Em Uso').length,
      pendingApproval: reservations.filter(reservation => reservation.status === 'Aguardando Aprovação').length,
      available: analyzers.filter(analyzer => analyzer.status === 'Disponível').length,
      weekAppointments: upcomingAppointments.filter(appointment => appointment.appointment_date <= limit).length
    };
  }, [analyzers, reservations, upcomingAppointments, isTechnician, currentUser, isEqat]);

  const analyzerOverview = useMemo(() => {
    const countStatus = (status: string) => analyzers.filter(analyzer => analyzer.status === status).length;
    const unavailable = analyzers.filter(analyzer => !['Disponível', 'Reservado', 'Em Uso'].includes(analyzer.status)).length;
    const types = new Map<string, number>();
    analyzers.forEach(analyzer => {
      const type = String(analyzer.type || 'Sem categoria');
      types.set(type, (types.get(type) || 0) + 1);
    });
    return {
      statuses: [
        { label: 'Disponíveis', value: countStatus('Disponível'), tone: 'available' },
        { label: 'Reservados', value: countStatus('Reservado'), tone: 'reserved' },
        { label: 'Em uso', value: countStatus('Em Uso'), tone: 'in-use' },
        { label: 'Indisponíveis', value: unavailable, tone: 'unavailable' }
      ],
      types: [...types.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5)
    };
  }, [analyzers]);

  const createReservation = async (event: FormEvent) => {
    event.preventDefault();
    const effectiveTechId = isTechnician && currentUser ? Number(currentUser.id) : Number(selectedTechnicianId);
    if (!effectiveTechId || !selectedAnalyzerIds.length) return;
    if (operationType === 'Atendimento' && !selectedAppointmentId) return;

    setSaving(true); setError(''); setNotice('');
    let completed = 0;
    try {
      for (const analyzerId of selectedAnalyzerIds) {
        const payload: any = {
          technician_id: effectiveTechId,
          analyzer_id: analyzerId,
          operation_type: operationType,
          direct_checkout: isAdmin && directCheckout,
          notes: operationType === 'Atendimento'
            ? (isTechnician ? `Reserva efetuada pelo próprio técnico (${currentUser?.name})` : 'Reserva criada pelo painel administrativo')
            : (directNotes || (operationType === 'Calibração' ? 'Saída/Reserva para Calibração de Padrão' : 'Empréstimo de equipamento'))
        };

        if (operationType === 'Atendimento') {
          payload.appointment_id = Number(selectedAppointmentId);
        } else {
          payload.reserved_date = directDate || todayKey();
        }

        const data = await safeFetchJson('/api/reservations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(isAdmin ? { 'x-admin-token': 'admin-master' } : {})
          },
          body: JSON.stringify(payload)
        });
        if (!data.success) throw new Error(data.error || 'Não foi possível criar a reserva.');
        completed += 1;
      }
      setNotice(
        operationType !== 'Atendimento' && isEqat && !isAdmin
          ? `Solicitação de ${operationType} enviada com sucesso! Aguarde aprovação do Administrador Geral para liberação física.`
          : `${completed} ${completed === 1 ? 'padrão registrado' : 'padrões registrados'} com sucesso.`
      );
      setSelectedAnalyzerIds([]);
      setAnalyzerSearch('');
      setDirectNotes('');
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (requestError) {
      if (completed) await Promise.all([loadReservations(), onRefresh()]);
      const message = requestError instanceof Error ? requestError.message : 'Falha ao criar reserva.';
      setError(completed ? `${completed} reserva(s) concluída(s). O restante não foi salvo: ${message}` : message);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveReservation = async (reservationId: number) => {
    setActionId(reservationId);
    setError('');
    setNotice('');
    try {
      const data = await safeFetchJson(`/api/reservations/${reservationId}/approve`, {
        method: 'POST',
        headers: { 'x-admin-token': 'admin-master' }
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível aprovar a solicitação.');
      setNotice(data.message || 'Solicitação aprovada com sucesso! Saída liberada.');
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao aprovar solicitação.');
    } finally {
      setActionId(null);
    }
  };

  const updateReservationStatus = async (reservation: any) => {
    const action = reservation.status === 'Reservado' ? 'checkout' : 'checkin';
    setActionId(reservation.id); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/reservations/${reservation.id}/${action}`, { method: 'POST' });
      if (!data.success) throw new Error(data.error || 'Não foi possível atualizar a reserva.');
      setNotice(data.message);
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao atualizar reserva.');
    } finally {
      setActionId(null);
    }
  };

  const handleOpenEditReservation = (res: any) => {
    setEditReservationModal(res);
    setEditResForm({
      technician_id: String(res.technician_id || ''),
      reserved_date: String(res.reserved_date || res.appointment_date || '').slice(0, 10),
      status: res.status || 'Reservado'
    });
  };

  const handleSaveEditReservation = async (e: FormEvent) => {
    e.preventDefault();
    if (!editReservationModal) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/reservations/${editReservationModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technician_id: Number(editResForm.technician_id),
          reserved_date: editResForm.reserved_date,
          status: editResForm.status
        })
      });
      if (data.success) {
        setNotice('Reserva editada com sucesso no banco de dados!');
        setEditReservationModal(null);
        await Promise.all([loadReservations(), onRefresh()]);
      } else {
        setError(data.error || 'Falha ao atualizar reserva.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteReservation = async (resId: number) => {
    if (!window.confirm('⚠️ Tem certeza que deseja apagar esta reserva do banco de dados? O padrão será liberado imediatamente.')) {
      return;
    }
    setActionId(resId); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/reservations/${resId}`, {
        method: 'DELETE'
      });
      if (data.success) {
        setNotice('Reserva apagada e padrão liberado no banco de dados!');
        await Promise.all([loadReservations(), onRefresh()]);
      } else {
        setError(data.error || 'Falha ao excluir reserva.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao apagar reserva.');
    } finally {
      setActionId(null);
    }
  };

  const generatePortalLink = async () => {
    if (!portalTechnicianId) return;
    setGeneratingLink(true); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/technicians/${portalTechnicianId}/portal-link`, { cache: 'no-store' });
      if (!data.success) throw new Error(data.error || 'Não foi possível gerar o acesso.');
      setPortalLink(data.portal_url);
      try {
        await navigator.clipboard.writeText(data.portal_url);
        setNotice(`Link de ${data.technician.name} copiado. Validade: ${data.expires_in_hours} horas.`);
      } catch {
        setNotice(`Link de ${data.technician.name} gerado. Copie pelo campo abaixo.`);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao gerar link individual.');
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <div className="operations-admin-view field-dashboard">
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Operações & Padrões</span>
          <h1>{isTechnician ? 'Minhas reservas em campo.' : 'Gestão de reservas.'}</h1>
          <p>
            {isTechnician
              ? 'Separe os analisadores para seus atendimentos e controle saídas e devoluções.'
              : 'Controle operacional de saídas, empréstimos, calibrações e disponibilidade dos analisadores.'}
          </p>
        </div>
      </header>

      {notice && <div className="operations-notice is-success" role="status"><p>{notice}</p><button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && <div className="operations-notice is-error" role="alert"><p>{error}</p><button type="button" onClick={() => setError('')} aria-label="Fechar erro"><X size={15} /></button></div>}

      <section className="field-metrics" aria-label="Indicadores da operação">
        <button
          type="button"
          className="field-metric available"
          onClick={() => setStatusFilter('ACTIVE')}
        >
          <span className="field-metric-label">
            {isTechnician ? 'Minhas reservas' : 'Reservas ativas'}
            <PackageCheck size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.active}</strong>
          <span className="field-metric-detail">Separadas para atendimento</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('Em Uso')}
        >
          <span className="field-metric-label">
            Em campo
            <Activity size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.inUse}</strong>
          <span className="field-metric-detail">{isTechnician ? 'Comigo em campo' : 'Em uso pelos técnicos'}</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('ALL')}
        >
          <span className="field-metric-label">
            Padrões livres
            <Wrench size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.available}</strong>
          <span className="field-metric-detail">Disponíveis no setor</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => {}}
        >
          <span className="field-metric-label">
            Próximos 7 dias
            <CalendarDays size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.weekAppointments}</strong>
          <span className="field-metric-detail">Atendimentos agendados</span>
        </button>
      </section>

      <section className="operations-primary-grid">
        <form className="field-surface reservation-form" onSubmit={createReservation}>
          <div className="field-section-heading">
            <div>
              <h2>
                {operationType === 'Chamado' ? '🚨 Saída para Chamado Espontâneo' :
                 operationType === 'Calibração' ? '🔬 Saída para Calibração de Padrão' :
                 operationType === 'Empréstimo' ? '🤝 Empréstimo de Equipamento' :
                 (isTechnician ? '📋 Reservar Padrão para Atendimento' : 'Nova reserva administrativa')}
              </h2>
              <p>
                {operationType === 'Chamado' ? 'Atendimento espontâneo de emergência / sem agendamento prévio na agenda.' :
                 operationType !== 'Atendimento' ? (isEqat && !isAdmin ? 'Solicitação da EQAT sujeita à aprovação do Administrador Geral.' : 'Registro direto de saída/reserva sem agendamento.') :
                 (isTechnician ? 'A reserva será vinculada estritamente ao seu perfil.' : 'Vincule atendimento, técnico e patrimônio.')}
              </p>
            </div>
          </div>

          {/* SELETOR DE MODO: ATENDIMENTO / CHAMADO / CALIBRAÇÃO / EMPRÉSTIMO */}
          <div style={{ marginBottom: '14px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '6px' }}>
              Finalidade da Operação
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${operationType === 'Atendimento' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                onClick={() => { setOperationType('Atendimento'); setSelectedAnalyzerIds([]); }}
              >
                📋 Atendimento da Agenda
              </button>
              <button
                type="button"
                className={`btn btn-sm ${operationType === 'Chamado' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '6px 12px', background: operationType === 'Chamado' ? '#ea580c' : undefined, borderColor: operationType === 'Chamado' ? '#c2410c' : undefined }}
                onClick={() => { setOperationType('Chamado'); setSelectedAnalyzerIds([]); }}
              >
                🚨 Chamado Espontâneo
              </button>
              {canSpecialOps && (
                <>
                  <button
                    type="button"
                    className={`btn btn-sm ${operationType === 'Calibração' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => { setOperationType('Calibração'); setSelectedAnalyzerIds([]); }}
                  >
                    🔬 Calibração
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${operationType === 'Empréstimo' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => { setOperationType('Empréstimo'); setSelectedAnalyzerIds([]); }}
                  >
                    🤝 Empréstimo
                  </button>
                </>
              )}
            </div>
          </div>

          {operationType === 'Atendimento' ? (
            <label>
              <span>Atendimento (Serviços Técnicos)</span>
              <select value={selectedAppointmentId} onChange={event => setSelectedAppointmentId(event.target.value)} required>
                <option value="">Selecione o atendimento</option>
                {upcomingTechnicalAppointments.map(appointment => (
                  <option key={appointment.id} value={appointment.id}>
                    {formatDate(appointment.appointment_date)} · {appointment.appointment_time || '--:--'} · {appointment.client_name || appointment.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
              <label>
                <span>Data da Operação *</span>
                <input
                  type="date"
                  className="input-field"
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  value={directDate}
                  onChange={e => setDirectDate(e.target.value)}
                  required
                />
              </label>
              <label>
                <span>{operationType === 'Chamado' ? 'Hospital / Cliente / Motivo do Chamado *' : operationType === 'Calibração' ? 'Laboratório / Motivo' : 'Destino / Solicitante'}</span>
                <input
                  type="text"
                  className="input-field"
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  placeholder={operationType === 'Chamado' ? 'Ex: Hospital Regional - Emergência Ventilador' : operationType === 'Calibração' ? 'Ex: Calibração Anual Fluke' : 'Ex: Empréstimo Filial RJ'}
                  value={directNotes}
                  onChange={e => setDirectNotes(e.target.value)}
                  required={operationType === 'Chamado'}
                />
              </label>
            </div>
          )}

          <label>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Responsável {isTechnician && !isEqat && <span style={{ color: 'var(--primary)', fontWeight: 700 }}>(Fixo no seu perfil)</span>}
            </span>
            <select
              value={isTechnician && currentUser && !isEqat ? String(currentUser.id) : selectedTechnicianId}
              onChange={event => setSelectedTechnicianId(event.target.value)}
              disabled={isTechnician && !isEqat}
              style={isTechnician && !isEqat ? { background: '#f1f5f9', cursor: 'not-allowed', color: '#334155', fontWeight: 600 } : {}}
              required
            >
              {isTechnician && currentUser && !isEqat ? (
                <option value={String(currentUser.id)}>{currentUser.name} (Você)</option>
              ) : (
                <>
                  <option value="">Selecione o responsável</option>
                  {activeTechnicians.map(technician => (
                    <option key={technician.id} value={technician.id}>{technician.name}</option>
                  ))}
                </>
              )}
            </select>
          </label>

          {isAdmin && operationType !== 'Atendimento' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: '4px 0 8px 0', fontSize: '0.85rem', color: '#1e293b' }}>
              <input
                type="checkbox"
                checked={directCheckout}
                onChange={e => setDirectCheckout(e.target.checked)}
              />
              <strong>Registrar saída imediata ('Em Uso')</strong>
            </label>
          )}

          {isEqat && !isAdmin && operationType !== 'Atendimento' && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '8px 12px', borderRadius: '8px', fontSize: '0.78rem', marginBottom: '8px' }}>
              ℹ️ Como EQAT, esta solicitação de saída entrará como <strong>Aguardando Aprovação</strong> e será liberada para retirada assim que o Administrador Geral aprovar.
            </div>
          )}

          {operationType === 'Atendimento' && selectedAppointment && (
            isNonTechnicalAppointment(selectedAppointment) ? (
              <div className="operations-notice is-error" style={{ margin: '0.5rem 0' }}>
                Agendamentos não técnicos (Sobreaviso, Exame, Aniversário, Revisão, Treinamento, etc.) não permitem reserva de padrões.
              </div>
            ) : (
              <div className="reservation-form__context">
                <CalendarDays size={15} />
                <span>{formatDate(selectedAppointment.appointment_date)} às {selectedAppointment.appointment_time || '--:--'}</span>
                <strong>{checklist?.requiredAnalyzerTypes?.length ? `${checklist.requiredAnalyzerTypes.length} tipo(s) exigido(s)` : 'Sem restrição de tipo'}</strong>
              </div>
            )
          )}

          <fieldset className="analyzer-picker" disabled={(operationType === 'Atendimento' && !selectedAppointment) || saving}>
            <legend>Selecionar padrões</legend>
            <p>Pesquise por patrimônio, nome, tipo ou modelo e adicione quantos forem necessários.</p>
            <label className="analyzer-picker__search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="Buscar padrão disponível"
                placeholder={selectedAppointment ? 'Buscar padrão disponível' : 'Escolha um atendimento primeiro'}
                value={analyzerSearch}
                onChange={event => setAnalyzerSearch(event.target.value)}
              />
              {analyzerSearch && <button type="button" onClick={() => setAnalyzerSearch('')} aria-label="Limpar pesquisa"><X size={16} /></button>}
            </label>
            <div className="analyzer-picker__results" role="list" aria-label="Padrões disponíveis">
              {filteredAvailableAnalyzers.map(analyzer => (
                <article key={analyzer.id} className="analyzer-picker__item" role="listitem">
                  <div>
                    <strong>{analyzer.asset_tag}</strong>
                    <span>{analyzer.name || 'Padrão sem nome'}</span>
                    <small>{analyzer.type || 'Sem tipo'}{analyzer.brand_model ? ` · ${analyzer.brand_model}` : ''}</small>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => setSelectedAnalyzerIds(ids => [...ids, Number(analyzer.id)])}
                  >
                    <Plus size={15} /> Adicionar
                  </button>
                </article>
              ))}
              {selectedAppointment && !filteredAvailableAnalyzers.length && (
                <div className="analyzer-picker__empty">Nenhum padrão disponível corresponde à busca.</div>
              )}
            </div>
          </fieldset>

          <section className="selected-analyzers" aria-live="polite">
            <div className="selected-analyzers__head">
              <div>
                <strong>Padrões adicionados</strong>
                <span>Revise os itens antes de confirmar.</span>
              </div>
              <b>{selectedAnalyzers.length}</b>
            </div>
            <div className="selected-analyzers__list">
              {selectedAnalyzers.map((analyzer: any) => (
                <article key={analyzer.id}>
                  <div>
                    <strong>{analyzer.asset_tag}</strong>
                    <span>{analyzer.name || 'Padrão sem nome'} · {analyzer.type || 'Sem tipo'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAnalyzerIds(ids => ids.filter(id => id !== Number(analyzer.id)))}
                    aria-label={`Remover ${analyzer.asset_tag}`}
                  >
                    <X size={16} />
                    <span>Remover</span>
                  </button>
                </article>
              ))}
              {!selectedAnalyzers.length && <div className="selected-analyzers__empty">Nenhum padrão adicionado.</div>}
            </div>
          </section>

          <button className="btn btn-primary" disabled={saving || !selectedAnalyzerIds.length}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
            {saving
              ? `Reservando ${selectedAnalyzerIds.length} item(ns)…`
              : selectedAnalyzerIds.length
              ? `Confirmar ${selectedAnalyzerIds.length} ${selectedAnalyzerIds.length === 1 ? 'reserva' : 'reservas'}`
              : 'Adicione ao menos um padrão'}
          </button>
        </form>

        {/* Portal Access Link Box (Admin only) or Technician Info Card */}
        {isAdmin ? (
          <div className="field-surface portal-access-card">
            <div className="field-section-heading">
              <div>
                <h2>Acesso do técnico</h2>
                <p>Gere e copie o link individual de acesso ao portal do técnico.</p>
              </div>
            </div>
            <label>
              <span>Técnico</span>
              <select
                className="select-field"
                value={portalTechnicianId}
                onChange={event => { setPortalTechnicianId(event.target.value); setPortalLink(''); }}
              >
                <option value="">Selecione o técnico</option>
                {activeTechnicians.map(technician => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name} · {hasUsablePhone(technician.phone) ? technician.phone : 'celular pendente'}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!portalTechnicianId || generatingLink}
              onClick={() => void generatePortalLink()}
            >
              {generatingLink ? <LoaderCircle className="spin" size={17} /> : <Clipboard size={17} />}
              {generatingLink ? 'Gerando…' : 'Gerar e copiar link'}
            </button>
            {portalLink && (
              <div className="portal-link-result" style={{ flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', width: '100%', gap: '8px' }}>
                  <input readOnly value={portalLink} aria-label="Link do Portal do Técnico" style={{ flex: 1 }} />
                  <a href={portalLink} target="_blank" rel="noreferrer" aria-label="Abrir Portal do Técnico"><ExternalLink size={17} /></a>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', gap: '6px', justifyContent: 'center' }}
                  onClick={async () => {
                    const tech = activeTechnicians.find(t => String(t.id) === String(portalTechnicianId));
                    const msg = `🚨 AVISO DE ACESSO AO PORTAL DO TÉCNICO - ATEM FIELD\nOlá ${tech?.name || 'Técnico'}! Aqui está o seu link de acesso individual:\n\n🔗 ${portalLink}\n\n(Válido por 72 horas)`;
                    await navigator.clipboard.writeText(msg);
                    setNotice(`Mensagem formatada para ${tech?.name} copiada para a área de transferência!`);
                  }}
                >
                  <MessageCircleMore size={15} /> Copiar mensagem formatada
                </button>
              </div>
            )}
            <div className="whatsapp-plan">
              <MessageCircleMore size={20} />
              <div>
                <strong>Envio por WhatsApp ou E-mail</strong>
                <p>Copie o link individual ou a mensagem formatada acima e envie diretamente para o técnico.</p>
              </div>
              <span>Cópia rápida</span>
            </div>
          </div>
        ) : (
          <div className="field-surface portal-access-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="field-section-heading">
              <div>
                <h2>Perfil conectado</h2>
                <p>Você está autenticado como <strong>{currentUser?.name}</strong>.</p>
              </div>
            </div>
            <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '16px', fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>📱 <strong>Telefone:</strong> {currentUser?.phone || 'Não cadastrado'}</div>
              <div>📧 <strong>E-mail:</strong> {currentUser?.email || 'Não cadastrado'}</div>
              <div>🔒 <strong>Permissões:</strong> Reserva restrita em nome próprio, retiradas e devoluções.</div>
            </div>
          </div>
        )}
      </section>

      <section className="field-surface reservations-overview">
        <div className="field-section-heading" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2>
              {isTechnician ? 'Minhas reservas em campo' : 'Lista de reservas'}
              <span className="field-count">{filteredReservations.length}</span>
            </h2>
            <p>Controle de retiradas, status e devoluções</p>
          </div>
          <div className="reservations-filters" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0 10px', minHeight: '40px' }}>
              <Search size={15} color="var(--text-muted)" />
              <input
                type="search"
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.82rem', color: 'var(--text-main)' }}
                placeholder="Buscar patrimônio, técnico ou cliente..."
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
              />
            </label>
            <select
              aria-label="Filtrar status"
              className="select-field"
              style={{ minHeight: '40px', padding: '6px 12px', fontSize: '0.8rem', width: 'auto' }}
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value)}
            >
              <option value="ACTIVE">Reservas ativas</option>
              <option value="ALL">Todos os status</option>
              <option value="Reservado">Reservado</option>
              <option value="Em Uso">Em uso</option>
              <option value="Devolvido">Devolvido</option>
            </select>
          </div>
        </div>

        {loadingReservations ? (
          <div className="operations-loading" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <LoaderCircle className="spin" size={24} /> Carregando reservas…
          </div>
        ) : !filteredReservations.length ? (
          <div className="field-empty" style={{ minHeight: '220px' }}>
            <PackageCheck size={28} />
            <h3>Nenhuma reserva encontrada</h3>
            <p>Não há reservas cadastradas para o filtro selecionado.</p>
          </div>
        ) : (
          <div className="field-table-scroll">
            <table className="field-table">
              <thead>
                <tr>
                  <th scope="col">Patrimônio / Padrão</th>
                  <th scope="col">Atendimento / Cliente</th>
                  <th scope="col">Responsável</th>
                  <th scope="col">Data</th>
                  <th scope="col">Status</th>
                  <th scope="col">Ações de Campo</th>
                  {isAdmin && <th scope="col">Gerenciamento</th>}
                </tr>
              </thead>
              <tbody>
                {filteredReservations.map(reservation => (
                  <tr key={reservation.id}>
                    <td>
                      <div className="field-asset">
                        <span className="field-asset-icon"><PackageCheck size={16} /></span>
                        <div>
                          <strong>{reservation.analyzer_name}</strong>
                          <code>{reservation.asset_tag}</code>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                        {reservation.operation_type === 'Chamado' ? (
                          <span style={{ background: '#ffedd5', color: '#c2410c', border: '1px solid #fed7aa', fontSize: '0.65rem', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>🚨 CHAMADO</span>
                        ) : reservation.operation_type === 'Calibração' ? (
                          <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '0.65rem', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>🔬 CALIBRAÇÃO</span>
                        ) : reservation.operation_type === 'Empréstimo' ? (
                          <span style={{ background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe', fontSize: '0.65rem', fontWeight: 800, padding: '1px 5px', borderRadius: '4px' }}>🤝 EMPRÉSTIMO</span>
                        ) : (
                          <span style={{ background: '#f1f5f9', color: '#475467', fontSize: '0.65rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px' }}>📋 ATENDIMENTO</span>
                        )}
                      </div>
                      <strong style={{ color: 'var(--text-main)', fontSize: '0.8rem' }}>{reservation.client_name}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{reservation.analyzer_type}</div>
                    </td>
                    <td>{reservation.technician_name}</td>
                    <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{formatDate(reservation.appointment_date || reservation.reserved_date)}</span></td>
                    <td>
                      <span className={`badge ${reservation.status === 'Em Uso' ? 'badge-warning' : reservation.status === 'Reservado' ? 'badge-purple' : reservation.status === 'Devolvido' ? 'badge-success' : 'badge-amber'}`}>
                        {reservation.status === 'Aguardando Aprovação' ? '⏳ Aguardando Aprovação' : reservation.status}
                      </span>
                    </td>
                    <td>
                      {reservation.status === 'Aguardando Aprovação' ? (
                        isAdmin ? (
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ background: '#16a34a', borderColor: '#16a34a', gap: '4px', fontSize: '0.75rem', padding: '4px 10px' }}
                            disabled={actionId === reservation.id}
                            onClick={() => handleApproveReservation(reservation.id)}
                          >
                            {actionId === reservation.id ? <LoaderCircle className="spin" size={13} /> : <><CheckCircle2 size={13} /> Aprovar Saída</>}
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600 }}>Pendente aprovação do Admin</span>
                        )
                      ) : ACTIVE_STATUSES.has(reservation.status) ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={actionId === reservation.id}
                          onClick={() => void updateReservationStatus(reservation)}
                        >
                          {actionId === reservation.id ? <LoaderCircle className="spin" size={15} /> : reservation.status === 'Reservado' ? 'Saída' : 'Devolver'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Concluída</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td data-label="Gerenciamento (Admin)">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEditReservation(reservation)}
                            title="Editar Reserva (Admin)"
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              borderRadius: '6px',
                              color: '#1d4ed8',
                              padding: '5px 8px',
                              cursor: 'pointer'
                            }}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteReservation(reservation.id)}
                            title="Apagar Reserva do Banco (Admin)"
                            style={{
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              color: '#dc2626',
                              padding: '5px 8px',
                              cursor: 'pointer'
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredReservations.length && <div className="operations-empty">Nenhuma reserva encontrada.</div>}
          </div>
        )}
      </section>

      {/* MODAL DE EDIÇÃO DE RESERVA (ADMIN) */}
      {isAdmin && editReservationModal && (
        <ModalOverlay onDismiss={() => { if (!saving) setEditReservationModal(null); }} role="dialog" aria-modal="true" aria-label="Editar reserva" style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '24px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                ✏️ Editar Reserva (Admin Master)
              </h3>
              <button type="button" onClick={() => setEditReservationModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '14px' }}>
              Padrão: <strong>{editReservationModal.asset_tag}</strong> ({editReservationModal.analyzer_name})
            </p>

            <form onSubmit={handleSaveEditReservation} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Técnico Atribuído</span>
                <select
                  className="select-field"
                  value={editResForm.technician_id}
                  onChange={e => setEditResForm({ ...editResForm, technician_id: e.target.value })}
                  required
                >
                  <option value="">Selecione o técnico</option>
                  {activeTechnicians.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Data da Reserva</span>
                <input
                  type="date"
                  className="input-field"
                  value={editResForm.reserved_date}
                  onChange={e => setEditResForm({ ...editResForm, reserved_date: e.target.value })}
                  required
                />
              </label>

              <label>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Status da Reserva</span>
                <select
                  className="select-field"
                  value={editResForm.status}
                  onChange={e => setEditResForm({ ...editResForm, status: e.target.value })}
                  required
                >
                  <option value="Reservado">Reservado</option>
                  <option value="Em Uso">Em Uso</option>
                  <option value="Devolvido">Devolvido</option>
                  <option value="Cancelado">Cancelado</option>
                </select>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <button type="button" onClick={() => setEditReservationModal(null)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Salvando...' : 'Salvar Alterações no Banco'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

export default OperationsAdminView;
