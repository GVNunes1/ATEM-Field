import { FormEvent, useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { safeFetchJson } from '../lib/api';
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MessageCircleMore,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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
}

const ACTIVE_STATUSES = new Set(['Reservado', 'Em Uso']);
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
  initialAppointmentId
}: OperationsAdminViewProps) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string>(
    initialAppointmentId ? String(initialAppointmentId) : ''
  );
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('');
  const [selectedAnalyzerIds, setSelectedAnalyzerIds] = useState<number[]>([]);
  const [analyzerSearch, setAnalyzerSearch] = useState('');
  const [checklist, setChecklist] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [searchTerm, setSearchTerm] = useState('');
  const [portalTechnicianId, setPortalTechnicianId] = useState('');
  const [portalLink, setPortalLink] = useState('');
  const [generatingLink, setGeneratingLink] = useState(false);

  useEffect(() => {
    if (initialAppointmentId) {
      setSelectedAppointmentId(String(initialAppointmentId));
    }
  }, [initialAppointmentId]);

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
      setSelectedTechnicianId('');
      setSelectedAnalyzerIds([]);
      setAnalyzerSearch('');
      return;
    }
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
    setSelectedAnalyzerIds([]);
    setAnalyzerSearch('');
    safeFetchJson(`/api/appointments/${selectedAppointment.id}/checklist`, { cache: 'no-store' })
      .then(data => setChecklist(data.success ? data : null))
      .catch(() => setChecklist(null));
  }, [selectedAppointment, activeTechnicians]);

  const availableAnalyzers = useMemo(() => {
    if (!selectedAppointment || isNonTechnicalAppointment(selectedAppointment)) return [];
    const conflicts = new Set(reservations
      .filter(reservation => reservation.reserved_date === selectedAppointment.appointment_date)
      .filter(reservation => ACTIVE_STATUSES.has(reservation.status))
      .filter(reservation => Number(reservation.appointment_id) !== Number(selectedAppointment.id))
      .map(reservation => reservation.analyzer_id));
    const alreadyReserved = new Set(reservations
      .filter(reservation => Number(reservation.appointment_id) === Number(selectedAppointment.id))
      .filter(reservation => ACTIVE_STATUSES.has(reservation.status))
      .map(reservation => reservation.analyzer_id));
    return analyzers
      .filter(analyzer => analyzer.status !== 'Em Uso' && !/manuten|indispon|baixado/i.test(analyzer.status || ''))
      .filter(analyzer => !conflicts.has(analyzer.id) && !alreadyReserved.has(analyzer.id))
      .sort((left, right) => String(left.asset_tag).localeCompare(String(right.asset_tag), 'pt-BR', { numeric: true }));
  }, [analyzers, reservations, selectedAppointment]);

  const selectedAnalyzers = useMemo(() => selectedAnalyzerIds
    .map(id => availableAnalyzers.find(analyzer => Number(analyzer.id) === id))
    .filter(Boolean), [availableAnalyzers, selectedAnalyzerIds]);

  const filteredAvailableAnalyzers = useMemo(() => {
    const query = analyzerSearch.trim().toLocaleLowerCase('pt-BR');
    return availableAnalyzers
      .filter(analyzer => !selectedAnalyzerIds.includes(Number(analyzer.id)))
      .filter(analyzer => !query || [analyzer.asset_tag, analyzer.name, analyzer.type, analyzer.brand_model]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)));
  }, [analyzerSearch, availableAnalyzers, selectedAnalyzerIds]);

  const filteredReservations = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase('pt-BR');
    return reservations
      .filter(reservation => statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? ACTIVE_STATUSES.has(reservation.status) : reservation.status === statusFilter))
      .filter(reservation => !query || [reservation.asset_tag, reservation.analyzer_name, reservation.technician_name, reservation.client_name]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)))
      .sort((left, right) => String(right.reserved_date || '').localeCompare(String(left.reserved_date || '')) || Number(right.id) - Number(left.id));
  }, [reservations, searchTerm, statusFilter]);

  const metrics = useMemo(() => {
    const current = todayKey();
    const inSevenDays = new Date(`${current}T12:00:00`);
    inSevenDays.setDate(inSevenDays.getDate() + 7);
    const limit = inSevenDays.toISOString().slice(0, 10);
    return {
      active: reservations.filter(reservation => ACTIVE_STATUSES.has(reservation.status)).length,
      inUse: reservations.filter(reservation => reservation.status === 'Em Uso').length,
      available: analyzers.filter(analyzer => analyzer.status === 'Disponível').length,
      weekAppointments: upcomingAppointments.filter(appointment => appointment.appointment_date <= limit).length
    };
  }, [analyzers, reservations, upcomingAppointments]);

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
    if (!selectedAppointmentId || !selectedTechnicianId || !selectedAnalyzerIds.length) return;
    setSaving(true); setError(''); setNotice('');
    let completed = 0;
    try {
      for (const analyzerId of selectedAnalyzerIds) {
        const data = await safeFetchJson('/api/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: Number(selectedAppointmentId),
            technician_id: Number(selectedTechnicianId),
            analyzer_id: analyzerId,
            notes: 'Reserva criada pelo painel administrativo'
          })
        });
        if (!data.success) throw new Error(data.error || 'Não foi possível criar a reserva.');
        completed += 1;
      }
      setNotice(`${completed} ${completed === 1 ? 'padrão reservado' : 'padrões reservados'} com sucesso.`);
      setSelectedAnalyzerIds([]);
      setAnalyzerSearch('');
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (requestError) {
      if (completed) await Promise.all([loadReservations(), onRefresh()]);
      const message = requestError instanceof Error ? requestError.message : 'Falha ao criar reserva.';
      setError(completed ? `${completed} reserva(s) concluída(s). O restante não foi salvo: ${message}` : message);
    } finally {
      setSaving(false);
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
      setError(requestError instanceof Error ? requestError.message : 'Falha ao gerar o link.');
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <div className="operations-admin animate-fade-in">
      <section className="operations-hero">
        <div><span className="eyebrow"><ShieldCheck size={14} /> CENTRAL ADMINISTRATIVA</span><h2>Reservas e operação de campo</h2><p>Reserve patrimônios para a equipe e acompanhe agenda, disponibilidade e movimentações em um único painel.</p></div>
        <button className="btn btn-secondary" onClick={() => void Promise.all([loadReservations(), onRefresh()])}><RefreshCw size={17} /> Atualizar visão</button>
      </section>

      {(error || notice) && <div className={`operations-notice ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <section className="operations-metrics" aria-label="Resumo operacional">
        <article><span><PackageCheck size={20} /></span><div><strong>{metrics.active}</strong><small>reservas ativas</small></div></article>
        <article><span><Activity size={20} /></span><div><strong>{metrics.inUse}</strong><small>em campo</small></div></article>
        <article><span><Wrench size={20} /></span><div><strong>{metrics.available}</strong><small>padrões disponíveis</small></div></article>
        <article><span><CalendarDays size={20} /></span><div><strong>{metrics.weekAppointments}</strong><small>atendimentos em 7 dias</small></div></article>
      </section>

      <section className="operations-primary-grid">
        <form className="glass-panel reservation-form" onSubmit={createReservation}>
          <div className="operations-section-heading"><span><PackageCheck size={19} /></span><div><h3>Nova reserva administrativa</h3><p>Vincule atendimento, técnico e patrimônio.</p></div></div>
          <label><span>Atendimento (Serviços Técnicos)</span><select value={selectedAppointmentId} onChange={event => setSelectedAppointmentId(event.target.value)} required><option value="">Selecione o atendimento</option>{upcomingTechnicalAppointments.map(appointment => <option key={appointment.id} value={appointment.id}>{formatDate(appointment.appointment_date)} · {appointment.appointment_time || '--:--'} · {appointment.client_name || appointment.title}</option>)}</select></label>
          <label><span>Técnico responsável</span><select value={selectedTechnicianId} onChange={event => setSelectedTechnicianId(event.target.value)} required><option value="">Selecione</option>{activeTechnicians.map(technician => <option key={technician.id} value={technician.id}>{technician.name}</option>)}</select></label>
          {selectedAppointment && (
            isNonTechnicalAppointment(selectedAppointment) ? (
              <div className="operations-notice is-error" style={{ margin: '0.5rem 0' }}>
                Agendamentos não técnicos (Sobreaviso, Exame, Aniversário, Revisão, Treinamento, etc.) não permitem reserva de padrões.
              </div>
            ) : (
              <div className="reservation-form__context"><CalendarDays size={15} /><span>{formatDate(selectedAppointment.appointment_date)} às {selectedAppointment.appointment_time || '--:--'}</span><strong>{checklist?.requiredAnalyzerTypes?.length ? `${checklist.requiredAnalyzerTypes.length} tipo(s) exigido(s)` : 'Sem restrição de tipo'}</strong></div>
            )
          )}
          <fieldset className="analyzer-picker" disabled={!selectedAppointment || saving}>
            <legend>Selecionar padrões</legend>
            <p>Pesquise por patrimônio, nome, tipo ou modelo e adicione quantos forem necessários.</p>
            <label className="analyzer-picker__search">
              <Search size={17} aria-hidden="true" />
              <input type="search" aria-label="Buscar padrão disponível" placeholder={selectedAppointment ? 'Buscar padrão disponível' : 'Escolha um atendimento primeiro'} value={analyzerSearch} onChange={event => setAnalyzerSearch(event.target.value)} />
              {analyzerSearch && <button type="button" onClick={() => setAnalyzerSearch('')} aria-label="Limpar pesquisa"><X size={16} /></button>}
            </label>
            <div className="analyzer-picker__results" role="list" aria-label="Padrões disponíveis">
              {filteredAvailableAnalyzers.map(analyzer => (
                <article key={analyzer.id} className="analyzer-picker__item" role="listitem">
                  <div><strong>{analyzer.asset_tag}</strong><span>{analyzer.name || 'Padrão sem nome'}</span><small>{analyzer.type || 'Sem tipo'}{analyzer.brand_model ? ` · ${analyzer.brand_model}` : ''}</small></div>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSelectedAnalyzerIds(ids => [...ids, Number(analyzer.id)])}><Plus size={15} /> Adicionar</button>
                </article>
              ))}
              {selectedAppointment && !filteredAvailableAnalyzers.length && <div className="analyzer-picker__empty">Nenhum padrão disponível corresponde à busca.</div>}
            </div>
          </fieldset>
          <section className="selected-analyzers" aria-live="polite">
            <div className="selected-analyzers__head"><div><strong>Padrões adicionados</strong><span>Revise os itens antes de confirmar.</span></div><b>{selectedAnalyzers.length}</b></div>
            <div className="selected-analyzers__list">
              {selectedAnalyzers.map((analyzer: any) => (
                <article key={analyzer.id}>
                  <div><strong>{analyzer.asset_tag}</strong><span>{analyzer.name || 'Padrão sem nome'} · {analyzer.type || 'Sem tipo'}</span></div>
                  <button type="button" onClick={() => setSelectedAnalyzerIds(ids => ids.filter(id => id !== Number(analyzer.id)))} aria-label={`Remover ${analyzer.asset_tag}`}><X size={16} /><span>Remover</span></button>
                </article>
              ))}
              {!selectedAnalyzers.length && <div className="selected-analyzers__empty">Nenhum padrão adicionado.</div>}
            </div>
          </section>
          <button className="btn btn-primary" disabled={saving || !selectedAnalyzerIds.length}>{saving ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}{saving ? `Reservando ${selectedAnalyzerIds.length} item(ns)…` : selectedAnalyzerIds.length ? `Confirmar ${selectedAnalyzerIds.length} ${selectedAnalyzerIds.length === 1 ? 'reserva' : 'reservas'}` : 'Adicione ao menos um padrão'}</button>
        </form>

        <div className="glass-panel portal-access-card">
          <div className="operations-section-heading"><span><UserRound size={19} /></span><div><h3>Acesso do técnico</h3><p>Gere e copie o link individual de acesso ao portal do técnico.</p></div></div>
          <label><span>Técnico</span><select value={portalTechnicianId} onChange={event => { setPortalTechnicianId(event.target.value); setPortalLink(''); }}><option value="">Selecione o técnico</option>{activeTechnicians.map(technician => <option key={technician.id} value={technician.id}>{technician.name} · {hasUsablePhone(technician.phone) ? technician.phone : 'celular pendente'}</option>)}</select></label>
          <button className="btn btn-primary" type="button" disabled={!portalTechnicianId || generatingLink} onClick={() => void generatePortalLink()}>{generatingLink ? <LoaderCircle className="spin" size={17} /> : <Clipboard size={17} />}{generatingLink ? 'Gerando…' : 'Gerar e copiar link'}</button>
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
          <div className="whatsapp-plan"><MessageCircleMore size={20} /><div><strong>Envio por WhatsApp ou E-mail</strong><p>Copie o link individual ou a mensagem formatada acima e envie diretamente para o técnico.</p></div><span>Cópia rápida</span></div>
        </div>
      </section>

      <section className="operations-snapshot-grid" aria-label="Overview da agenda e dos analisadores">
        <article className="glass-panel operations-snapshot">
          <div className="operations-section-heading"><span><CalendarDays size={19} /></span><div><h3>Próximos atendimentos</h3><p>Agenda operacional a partir de hoje.</p></div></div>
          <div className="operations-agenda-list">
            {upcomingAppointments.slice(0, 6).map(appointment => (
              <div key={appointment.id} className="operations-agenda-item">
                <time><strong>{String(appointment.appointment_date || '').slice(8, 10)}</strong><span>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(`${appointment.appointment_date}T12:00:00`)).replace('.', '')}</span></time>
                <div><strong>{appointment.client_name || appointment.title || 'Atendimento'}</strong><span>{appointment.appointment_time || 'Dia inteiro'} · {appointment.technician_names || appointment.technician_name || 'Equipe não definida'}</span></div>
                <span>{appointment.reservations?.filter((reservation: any) => ACTIVE_STATUSES.has(reservation.status)).length || 0} reserva(s)</span>
              </div>
            ))}
            {!upcomingAppointments.length && <div className="operations-empty">Nenhum atendimento futuro sincronizado.</div>}
          </div>
        </article>

        <article className="glass-panel operations-snapshot">
          <div className="operations-section-heading"><span><Wrench size={19} /></span><div><h3>Panorama dos analisadores</h3><p>Distribuição atual dos patrimônios importados.</p></div></div>
          <div className="analyzer-status-grid">
            {analyzerOverview.statuses.map(item => <div key={item.label} className={`analyzer-status analyzer-status--${item.tone}`}><strong>{item.value}</strong><span>{item.label}</span></div>)}
          </div>
          <div className="analyzer-types">
            <strong>Principais tipos</strong>
            {analyzerOverview.types.map(([type, count]) => <div key={type}><span title={type}>{type}</span><strong>{count}</strong></div>)}
            {!analyzerOverview.types.length && <p>Nenhum patrimônio cadastrado.</p>}
          </div>
        </article>
      </section>

      <section className="glass-panel reservations-overview">
        <div className="reservations-overview__head"><div className="operations-section-heading"><span><Clock3 size={19} /></span><div><h3>Overview das reservas</h3><p>{filteredReservations.length} registro(s) nos filtros atuais.</p></div></div><div className="reservations-filters"><label><Search size={16} /><input type="search" placeholder="Patrimônio, técnico ou cliente" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} /></label><select aria-label="Filtrar status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="ACTIVE">Reservas ativas</option><option value="ALL">Todos os status</option><option value="Reservado">Reservado</option><option value="Em Uso">Em uso</option><option value="Devolvido">Devolvido</option></select></div></div>
        {loadingReservations ? <div className="operations-loading"><LoaderCircle className="spin" size={24} /> Carregando reservas…</div> : (
          <div className="reservations-table-wrap"><table><thead><tr><th>Patrimônio</th><th>Atendimento</th><th>Técnico</th><th>Data</th><th>Status</th><th>Ação</th></tr></thead><tbody>{filteredReservations.map(reservation => <tr key={reservation.id}><td data-label="Patrimônio"><strong className="asset-tag">{reservation.asset_tag}</strong><small>{reservation.analyzer_name}</small></td><td data-label="Atendimento"><strong>{reservation.client_name}</strong><small>{reservation.analyzer_type}</small></td><td data-label="Técnico">{reservation.technician_name}</td><td data-label="Data">{formatDate(reservation.appointment_date || reservation.reserved_date)}</td><td data-label="Status"><span className={`reservation-status reservation-status--${String(reservation.status).toLowerCase().replace(/\s/g, '-')}`}>{reservation.status}</span></td><td data-label="Ação">{ACTIVE_STATUSES.has(reservation.status) ? <button className="btn btn-secondary btn-sm" disabled={actionId === reservation.id} onClick={() => void updateReservationStatus(reservation)}>{actionId === reservation.id ? <LoaderCircle className="spin" size={15} /> : reservation.status === 'Reservado' ? 'Saída' : 'Devolver'}</button> : <span className="reservation-closed">Concluída</span>}</td></tr>)}</tbody></table>{!filteredReservations.length && <div className="operations-empty">Nenhuma reserva encontrada.</div>}</div>
        )}
      </section>
    </div>
  );
}
