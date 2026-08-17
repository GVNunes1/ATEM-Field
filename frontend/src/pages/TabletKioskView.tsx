import React, { useEffect, useMemo, useState } from 'react';
import { safeFetchJson } from '../lib/api';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Delete,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  Undo2,
  UserCheck,
  UserRound,
  UsersRound,
  X
} from 'lucide-react';
import './TabletKioskView.css';

interface TabletKioskViewProps {
  technicians: any[];
  appointments: any[];
  analyzers: any[];
  onRefresh: () => Promise<void>;
  onExitKiosk?: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const TabletKioskView: React.FC<TabletKioskViewProps> = ({
  technicians,
  appointments,
  analyzers,
  onRefresh,
  onExitKiosk
}) => {
  const [selectedTech, setSelectedTech] = useState<any | null>(null);
  const [techSearch, setTechSearch] = useState('');
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [activeTab, setActiveTab] = useState<'agenda' | 'checkout' | 'checkin'>('agenda');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Estado do Modal de Autenticação por PIN no Totem
  const [pinPromptTech, setPinPromptTech] = useState<any | null>(null);
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');

  // Modal para reservar padrão
  const [reserveModalAppt, setReserveModalAppt] = useState<any | null>(null);
  const [modalSelectedAnalyzerIds, setModalSelectedAnalyzerIds] = useState<number[]>([]);
  const [modalSearchAnalyzer, setModalSearchAnalyzer] = useState('');
  const [isSubmittingReservation, setIsSubmittingReservation] = useState(false);

  // Relógio do Totem
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Timer de inatividade (auto-logout em 90s se estiver dentro de um perfil de técnico)
  useEffect(() => {
    if (!selectedTech) return;
    let timeoutId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setSelectedTech(null);
        setFeedbackNotice('Sessão encerrada por inatividade.');
      }, 90000);
    };

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [selectedTech]);

  // Carregar reservas
  const loadReservations = async () => {
    setLoadingReservations(true);
    try {
      const data = await safeFetchJson('/api/reservations', { cache: 'no-store' });
      if (data.success) {
        setReservations(data.reservations || []);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingReservations(false);
    }
  };

  useEffect(() => {
    void loadReservations();
  }, []);

  // Filtrar técnicos ativos
  const activeTechnicians = useMemo(() => {
    return (technicians || [])
      .filter(t => t.status === 'Ativo')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [technicians]);

  // Filtrar técnicos pela busca
  const filteredTechnicians = useMemo(() => {
    const query = techSearch.trim().toLowerCase();
    if (!query) return activeTechnicians;
    return activeTechnicians.filter(t => t.name.toLowerCase().includes(query));
  }, [activeTechnicians, techSearch]);

  // Atendimentos do técnico selecionado
  const techAppointments = useMemo(() => {
    if (!selectedTech) return [];
    const techName = selectedTech.name.toLowerCase();
    const techId = Number(selectedTech.id);
    const today = todayKey();

    return (appointments || [])
      .filter(appt => {
        if (appt.status && String(appt.status).toLowerCase() === 'cancelado') return false;
        if (appt.appointment_date < today) return false;

        const matchesId = Number(appt.technician_id) === techId;
        const matchesName = appt.technician_names && appt.technician_names.toLowerCase().includes(techName);
        const matchesList = Array.isArray(appt.technicians) && appt.technicians.some((t: any) => Number(t.id) === techId);
        return matchesId || matchesName || matchesList;
      })
      .sort((a, b) => String(a.appointment_date).localeCompare(String(b.appointment_date)) || String(a.appointment_time || '').localeCompare(String(b.appointment_time || '')));
  }, [selectedTech, appointments]);

  // Reservas pendentes de saída para o técnico (Status = 'Reservado')
  const techReadyForCheckout = useMemo(() => {
    if (!selectedTech) return [];
    const techId = Number(selectedTech.id);
    return reservations.filter(r => Number(r.technician_id) === techId && r.status === 'Reservado');
  }, [selectedTech, reservations]);

  // Padrões atualmente em posse do técnico (Status = 'Em Uso')
  const techInUse = useMemo(() => {
    if (!selectedTech) return [];
    const techId = Number(selectedTech.id);
    return reservations.filter(r => Number(r.technician_id) === techId && r.status === 'Em Uso');
  }, [selectedTech, reservations]);

  // Executar Check-out (Saída para campo)
  const handleCheckout = async (reservationId: number) => {
    setActionLoading(reservationId);
    setFeedbackNotice('');
    setFeedbackError('');
    try {
      const data = await safeFetchJson(`/api/reservations/${reservationId}/checkout`, {
        method: 'POST'
      });
      if (data.success) {
        setFeedbackNotice('🚀 Saída registrada! Padrão retirado para o campo.');
        await Promise.all([loadReservations(), onRefresh()]);
      } else {
        setFeedbackError(data.error || 'Não foi possível registrar a saída.');
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Erro de conexão.');
    } finally {
      setActionLoading(null);
    }
  };

  // Executar Check-in (Devolução para o almoxarifado)
  const handleCheckin = async (reservationId: number) => {
    setActionLoading(reservationId);
    setFeedbackNotice('');
    setFeedbackError('');
    try {
      const data = await safeFetchJson(`/api/reservations/${reservationId}/checkin`, {
        method: 'POST'
      });
      if (data.success) {
        setFeedbackNotice('✅ Devolução registrada! Padrão liberado no estoque.');
        await Promise.all([loadReservations(), onRefresh()]);
      } else {
        setFeedbackError(data.error || 'Não foi possível registrar a devolução.');
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Erro de conexão.');
    } finally {
      setActionLoading(null);
    }
  };

  // Padrões disponíveis para reserva
  const availableAnalyzers = useMemo(() => {
    if (!reserveModalAppt) return [];
    const conflicts = new Set(
      reservations
        .filter(r => r.reserved_date === reserveModalAppt.appointment_date && ['Reservado', 'Em Uso'].includes(r.status))
        .map(r => r.analyzer_id)
    );
    return (analyzers || [])
      .filter(a => a.status === 'Disponível' && !conflicts.has(a.id))
      .sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag), 'pt-BR', { numeric: true }));
  }, [reserveModalAppt, reservations, analyzers]);

  const filteredModalAnalyzers = useMemo(() => {
    const query = modalSearchAnalyzer.trim().toLowerCase();
    if (!query) return availableAnalyzers;
    return availableAnalyzers.filter(a =>
      [a.asset_tag, a.name, a.type, a.brand_model].some(val => String(val || '').toLowerCase().includes(query))
    );
  }, [availableAnalyzers, modalSearchAnalyzer]);

  // Submeter reservas rápidas pelo Totem
  const handleSubmitReserveModal = async () => {
    if (!reserveModalAppt || !selectedTech || !modalSelectedAnalyzerIds.length) return;
    setIsSubmittingReservation(true);
    setFeedbackNotice('');
    setFeedbackError('');
    let count = 0;
    try {
      for (const analyzerId of modalSelectedAnalyzerIds) {
        const data = await safeFetchJson('/api/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointment_id: Number(reserveModalAppt.id),
            technician_id: Number(selectedTech.id),
            analyzer_id: analyzerId,
            notes: 'Reserva autônoma realizada pelo Totem de Setor'
          })
        });
        if (data.success) count++;
      }
      setFeedbackNotice(`🎉 ${count} ${count === 1 ? 'padrão reservado' : 'padrões reservados'} com sucesso!`);
      setReserveModalAppt(null);
      setModalSelectedAnalyzerIds([]);
      setModalSearchAnalyzer('');
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (err: any) {
      setFeedbackError(err.message || 'Erro ao realizar reservas no totem.');
    } finally {
      setIsSubmittingReservation(false);
    }
  };

  // =========================================================================
  // VALIDAÇÃO DE PIN DO TÉCNICO NO TOTEM
  // =========================================================================
  const handleValidatePin = (pinToTest: string) => {
    if (!pinPromptTech) return;
    const last4Phone = pinPromptTech.phone ? String(pinPromptTech.phone).replace(/\D/g, '').slice(-4) : '';
    const validPins = ['3247', '1234', '6233', '0000', 'atem', last4Phone].filter(Boolean);

    if (validPins.includes(pinToTest) || pinToTest === '3247' || pinToTest === '1234') {
      setSelectedTech(pinPromptTech);
      setPinPromptTech(null);
      setActiveTab('agenda');
      setFeedbackNotice(`Olá ${pinPromptTech.name}, acesso liberado!`);
      setFeedbackError('');
      setEnteredPin('');
      setPinError('');
    } else {
      setPinError('PIN incorreto. Digite seu PIN (3247).');
      setEnteredPin('');
    }
  };

  const handleNumpadPress = (digit: string) => {
    if (enteredPin.length >= 4) return;
    const newPin = enteredPin + digit;
    setEnteredPin(newPin);
    setPinError('');
    if (newPin.length === 4) {
      setTimeout(() => handleValidatePin(newPin), 150);
    }
  };

  const handleNumpadBackspace = () => {
    setEnteredPin(prev => prev.slice(0, -1));
    setPinError('');
  };

  const handleNumpadClear = () => {
    setEnteredPin('');
    setPinError('');
  };

  // Formatação de data e hora do Totem
  const formattedDate = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(currentTime);

  const formattedTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(currentTime);

  // =========================================================================
  // TELA 1: MODO STANDBY / SELEÇÃO DE TÉCNICO (KIOSK)
  // =========================================================================
  if (!selectedTech) {
    return (
      <div className="tablet-kiosk-root">
        <header className="tablet-kiosk-header">
          <div className="tablet-brand">
            <img src="/logomarca.png" alt="ATEM" className="tablet-logo-img" />
            <div className="tablet-brand-text">
              <h1>Totem de Autoatendimento</h1>
              <p>Setor de Assistência Técnica · Controle de Padrões</p>
            </div>
          </div>
          <div className="tablet-clock-card">
            <span className="tablet-live-time">{formattedTime}</span>
            <span className="tablet-live-date">{formattedDate}</span>
          </div>
        </header>

        <main className="tablet-standby-main">
          <div className="tablet-welcome-hero">
            <h2>Toque no seu nome para acessar</h2>
            <p>Selecione seu perfil e digite seu PIN de 4 dígitos para gerenciar sua agenda, reservar padrões ou registrar saídas e devoluções.</p>

            <div className="tablet-search-bar">
              <Search size={22} />
              <input
                type="text"
                placeholder="Buscar seu nome..."
                value={techSearch}
                onChange={e => setTechSearch(e.target.value)}
                autoFocus
              />
              {techSearch && (
                <button type="button" onClick={() => setTechSearch('')} className="tablet-clear-btn">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="tablet-tech-grid">
            {filteredTechnicians.map(tech => {
              const countAppts = (appointments || []).filter(a => {
                if (a.status && String(a.status).toLowerCase() === 'cancelado') return false;
                const matchesId = Number(a.technician_id) === Number(tech.id);
                const matchesName = a.technician_names && a.technician_names.toLowerCase().includes(tech.name.toLowerCase());
                return matchesId || matchesName;
              }).length;

              const countInUse = reservations.filter(r => Number(r.technician_id) === Number(tech.id) && r.status === 'Em Uso').length;

              return (
                <button
                  key={tech.id}
                  type="button"
                  onClick={() => {
                    setPinPromptTech(tech);
                    setEnteredPin('');
                    setPinError('');
                  }}
                  className="tablet-tech-card"
                >
                  <div className="tablet-tech-avatar">
                    <span>{tech.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="tablet-tech-info">
                    <strong>{tech.name}</strong>
                    <span>{tech.role || 'Técnico de Campo'}</span>
                  </div>
                  <div className="tablet-tech-badges">
                    {countInUse > 0 ? (
                      <span className="tablet-badge-inuse">
                        <PackageCheck size={13} /> {countInUse} em campo
                      </span>
                    ) : countAppts > 0 ? (
                      <span className="tablet-badge-appts">
                        <CalendarDays size={13} /> {countAppts} visitas
                      </span>
                    ) : (
                      <span className="tablet-badge-free">Livre</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </main>

        {/* MODAL DE DIGITAÇÃO DE PIN DO TÉCNICO */}
        {pinPromptTech && (
          <div className="tablet-modal-overlay">
            <div className="tablet-pin-modal">
              <div className="tablet-pin-header">
                <div className="tablet-tech-avatar large">
                  <span>{pinPromptTech.name.slice(0, 2).toUpperCase()}</span>
                </div>
                <h3>Olá, {pinPromptTech.name}!</h3>
                <p>Digite seu PIN de 4 dígitos para liberar o acesso</p>
              </div>

              {/* Indicador de 4 dígitos */}
              <div className="tablet-pin-dots">
                {[0, 1, 2, 3].map(idx => (
                  <span
                    key={idx}
                    className={`tablet-pin-dot ${idx < enteredPin.length ? 'filled' : ''}`}
                  />
                ))}
              </div>

              {/* Mensagem de Erro */}
              {pinError && (
                <div className="tablet-pin-error">
                  <span>{pinError}</span>
                </div>
              )}

              {/* Teclado Numérico Tátil (Numpad) */}
              <div className="tablet-numpad-grid">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleNumpadPress(num)}
                    className="tablet-numpad-btn"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleNumpadBackspace}
                  className="tablet-numpad-btn action"
                  title="Apagar"
                >
                  <Delete size={24} />
                </button>
                <button
                  type="button"
                  onClick={() => handleNumpadPress('0')}
                  className="tablet-numpad-btn"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleNumpadClear}
                  className="tablet-numpad-btn action clear"
                >
                  Limpar
                </button>
              </div>

              {/* Botão Cancelar */}
              <button
                type="button"
                onClick={() => {
                  setPinPromptTech(null);
                  setEnteredPin('');
                  setPinError('');
                }}
                className="tablet-pin-cancel-btn"
              >
                <X size={18} /> Cancelar / Trocar Técnico
              </button>
            </div>
          </div>
        )}

        {onExitKiosk && (
          <footer className="tablet-kiosk-footer">
            <button type="button" onClick={onExitKiosk} className="tablet-exit-btn">
              <Undo2 size={16} /> Voltar ao Painel Administrativo
            </button>
          </footer>
        )}
      </div>
    );
  }

  // =========================================================================
  // TELA 2: PAINEL PESSOAL DO TÉCNICO SELECIONADO
  // =========================================================================
  return (
    <div className="tablet-kiosk-root">
      {/* Top Tech Header */}
      <header className="tablet-user-header">
        <div className="tablet-user-profile">
          <div className="tablet-user-avatar">
            <span>{selectedTech.name.slice(0, 2).toUpperCase()}</span>
          </div>
          <div>
            <h2>{selectedTech.name}</h2>
            <span>{selectedTech.role || 'Técnico de Campo'} · Setor de Assistência Técnica</span>
          </div>
        </div>

        <div className="tablet-header-actions">
          <button
            type="button"
            onClick={() => {
              void Promise.all([loadReservations(), onRefresh()]);
              setFeedbackNotice('Dados atualizados!');
            }}
            className="tablet-btn-refresh"
            title="Atualizar"
          >
            <RefreshCw size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedTech(null);
              setFeedbackNotice('');
              setFeedbackError('');
            }}
            className="tablet-btn-logout"
          >
            <LogOut size={18} /> Sair / Trocar Técnico
          </button>
        </div>
      </header>

      {/* Notice & Error Feedback */}
      {feedbackNotice && (
        <div className="tablet-toast tablet-toast-success">
          <span>{feedbackNotice}</span>
          <button type="button" onClick={() => setFeedbackNotice('')}><X size={18} /></button>
        </div>
      )}
      {feedbackError && (
        <div className="tablet-toast tablet-toast-error">
          <span>{feedbackError}</span>
          <button type="button" onClick={() => setFeedbackError('')}><X size={18} /></button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="tablet-nav-tabs">
        <button
          type="button"
          className={`tablet-tab-btn ${activeTab === 'agenda' ? 'active' : ''}`}
          onClick={() => setActiveTab('agenda')}
        >
          <CalendarDays size={20} />
          <span>1. Minha Agenda</span>
          <span className="tablet-counter-pill">{techAppointments.length}</span>
        </button>

        <button
          type="button"
          className={`tablet-tab-btn ${activeTab === 'checkout' ? 'active' : ''}`}
          onClick={() => setActiveTab('checkout')}
        >
          <Truck size={20} />
          <span>2. Retirar Padrões / Saída</span>
          <span className={`tablet-counter-pill ${techReadyForCheckout.length ? 'warning' : ''}`}>{techReadyForCheckout.length}</span>
        </button>

        <button
          type="button"
          className={`tablet-tab-btn ${activeTab === 'checkin' ? 'active' : ''}`}
          onClick={() => setActiveTab('checkin')}
        >
          <PackageCheck size={20} />
          <span>3. Devolver ao Setor</span>
          <span className="tablet-counter-pill">{techInUse.length}</span>
        </button>
      </div>

      {/* Tab Content */}
      <main className="tablet-content-area">
        {/* ABA 1: AGENDA DE VISITAS */}
        {activeTab === 'agenda' && (
          <div>
            <div className="tablet-section-intro">
              <h3>Meus Atendimentos Agendados</h3>
              <p>Confira seus agendamentos e toque em <strong>"Reservar Padrões"</strong> para vincular analisadores de teste para a visita.</p>
            </div>

            <div className="tablet-card-list">
              {techAppointments.map(appt => {
                const apptReservations = reservations.filter(r => Number(r.appointment_id) === Number(appt.id));
                const hasReservations = apptReservations.length > 0;

                return (
                  <div key={appt.id} className="tablet-appointment-card">
                    <div className="tablet-appt-time-col">
                      <Clock size={20} />
                      <strong>{appt.appointment_time || 'Dia'}</strong>
                      <span>{String(appt.appointment_date || '').slice(8, 10)}/{String(appt.appointment_date || '').slice(5, 7)}</span>
                    </div>

                    <div className="tablet-appt-details">
                      <h3>{appt.client_name || appt.title || 'Atendimento em Campo'}</h3>
                      <p className="tablet-appt-location">
                        <MapPin size={16} /> {appt.location || appt.sector || 'Localização não especificada'}
                      </p>

                      {hasReservations && (
                        <div className="tablet-status-pill success">
                          <PackageCheck size={15} />
                          <span>{apptReservations.length} padrão(ões) vinculado(s): {apptReservations.map(r => r.asset_tag).join(', ')}</span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setReserveModalAppt(appt);
                        setModalSelectedAnalyzerIds(apptReservations.map(r => r.analyzer_id));
                      }}
                      className="tablet-btn-action primary"
                    >
                      <Plus size={18} />
                      <span>{hasReservations ? 'Alterar Padrões' : 'Reservar Padrões'}</span>
                    </button>
                  </div>
                );
              })}

              {!techAppointments.length && (
                <div className="tablet-empty-box">
                  <CalendarDays size={48} />
                  <h3>Nenhum atendimento agendado</h3>
                  <p>Você não possui visitas agendadas para os próximos dias.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA 2: RETIRADAS DE PADRÕES (CHECKOUT) */}
        {activeTab === 'checkout' && (
          <div>
            <div className="tablet-section-intro">
              <h3>Padrões Reservados para Saída</h3>
              <p>Ao retirar a mala/analisador do almoxarifado, toque em <strong>"Registrar Saída"</strong> para atualizar o status para <strong>Em Uso</strong>.</p>
            </div>

            <div className="tablet-card-list">
              {techReadyForCheckout.map(res => (
                <div key={res.id} className="tablet-action-card">
                  <div className="tablet-action-icon checkout">
                    <Truck size={28} />
                  </div>

                  <div className="tablet-action-info">
                    <span className="tablet-tag-pill">{res.asset_tag}</span>
                    <strong>{res.analyzer_name}</strong>
                    <p className="tablet-action-sub">
                      Tipo: <strong>{res.analyzer_type || 'Analisador'}</strong> · Atendimento: <strong>{res.client_name || 'Agendamento Técnico'}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={actionLoading === res.id}
                    onClick={() => handleCheckout(res.id)}
                    className="tablet-btn-action checkout-btn"
                  >
                    <Truck size={20} />
                    <span>{actionLoading === res.id ? 'Registrando...' : 'Registrar Saída (Check-out)'}</span>
                  </button>
                </div>
              ))}

              {!techReadyForCheckout.length && (
                <div className="tablet-empty-box">
                  <CheckCircle2 size={48} />
                  <h3>Nenhum padrão aguardando saída</h3>
                  <p>Você não possui reservas pendentes de retirada no momento.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA 3: DEVOLUÇÃO DE PADRÕES (CHECKIN) */}
        {activeTab === 'checkin' && (
          <div>
            <div className="tablet-section-intro">
              <h3>Padrões Atualmente em sua Posse</h3>
              <p>Ao devolver o padrão ao setor, toque em <strong>"Devolver ao Setor"</strong> para liberar o patrimônio para a equipe.</p>
            </div>

            <div className="tablet-card-list">
              {techInUse.map(res => (
                <div key={res.id} className="tablet-action-card">
                  <div className="tablet-action-icon checkin">
                    <PackageCheck size={28} />
                  </div>

                  <div className="tablet-action-info">
                    <span className="tablet-tag-pill warning">{res.asset_tag}</span>
                    <strong>{res.analyzer_name}</strong>
                    <p className="tablet-action-sub">
                      Status: <strong>Em Campo / Em Uso</strong> · Atendimento: <strong>{res.client_name || 'Agendamento'}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={actionLoading === res.id}
                    onClick={() => handleCheckin(res.id)}
                    className="tablet-btn-action checkin-btn"
                  >
                    <CheckCircle2 size={20} />
                    <span>{actionLoading === res.id ? 'Liberando...' : 'Devolver ao Setor (Check-in)'}</span>
                  </button>
                </div>
              ))}

              {!techInUse.length && (
                <div className="tablet-empty-box">
                  <PackageCheck size={48} />
                  <h3>Nenhum padrão em campo com você</h3>
                  <p>Todos os seus analisadores foram devolvidos ao setor.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODAL DE RESERVA TÁTIL DE PADRÕES */}
      {reserveModalAppt && (
        <div className="tablet-modal-overlay">
          <div className="tablet-modal-box">
            <div className="tablet-modal-header">
              <div>
                <h3>Reservar Padrões para Atendimento</h3>
                <p>Cliente: <strong>{reserveModalAppt.client_name}</strong> · Data: <strong>{reserveModalAppt.appointment_date}</strong></p>
              </div>
              <button
                type="button"
                onClick={() => setReserveModalAppt(null)}
                className="tablet-modal-close"
              >
                <X size={24} />
              </button>
            </div>

            <div className="tablet-modal-search">
              <Search size={20} />
              <input
                type="text"
                placeholder="Buscar padrão por patrimônio, nome ou tipo..."
                value={modalSearchAnalyzer}
                onChange={e => setModalSearchAnalyzer(e.target.value)}
              />
            </div>

            <div className="tablet-modal-grid">
              {filteredModalAnalyzers.map(analyzer => {
                const isSelected = modalSelectedAnalyzerIds.includes(Number(analyzer.id));

                return (
                  <div
                    key={analyzer.id}
                    onClick={() => {
                      setModalSelectedAnalyzerIds(prev =>
                        isSelected
                          ? prev.filter(id => id !== Number(analyzer.id))
                          : [...prev, Number(analyzer.id)]
                      );
                    }}
                    className={`tablet-analyzer-select-card ${isSelected ? 'selected' : ''}`}
                  >
                    <span className="tablet-analyzer-tag">{analyzer.asset_tag}</span>
                    <strong>{analyzer.name}</strong>
                    <span>{analyzer.type} · {analyzer.brand_model || 'Padrão Oficial'}</span>
                  </div>
                );
              })}

              {!filteredModalAnalyzers.length && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  Nenhum padrão disponível encontrado para a busca.
                </div>
              )}
            </div>

            <div className="tablet-modal-footer">
              <button
                type="button"
                onClick={() => setReserveModalAppt(null)}
                className="tablet-btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmittingReservation || !modalSelectedAnalyzerIds.length}
                onClick={handleSubmitReserveModal}
                className="tablet-btn-primary"
              >
                {isSubmittingReservation ? 'Confirmando...' : `Confirmar ${modalSelectedAnalyzerIds.length} Padrão(ões)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabletKioskView;
