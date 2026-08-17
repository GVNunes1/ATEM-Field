import React, { useEffect, useMemo, useState } from 'react';
import { safeFetchJson } from '../lib/api';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
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

  // Executar Check-in (Devolução ao setor)
  const handleCheckin = async (reservationId: number) => {
    setActionLoading(reservationId);
    setFeedbackNotice('');
    setFeedbackError('');
    try {
      const data = await safeFetchJson(`/api/reservations/${reservationId}/checkin`, {
        method: 'POST'
      });
      if (data.success) {
        setFeedbackNotice('📦 Devolução concluída! Patrimônio liberado no setor.');
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

  // Abrir modal de reserva rápida
  const handleOpenReserveModal = (appt: any) => {
    setReserveModalAppt(appt);
    setModalSelectedAnalyzerIds([]);
    setModalSearchAnalyzer('');
  };

  // Analisadores livres para reserva
  const availableAnalyzersForModal = useMemo(() => {
    if (!reserveModalAppt) return [];
    const apptDate = reserveModalAppt.appointment_date;
    const reservedIds = new Set(
      reservations
        .filter(r => r.reserved_date === apptDate && (r.status === 'Reservado' || r.status === 'Em Uso'))
        .map(r => Number(r.analyzer_id))
    );

    const query = modalSearchAnalyzer.trim().toLowerCase();

    return (analyzers || [])
      .filter(a => a.status === 'Disponível' && !reservedIds.has(Number(a.id)))
      .filter(a => {
        if (!query) return true;
        return (
          String(a.asset_tag).toLowerCase().includes(query) ||
          String(a.name).toLowerCase().includes(query) ||
          String(a.category_name || '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => String(a.asset_tag).localeCompare(String(b.asset_tag), 'pt-BR', { numeric: true }));
  }, [reserveModalAppt, reservations, analyzers, modalSearchAnalyzer]);

  // Submeter nova reserva pelo tablet
  const handleConfirmReservation = async () => {
    if (!selectedTech || !reserveModalAppt || !modalSelectedAnalyzerIds.length) return;
    setIsSubmittingReservation(true);
    setFeedbackNotice('');
    setFeedbackError('');

    try {
      for (const analyzerId of modalSelectedAnalyzerIds) {
        await safeFetchJson('/api/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analyzer_id: analyzerId,
            appointment_id: reserveModalAppt.id,
            technician_id: selectedTech.id,
            reserved_date: reserveModalAppt.appointment_date
          })
        });
      }
      setFeedbackNotice(`✅ ${modalSelectedAnalyzerIds.length} padrão(ões) reservado(s) com sucesso!`);
      setReserveModalAppt(null);
      await Promise.all([loadReservations(), onRefresh()]);
    } catch (err: any) {
      setFeedbackError(err.message || 'Falha ao gravar reserva.');
    } finally {
      setIsSubmittingReservation(false);
    }
  };

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
              <p>Setor de Engenharia Clínica · Controle de Padrões</p>
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
            <p>Selecione seu perfil para gerenciar sua agenda, reservar padrões de calibração ou registrar saída/devolução.</p>

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
                    setSelectedTech(tech);
                    setActiveTab('agenda');
                    setFeedbackNotice('');
                    setFeedbackError('');
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
  // TELA 2: PAINEL PESSOAL DO TÉCNICO NO TABLET
  // =========================================================================
  return (
    <div className="tablet-kiosk-root">
      {/* Top Bar do Técnico */}
      <header className="tablet-user-header">
        <div className="tablet-user-profile">
          <div className="tablet-user-avatar">
            <span>{selectedTech.name.slice(0, 2).toUpperCase()}</span>
          </div>
          <div>
            <h2>{selectedTech.name}</h2>
            <span>{selectedTech.role || 'Técnico de Campo'} · Totem de Autoatendimento</span>
          </div>
        </div>

        <div className="tablet-header-actions">
          <button
            type="button"
            onClick={() => {
              void loadReservations();
              void onRefresh();
            }}
            className="tablet-btn-refresh"
            title="Atualizar dados"
          >
            <RefreshCw size={18} className={loadingReservations ? 'spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setSelectedTech(null)}
            className="tablet-btn-logout"
          >
            <LogOut size={18} /> Sair / Trocar Técnico
          </button>
        </div>
      </header>

      {/* Notificações de Ação */}
      {feedbackNotice && (
        <div className="tablet-toast tablet-toast-success">
          <CheckCircle2 size={20} />
          <span>{feedbackNotice}</span>
          <button type="button" onClick={() => setFeedbackNotice('')}><X size={16} /></button>
        </div>
      )}
      {feedbackError && (
        <div className="tablet-toast tablet-toast-error">
          <X size={20} />
          <span>{feedbackError}</span>
          <button type="button" onClick={() => setFeedbackError('')}><X size={16} /></button>
        </div>
      )}

      {/* Navegação por Abas Táteis */}
      <nav className="tablet-nav-tabs">
        <button
          type="button"
          onClick={() => setActiveTab('agenda')}
          className={`tablet-tab-btn ${activeTab === 'agenda' ? 'active' : ''}`}
        >
          <CalendarDays size={20} />
          <span>Meus Atendimentos ({techAppointments.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('checkout')}
          className={`tablet-tab-btn ${activeTab === 'checkout' ? 'active' : ''}`}
        >
          <Truck size={20} />
          <span>Saída de Campo ({techReadyForCheckout.length})</span>
          {techReadyForCheckout.length > 0 && <span className="tablet-counter-pill">{techReadyForCheckout.length}</span>}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('checkin')}
          className={`tablet-tab-btn ${activeTab === 'checkin' ? 'active' : ''}`}
        >
          <PackageCheck size={20} />
          <span>Devoluções ({techInUse.length})</span>
          {techInUse.length > 0 && <span className="tablet-counter-pill warning">{techInUse.length}</span>}
        </button>
      </nav>

      {/* Conteúdo Principal */}
      <main className="tablet-content-area">
        {/* ABA 1: AGENDA DO TÉCNICO & RESERVA */}
        {activeTab === 'agenda' && (
          <div className="tablet-tab-pane">
            {techAppointments.length === 0 ? (
              <div className="tablet-empty-box">
                <CalendarClock size={48} />
                <h3>Nenhum atendimento agendado</h3>
                <p>Você não possui visitas técnicas pendentes na agenda para os próximos dias.</p>
              </div>
            ) : (
              <div className="tablet-card-list">
                {techAppointments.map(appt => {
                  const apptReservations = reservations.filter(r => Number(r.appointment_id) === Number(appt.id) && (r.status === 'Reservado' || r.status === 'Em Uso'));
                  const isReserved = apptReservations.length > 0;

                  return (
                    <div key={appt.id} className="tablet-appointment-card">
                      <div className="tablet-appt-time-col">
                        <Clock size={18} />
                        <strong>{appt.appointment_time || 'Horário livre'}</strong>
                        <span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${appt.appointment_date}T12:00:00`))}</span>
                      </div>

                      <div className="tablet-appt-details">
                        <h3>{appt.client_name || appt.title || 'Atendimento'}</h3>
                        <p className="tablet-appt-location">
                          <MapPin size={16} /> {appt.client_address || 'Endereço não informado'}
                        </p>

                        <div className="tablet-appt-reserved-summary">
                          {isReserved ? (
                            <span className="tablet-status-pill success">
                              <CheckCircle2 size={14} /> {apptReservations.length} padrão(ões) vinculado(s)
                            </span>
                          ) : (
                            <span className="tablet-status-pill pending">
                              Padrão não reservado
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="tablet-appt-actions">
                        <button
                          type="button"
                          onClick={() => handleOpenReserveModal(appt)}
                          className="tablet-btn-action primary"
                        >
                          <Plus size={18} /> Reservar Padrões <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: SAÍDA DE CAMPO (CHECK-OUT) */}
        {activeTab === 'checkout' && (
          <div className="tablet-tab-pane">
            <div className="tablet-section-intro">
              <h3>Padrões Reservados Prontos para Saída</h3>
              <p>Confirme a retirada física dos padrões da bancada/armário antes de se deslocar para o cliente.</p>
            </div>

            {techReadyForCheckout.length === 0 ? (
              <div className="tablet-empty-box">
                <Truck size={48} />
                <h3>Nenhum padrão aguardando retirada</h3>
                <p>Todas as suas reservas já foram retiradas ou ainda não foram agendadas.</p>
              </div>
            ) : (
              <div className="tablet-card-list">
                {techReadyForCheckout.map(res => {
                  const analyzer = (analyzers || []).find(a => Number(a.id) === Number(res.analyzer_id));
                  const appt = (appointments || []).find(a => Number(a.id) === Number(res.appointment_id));
                  const isLoading = actionLoading === res.id;

                  return (
                    <div key={res.id} className="tablet-action-card">
                      <div className="tablet-action-icon checkout">
                        <PackageCheck size={26} />
                      </div>
                      <div className="tablet-action-info">
                        <strong>{analyzer?.name || 'Padrão de Calibração'}</strong>
                        <span className="tablet-tag-pill">Patrimônio: {analyzer?.asset_tag || 'N/A'}</span>
                        <p className="tablet-action-sub">
                          Destino: <strong>{appt?.client_name || 'Visita Técnica'}</strong> · Data: {res.reserved_date}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleCheckout(res.id)}
                        className="tablet-btn-action checkout-btn"
                      >
                        {isLoading ? <RefreshCw size={18} className="spin" /> : <Truck size={18} />}
                        Registrar Saída (Levar p/ Campo)
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ABA 3: DEVOLUÇÃO AO SETOR (CHECK-IN) */}
        {activeTab === 'checkin' && (
          <div className="tablet-tab-pane">
            <div className="tablet-section-intro">
              <h3>Padrões em Posse do Técnico</h3>
              <p>Ao retornar ao setor, clique em devolver para liberar o equipamento para outros técnicos.</p>
            </div>

            {techInUse.length === 0 ? (
              <div className="tablet-empty-box">
                <ShieldCheck size={48} />
                <h3>Você não possui padrões em campo</h3>
                <p>Nenhum equipamento consta em seu nome no momento.</p>
              </div>
            ) : (
              <div className="tablet-card-list">
                {techInUse.map(res => {
                  const analyzer = (analyzers || []).find(a => Number(a.id) === Number(res.analyzer_id));
                  const appt = (appointments || []).find(a => Number(a.id) === Number(res.appointment_id));
                  const isLoading = actionLoading === res.id;

                  return (
                    <div key={res.id} className="tablet-action-card">
                      <div className="tablet-action-icon checkin">
                        <PackageCheck size={26} />
                      </div>
                      <div className="tablet-action-info">
                        <strong>{analyzer?.name || 'Padrão de Calibração'}</strong>
                        <span className="tablet-tag-pill warning">Em Uso · {analyzer?.asset_tag || 'N/A'}</span>
                        <p className="tablet-action-sub">
                          Retirado para: <strong>{appt?.client_name || 'Atendimento'}</strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleCheckin(res.id)}
                        className="tablet-btn-action checkin-btn"
                      >
                        {isLoading ? <RefreshCw size={18} className="spin" /> : <PackageCheck size={18} />}
                        Devolver ao Setor (Liberar)
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL TÁTIL DE RESERVA DE PADRÃO */}
      {reserveModalAppt && (
        <div className="tablet-modal-overlay">
          <div className="tablet-modal-box">
            <header className="tablet-modal-header">
              <div>
                <h3>Reservar Padrões de Calibração</h3>
                <p>{reserveModalAppt.client_name} · {reserveModalAppt.appointment_date}</p>
              </div>
              <button type="button" onClick={() => setReserveModalAppt(null)} className="tablet-modal-close">
                <X size={24} />
              </button>
            </header>

            <div className="tablet-modal-search">
              <Search size={20} />
              <input
                type="text"
                placeholder="Buscar padrão por tag ou nome..."
                value={modalSearchAnalyzer}
                onChange={e => setModalSearchAnalyzer(e.target.value)}
              />
            </div>

            <div className="tablet-modal-grid">
              {availableAnalyzersForModal.map(analyzer => {
                const isSelected = modalSelectedAnalyzerIds.includes(analyzer.id);
                return (
                  <button
                    key={analyzer.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setModalSelectedAnalyzerIds(prev => prev.filter(id => id !== analyzer.id));
                      } else {
                        setModalSelectedAnalyzerIds(prev => [...prev, analyzer.id]);
                      }
                    }}
                    className={`tablet-analyzer-select-card ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="tablet-analyzer-tag">{analyzer.asset_tag}</div>
                    <strong>{analyzer.name}</strong>
                    <span>{analyzer.brand_model || 'Padrão Oficial'}</span>
                  </button>
                );
              })}
            </div>

            <footer className="tablet-modal-footer">
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
                onClick={handleConfirmReservation}
                className="tablet-btn-primary"
              >
                {isSubmittingReservation ? <RefreshCw size={18} className="spin" /> : <CheckCircle2 size={18} />}
                Confirmar Reserva ({modalSelectedAnalyzerIds.length} selecionado{modalSelectedAnalyzerIds.length === 1 ? '' : 's'})
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabletKioskView;
