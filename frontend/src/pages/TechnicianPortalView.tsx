import { useEffect, useMemo, useState } from 'react';
import { isNonTechnicalAppointment } from '../lib/appointmentUtils';
import { apiUrl } from '../lib/api';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  LoaderCircle,
  MapPin,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  UserRound
} from 'lucide-react';
import './TechnicianPortalView.css';

const ACCESS_STORAGE_KEY = 'atem.technician.portal.access';

function recoverAccessToken() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const receivedToken = hash.get('access');
  if (receivedToken) {
    sessionStorage.setItem(ACCESS_STORAGE_KEY, receivedToken);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return receivedToken;
  }
  return sessionStorage.getItem(ACCESS_STORAGE_KEY) || '';
}

function formatDate(value: string) {
  if (!value) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '');
}

function formatFullDate(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    .format(new Date(`${value}T12:00:00`));
}

function parametersToList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => typeof item === 'string' ? item : JSON.stringify(item));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      typeof item === 'boolean' ? key : `${key}: ${String(item)}`
    );
  }
  if (typeof value === 'string') {
    return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

export function TechnicianPortalView() {
  const accessToken = useMemo(recoverAccessToken, []);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reservingKey, setReservingKey] = useState('');
  const [returningId, setReturningId] = useState<number | null>(null);
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);
  const [rescheduleDraft, setRescheduleDraft] = useState<{ reservationId: number; targetAppointmentId: string } | null>(null);

  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });
    const rawBody = await response.text();
    let body: any;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      throw new Error(`O servidor respondeu em formato inválido (HTTP ${response.status}).`);
    }
    if (!response.ok || !body?.success) throw new Error(body?.error || `Falha HTTP ${response.status}`);
    return body;
  };

  const loadDashboard = async (silent = false) => {
    if (!accessToken) {
      setError('Link individual ausente. Solicite um novo acesso ao supervisor.');
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    try {
      setDashboard(await request('/api/technician-portal?days=45'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar o painel.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const appointment of dashboard?.appointments || []) {
      const date = appointment.appointment_date || 'Sem data';
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(appointment);
    }
    return [...groups.entries()];
  }, [dashboard]);

  const reserveAnalyzer = async (appointment: any, requirement: any, analyzer: any) => {
    const confirmed = window.confirm(
      `Reservar o patrimônio ${analyzer.asset_tag} (${analyzer.name}) para ${appointment.client_name || appointment.title}?`
    );
    if (!confirmed) return;

    const key = `${appointment.id}:${analyzer.id}`;
    setReservingKey(key);
    setNotice('');
    setError('');
    try {
      const result = await request('/api/technician-portal/reservations', {
        method: 'POST',
        body: JSON.stringify({ appointment_id: appointment.id, analyzer_id: analyzer.id })
      });
      setNotice(result.message);
      await loadDashboard(true);
    } catch (reservationError) {
      setError(reservationError instanceof Error ? reservationError.message : `Não foi possível reservar ${requirement.analyzerType}.`);
    } finally {
      setReservingKey('');
    }
  };

  const returnAnalyzer = async (appointment: any, reservation: any) => {
    const analyzer = reservation.analyzer;
    const confirmed = window.confirm(
      `Confirmar a devolução do patrimônio ${analyzer?.asset_tag || ''} (${analyzer?.name || 'padrão'})?`
    );
    if (!confirmed) return;

    setReturningId(reservation.id);
    setNotice('');
    setError('');
    try {
      const result = await request(`/api/technician-portal/reservations/${reservation.id}/checkin`, {
        method: 'POST'
      });
      setNotice(`${result.message} Atendimento: ${appointment.client_name || appointment.title}.`);
      await loadDashboard(true);
    } catch (returnError) {
      setError(returnError instanceof Error
        ? returnError.message
        : 'Não foi possível registrar a devolução. Atualize o painel e tente novamente.');
    } finally {
      setReturningId(null);
    }
  };

  const rescheduleAnalyzer = async (appointment: any, reservation: any) => {
    const targetAppointmentId = Number(rescheduleDraft?.targetAppointmentId);
    const target = reservation.rescheduleOptions?.find((item: any) => item.id === targetAppointmentId);
    if (!target) {
      setError('Selecione um próximo atendimento válido.');
      return;
    }
    const confirmed = window.confirm(
      `Mover o patrimônio ${reservation.analyzer?.asset_tag || ''} para ${target.client_name || target.title}, em ${formatDate(target.appointment_date)}? O padrão continuará com você.`
    );
    if (!confirmed) return;

    setReschedulingId(reservation.id);
    setNotice('');
    setError('');
    try {
      const result = await request(`/api/technician-portal/reservations/${reservation.id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ appointment_id: targetAppointmentId })
      });
      setNotice(`${result.message} Novo atendimento: ${target.client_name || target.title}.`);
      setRescheduleDraft(null);
      await loadDashboard(true);
    } catch (rescheduleError) {
      setError(rescheduleError instanceof Error
        ? rescheduleError.message
        : `Não foi possível mover o padrão de ${appointment.client_name || appointment.title}.`);
    } finally {
      setReschedulingId(null);
    }
  };

  if (loading) {
    return (
      <main className="tg-dashboard tg-dashboard--centered">
        <div className="tg-loading-card">
          <LoaderCircle className="tg-spin" size={34} />
          <strong>Carregando seu painel</strong>
          <span>Confirmando vínculo e buscando atendimentos no Supabase.</span>
        </div>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="tg-dashboard tg-dashboard--centered">
        <div className="tg-access-error">
          <AlertCircle size={38} />
          <h1>Acesso ao painel indisponível</h1>
          <p>{error}</p>
          <a href="/" className="tg-primary-link">Ir para o ATEM Field</a>
        </div>
      </main>
    );
  }

  return (
    <main className="tg-dashboard">
      <header className="tg-dashboard-hero">
        <div className="tg-dashboard-hero__brand">
          <span><Stethoscope size={20} /></span>
          <div>
            <small>ATEM FIELD</small>
            <strong>Painel técnico</strong>
          </div>
          <ShieldCheck className="tg-dashboard-hero__shield" size={21} />
        </div>
        <div className="tg-dashboard-hero__welcome">
          <span className="tg-dashboard-avatar"><UserRound size={23} /></span>
          <div>
            <small>Agenda vinculada</small>
            <h1>{dashboard.technician.name}</h1>
            <p>{dashboard.technician.role}</p>
          </div>
          <button aria-label="Atualizar painel" onClick={() => void loadDashboard()}><RefreshCw size={18} /></button>
        </div>
        <div className="tg-dashboard-summary">
          <div><strong>{dashboard.summary.appointments}</strong><span>atendimentos</span></div>
          <div><strong>{dashboard.summary.activeReservations ?? dashboard.summary.completedReservations}</strong><span>padrões reservados</span></div>
          <div className={dashboard.summary.pendingReservations ? 'is-pending' : 'is-complete'}>
            <strong>{dashboard.summary.pendingReservations}</strong><span>pendentes</span>
          </div>
        </div>
      </header>

      <section className="tg-dashboard-content">
        <div className="tg-dashboard-intro">
          <div>
            <span className="tg-eyebrow"><CalendarDays size={14} /> PRÓXIMOS 45 DIAS</span>
            <h2>Atendimentos e reservas</h2>
            <p>Abra cada visita para consultar os padrões e separar o patrimônio.</p>
          </div>
          <span className="tg-secure-pill"><ShieldCheck size={14} /> Acesso individual</span>
        </div>

        {notice && <div className="tg-notice tg-notice--success" role="status" aria-live="polite"><CheckCircle2 size={18} /> {notice}</div>}
        {error && <div className="tg-notice tg-notice--error" role="alert"><AlertCircle size={18} /> {error}</div>}

        {dateGroups.length === 0 ? (
          <div className="tg-empty-state">
            <CalendarDays size={32} />
            <h3>Nenhum atendimento futuro</h3>
            <p>Não há visitas vinculadas ao seu cadastro nos próximos 45 dias.</p>
          </div>
        ) : dateGroups.map(([date, appointments], groupIndex) => (
          <section className="tg-date-group" key={date}>
            <div className="tg-date-group__title">
              <span>{formatDate(date)}</span>
              <small>{formatFullDate(date)}</small>
            </div>

            {appointments.map((appointment: any, appointmentIndex: number) => {
              const isNonTechnical = appointment.isTechnicalService === false || isNonTechnicalAppointment(appointment);
              const progress = appointment.reservationProgress || { total: 0, completed: 0 };
              const ready = isNonTechnical || progress.total === 0 || progress.completed === progress.total;
              return (
                <details className="tg-appointment" key={appointment.id} open={groupIndex === 0 && appointmentIndex === 0}>
                  <summary>
                    <div className="tg-appointment-time">
                      <Clock3 size={15} /> {appointment.appointment_time || '--:--'}
                    </div>
                    <div className="tg-appointment-identity">
                      <strong>{appointment.client_name || appointment.title}</strong>
                      <span>{appointment.title}</span>
                    </div>
                    <span className={`tg-progress-pill ${ready ? 'is-ready' : 'is-pending'}`}>
                      {isNonTechnical ? <Check size={13} /> : ready ? <Check size={13} /> : <PackageCheck size={13} />}
                      {isNonTechnical ? 'Não técnico' : `${progress.completed}/${progress.total}`}
                    </span>
                    <ChevronDown className="tg-appointment-chevron" size={19} />
                  </summary>

                  <div className="tg-appointment-body">
                    <div className="tg-address-row">
                      <MapPin size={17} />
                      <span>{appointment.client_address || 'Endereço não informado'}</span>
                      {appointment.client_address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.client_address)}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir endereço no mapa"
                        ><ArrowUpRight size={17} /></a>
                      )}
                    </div>

                    <section className="tg-detail-section">
                      <div className="tg-section-heading">
                        <span><Stethoscope size={17} /></span>
                        <div><strong>Equipamentos no cliente</strong><small>{appointment.equipments.length} item(ns)</small></div>
                      </div>
                      <div className="tg-equipment-list">
                        {appointment.equipments.length ? appointment.equipments.map((equipment: any) => (
                          <div key={equipment.id}>
                            <span>{equipment.category_name}</span>
                            <strong>{equipment.model || 'Modelo não informado'}</strong>
                            <small>S/N {equipment.serial_number || 'não informado'}{equipment.sector ? ` · ${equipment.sector}` : ''}</small>
                          </div>
                        )) : <p className="tg-muted-copy">Nenhum equipamento detalhado neste atendimento.</p>}
                      </div>
                    </section>

                    <section className="tg-detail-section">
                      <div className="tg-section-heading">
                        <span><ClipboardCheck size={17} /></span>
                        <div><strong>Padrões e parâmetros</strong><small>Checklist exigido para a visita</small></div>
                      </div>
                      <div className="tg-template-list">
                        {appointment.testTemplates.length ? appointment.testTemplates.map((template: any) => {
                          const parameters = parametersToList(template.required_parameters);
                          return (
                            <article key={template.id}>
                              <div>
                                <span>{template.category_name}{Number(template.is_mandatory) === 0 ? ' · CONDICIONAL' : ''}</span>
                                <strong>{template.name}</strong>
                                <small><FlaskConical size={12} /> {template.analyzer_type}</small>
                              </div>
                              {parameters.length > 0 && (
                                <ul>{parameters.map((parameter: string, index: number) => <li key={`${parameter}-${index}`}>{parameter}</li>)}</ul>
                              )}
                            </article>
                          );
                        }) : <p className="tg-muted-copy">{isNonTechnical ? 'Agendamento administrativo / médico não requer checklist técnico.' : 'Nenhum padrão configurado para as categorias deste atendimento.'}</p>}
                      </div>
                    </section>

                    {isNonTechnical ? (
                      <section className="tg-detail-section tg-reservation-section">
                        <div className="tg-section-heading">
                          <span><PackageCheck size={17} /></span>
                          <div><strong>Serviço Administrativo / Não Técnico</strong><small>Sem reserva de padrões</small></div>
                        </div>
                        <p className="tg-muted-copy" style={{ padding: '0.5rem 0' }}>
                          Agendamentos do tipo Escala de Sobreaviso ou Exame Periódico não são serviços técnicos e não exigem a reserva de analisadores.
                        </p>
                      </section>
                    ) : (
                      <section className="tg-detail-section tg-reservation-section">
                        <div className="tg-section-heading">
                          <span><PackageCheck size={17} /></span>
                          <div><strong>Reservar patrimônios</strong><small>Adicione quantos padrões forem necessários</small></div>
                        </div>
                      <div className="tg-requirement-list">
                        {appointment.analyzerRequirements.length ? appointment.analyzerRequirements.map((requirement: any) => {
                          const existingReservations = requirement.existingReservations
                            || (requirement.existingReservation ? [requirement.existingReservation] : []);
                          return (
                            <article className="tg-requirement" key={requirement.analyzerType}>
                              <div className="tg-requirement__head">
                                <div>
                                  <small>{requirement.isMandatory === false ? 'PADRÃO CONDICIONAL' : 'PADRÃO EXIGIDO'}</small>
                                  <strong>{requirement.analyzerType}</strong>
                                </div>
                                {existingReservations.length > 0
                                  ? <span className="tg-reserved-badge"><CheckCircle2 size={14} /> {existingReservations.length} reservado(s)</span>
                                  : requirement.isMandatory === false
                                    ? <span className="tg-optional-badge">Opcional</span>
                                    : <span className="tg-pending-badge">Pendente</span>}
                              </div>

                              {existingReservations.length > 0 && (
                                <div className="tg-reserved-assets">
                                  {existingReservations.map((reservation: any) => {
                                    const rescheduleOptions = reservation.rescheduleOptions || [];
                                    const draftOpen = rescheduleDraft?.reservationId === reservation.id;
                                    const anyReservationAction = returningId !== null || reschedulingId !== null || Boolean(reservingKey);
                                    return (
                                      <div className="tg-reserved-asset-wrapper" key={reservation.id}>
                                        <div className="tg-reserved-asset">
                                          <span><PackageCheck size={19} /></span>
                                          <div>
                                            <strong>{reservation.analyzer?.asset_tag}</strong>
                                            <small>{reservation.analyzer?.name}</small>
                                          </div>
                                          <div className="tg-reserved-asset__actions">
                                            <em>{reservation.status}</em>
                                            {reservation.canReturn ? (
                                              <div className="tg-reserved-asset__buttons">
                                                {reservation.canReschedule && rescheduleOptions.length > 0 && (
                                                  <button
                                                    className="is-reschedule"
                                                    type="button"
                                                    aria-expanded={draftOpen}
                                                    aria-controls={`reschedule-${reservation.id}`}
                                                    disabled={anyReservationAction}
                                                    onClick={() => setRescheduleDraft(draftOpen
                                                      ? null
                                                      : { reservationId: reservation.id, targetAppointmentId: '' })}
                                                  >
                                                    <CalendarClock size={14} /> Reagendar
                                                  </button>
                                                )}
                                                <button
                                                  className="is-return"
                                                  type="button"
                                                  aria-label={`Devolver patrimônio ${reservation.analyzer?.asset_tag || ''}`}
                                                  aria-busy={returningId === reservation.id}
                                                  disabled={anyReservationAction}
                                                  onClick={() => void returnAnalyzer(appointment, reservation)}
                                                >
                                                  {returningId === reservation.id
                                                    ? <LoaderCircle className="tg-spin" size={15} />
                                                    : <><RotateCcw size={14} /> Devolver</>}
                                                </button>
                                              </div>
                                            ) : <small className="tg-reserved-owner">Reserva da equipe</small>}
                                          </div>
                                        </div>

                                        {draftOpen && (
                                          <form
                                            id={`reschedule-${reservation.id}`}
                                            className="tg-reschedule-form"
                                            onSubmit={event => { event.preventDefault(); void rescheduleAnalyzer(appointment, reservation); }}
                                          >
                                            <label htmlFor={`reschedule-target-${reservation.id}`}>Próximo atendimento compatível</label>
                                            <select
                                              id={`reschedule-target-${reservation.id}`}
                                              value={rescheduleDraft?.targetAppointmentId || ''}
                                              required
                                              onChange={event => setRescheduleDraft({
                                                reservationId: reservation.id,
                                                targetAppointmentId: event.target.value
                                              })}
                                            >
                                              <option value="">Selecione o atendimento</option>
                                              {rescheduleOptions.map((target: any) => (
                                                <option key={target.id} value={target.id}>
                                                  {formatDate(target.appointment_date)} · {target.appointment_time || '--:--'} · {target.client_name || target.title}
                                                </option>
                                              ))}
                                            </select>
                                            <p>O patrimônio continuará com você; não será registrada devolução.</p>
                                            <div>
                                              <button type="button" onClick={() => setRescheduleDraft(null)}>Cancelar</button>
                                              <button
                                                className="is-confirm"
                                                type="submit"
                                                aria-busy={reschedulingId === reservation.id}
                                                disabled={!rescheduleDraft?.targetAppointmentId || reschedulingId !== null}
                                              >
                                                {reschedulingId === reservation.id
                                                  ? <LoaderCircle className="tg-spin" size={15} />
                                                  : <><CalendarClock size={14} /> Confirmar</>}
                                              </button>
                                            </div>
                                          </form>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              <div className="tg-analyzer-options">
                                {requirement.availableAnalyzers.length ? requirement.availableAnalyzers.map((analyzer: any) => {
                                  const reservationKey = `${appointment.id}:${analyzer.id}`;
                                  return (
                                    <button
                                      key={analyzer.id}
                                      type="button"
                                      aria-busy={reservingKey === reservationKey}
                                      disabled={Boolean(reservingKey) || returningId !== null || reschedulingId !== null}
                                      onClick={() => void reserveAnalyzer(appointment, requirement, analyzer)}
                                    >
                                      <span><strong>{analyzer.asset_tag}</strong><small>{analyzer.name}</small></span>
                                      <em>{reservingKey === reservationKey ? <LoaderCircle className="tg-spin" size={17} /> : 'Reservar'}</em>
                                    </button>
                                  );
                                }) : <p className="tg-no-assets">Nenhum outro patrimônio compatível está disponível nesta data.</p>}
                              </div>
                            </article>
                          );
                        }) : <p className="tg-muted-copy">Este atendimento não exige analisadores configurados.</p>}
                      </div>
                    </section>
                    )}
                  </div>
                </details>
              );
            })}
          </section>
        ))}
      </section>

      <footer className="tg-dashboard-footer">
        <ShieldCheck size={15} /> Acesso individual de {dashboard.technician.name} · link temporário e protegido
      </footer>
    </main>
  );
}
