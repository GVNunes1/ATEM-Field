import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  Filter,
  History,
  Info,
  PackageCheck,
  RefreshCw,
  Search,
  Trash2,
  User,
  Users
} from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import './ReservationHistoryView.css';

interface ReservationHistoryViewProps {
  analyzers: any[];
  technicians: any[];
  onRefresh: () => void;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  try {
    const d = new Date(value.includes('T') ? value : `${value}T12:00:00`);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Pendente / Não registrado';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  } catch {
    return value;
  }
}

export const ReservationHistoryView: React.FC<ReservationHistoryViewProps> = ({
  analyzers,
  technicians,
  onRefresh
}) => {
  const [mode, setMode] = useState<'equipment' | 'technician'>('equipment');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>('all');
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await safeFetchJson('/api/reservations', { cache: 'no-store' });
      if (data.success) {
        setReservations(data.reservations || []);
      } else {
        setError(data.error || 'Não foi possível carregar o histórico de reservas.');
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Falha na conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  const handleRefreshAll = () => {
    void fetchReservations();
    onRefresh();
  };

  const handleDeleteHistoryItem = async (resId: number) => {
    if (!window.confirm('⚠️ Tem certeza que deseja apagar este registro do histórico definitivamente do banco de dados?')) return;
    try {
      const data = await safeFetchJson(`/api/reservations/${resId}`, { method: 'DELETE' });
      if (data.success) {
        handleRefreshAll();
      } else {
        alert(data.error || 'Falha ao excluir registro.');
      }
    } catch (err: any) {
      alert(err.message || 'Erro de conexão.');
    }
  };

  // Filtered reservations based on active tab, selected entity, search term, and status filter
  const filteredReservations = useMemo(() => {
    return reservations.filter(r => {
      // 1. Mode & Entity Filter
      if (mode === 'equipment') {
        if (selectedEquipmentId !== 'all' && Number(r.analyzer_id) !== Number(selectedEquipmentId)) {
          return false;
        }
      } else if (mode === 'technician') {
        if (selectedTechnicianId !== 'all' && Number(r.technician_id) !== Number(selectedTechnicianId)) {
          return false;
        }
      }

      // 2. Status Filter
      if (statusFilter !== 'all') {
        if (r.status !== statusFilter) return false;
      }

      // 3. Search Term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const searchableText = [
          r.asset_tag,
          r.analyzer_name,
          r.analyzer_type,
          r.brand_model,
          r.technician_name,
          r.technician_phone,
          r.client_name,
          r.reserved_date,
          r.status,
          r.notes
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(query)) return false;
      }

      return true;
    });
  }, [reservations, mode, selectedEquipmentId, selectedTechnicianId, statusFilter, searchTerm]);

  // Derived metrics for summary cards
  const metrics = useMemo(() => {
    const total = filteredReservations.length;
    const active = filteredReservations.filter(r => ['Em Uso', 'Reservado'].includes(r.status)).length;
    const completed = filteredReservations.filter(r => r.status === 'Devolvido').length;
    const uniqueEquipments = new Set(filteredReservations.map(r => r.analyzer_id).filter(Boolean)).size;
    const uniqueTechnicians = new Set(filteredReservations.map(r => r.technician_id).filter(Boolean)).size;

    return { total, active, completed, uniqueEquipments, uniqueTechnicians };
  }, [filteredReservations]);

  // Details for currently selected equipment
  const selectedEquipment = useMemo(() => {
    if (mode !== 'equipment' || selectedEquipmentId === 'all') return null;
    return analyzers.find(a => Number(a.id) === Number(selectedEquipmentId));
  }, [mode, selectedEquipmentId, analyzers]);

  // Details for currently selected technician
  const selectedTechnician = useMemo(() => {
    if (mode !== 'technician' || selectedTechnicianId === 'all') return null;
    return technicians.find(t => Number(t.id) === Number(selectedTechnicianId));
  }, [mode, selectedTechnicianId, technicians]);

  return (
    <div className="history-view animate-fade-in">
      {/* Header Bar */}
      <div className="glass-panel history-header">
        <div className="history-header__info">
          <h2>
            <History size={24} color="var(--primary)" /> Histórico de Reservas e Posse
          </h2>
          <p>
            Rastreamento completo de retiradas, devoluções e reagendamentos de simuladores na operação.
          </p>
        </div>

        {/* Mode Selector Switcher */}
        <div className="history-mode-switcher" role="tablist" aria-label="Modo de histórico">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'equipment'}
            className={`history-mode-btn ${mode === 'equipment' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('equipment');
              setSelectedTechnicianId('all');
            }}
          >
            <Cpu size={18} /> Por Equipamento
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={mode === 'technician'}
            className={`history-mode-btn ${mode === 'technician' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('technician');
              setSelectedEquipmentId('all');
            }}
          >
            <Users size={18} /> Por Técnico
          </button>
        </div>
      </div>

      {/* Filter Controls Panel */}
      <div className="glass-panel history-filters">
        {mode === 'equipment' ? (
          <div className="history-filters__group">
            <label htmlFor="select-equipment">Selecionar Equipamento (Patrimônio)</label>
            <select
              id="select-equipment"
              className="history-select"
              value={selectedEquipmentId}
              onChange={e => setSelectedEquipmentId(e.target.value)}
            >
              <option value="all">📦 Todos os Equipamentos / Patrimônios ({analyzers.length})</option>
              {analyzers.map(a => (
                <option key={a.id} value={a.id}>
                  {a.asset_tag} — {a.name} ({a.type})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="history-filters__group">
            <label htmlFor="select-technician">Selecionar Técnico Responsável</label>
            <select
              id="select-technician"
              className="history-select"
              value={selectedTechnicianId}
              onChange={e => setSelectedTechnicianId(e.target.value)}
            >
              <option value="all">👤 Todos os Técnicos ({technicians.length})</option>
              {technicians.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.role ? `(${t.role})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quick Search */}
        <div className="history-filters__group">
          <label htmlFor="history-search">Buscar no Histórico</label>
          <div style={{ position: 'relative' }}>
            <input
              id="history-search"
              type="text"
              className="history-search-input"
              placeholder="Buscar por patrimônio, técnico, cliente ou notas..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="history-filters__group">
          <label>Filtrar por Status</label>
          <div className="history-status-pills">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'Reservado', label: 'Reservados' },
              { id: 'Em Uso', label: 'Em Uso' },
              { id: 'Devolvido', label: 'Devolvidos' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                className={`status-pill ${statusFilter === p.id ? 'is-active' : ''}`}
                onClick={() => setStatusFilter(p.id)}
              >
                {p.label}
              </button>
            ))}

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshAll}
              title="Atualizar histórico"
              style={{ marginLeft: 'auto', gap: '6px' }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : undefined} /> Sincronizar
            </button>
          </div>
        </div>
      </div>

      {/* Selected Entity Banner Highlight (If specific analyzer or technician is selected) */}
      {selectedEquipment && (
        <div className="history-entity-banner">
          <div className="history-entity-banner__left">
            <span className="history-entity-banner__badge">{selectedEquipment.asset_tag}</span>
            <div className="history-entity-banner__copy">
              <h3>{selectedEquipment.name}</h3>
              <p>Tipo: {selectedEquipment.type} {selectedEquipment.brand_model ? `· ${selectedEquipment.brand_model}` : ''}</p>
            </div>
          </div>
          <div className="history-entity-banner__right">
            <span className={`badge ${selectedEquipment.status === 'Disponível' ? 'badge-green' : selectedEquipment.status === 'Em Uso' ? 'badge-blue' : 'badge-amber'}`}>
              Status no Inventário: {selectedEquipment.status}
            </span>
          </div>
        </div>
      )}

      {selectedTechnician && (
        <div className="history-entity-banner">
          <div className="history-entity-banner__left">
            <span className="history-entity-banner__badge"><User size={20} /></span>
            <div className="history-entity-banner__copy">
              <h3>{selectedTechnician.name}</h3>
              <p>{selectedTechnician.role || 'Técnico de Campo'} {selectedTechnician.phone ? `· Tel: ${selectedTechnician.phone}` : ''}</p>
            </div>
          </div>
          <div className="history-entity-banner__right">
            <span className="badge badge-purple">
              {filteredReservations.filter(r => ['Em Uso', 'Reservado'].includes(r.status)).length} item(ns) em posse atualmente
            </span>
          </div>
        </div>
      )}

      {/* Metrics Summary Grid */}
      <div className="history-metrics">
        <div className="glass-panel history-metric-card">
          <div className="history-metric-card__icon"><History size={24} /></div>
          <div className="history-metric-card__data">
            <strong>{metrics.total}</strong>
            <span>Total de Registros</span>
          </div>
        </div>

        <div className="glass-panel history-metric-card">
          <div className="history-metric-card__icon" style={{ color: '#0284c7', background: 'rgba(2, 132, 199, 0.1)' }}><PackageCheck size={24} /></div>
          <div className="history-metric-card__data">
            <strong>{metrics.active}</strong>
            <span>Em Campo / Reservados</span>
          </div>
        </div>

        <div className="glass-panel history-metric-card">
          <div className="history-metric-card__icon" style={{ color: '#16a34a', background: 'rgba(22, 163, 74, 0.1)' }}><CheckCircle2 size={24} /></div>
          <div className="history-metric-card__data">
            <strong>{metrics.completed}</strong>
            <span>Devolvidos</span>
          </div>
        </div>

        <div className="glass-panel history-metric-card">
          <div className="history-metric-card__icon" style={{ color: '#9333ea', background: 'rgba(147, 51, 234, 0.1)' }}>
            {mode === 'equipment' ? <Users size={24} /> : <Cpu size={24} />}
          </div>
          <div className="history-metric-card__data">
            <strong>{mode === 'equipment' ? metrics.uniqueTechnicians : metrics.uniqueEquipments}</strong>
            <span>{mode === 'equipment' ? 'Técnicos Distintos' : 'Equipamentos Distintos'}</span>
          </div>
        </div>
      </div>

      {/* Timeline List of Reservations */}
      {loading ? (
        <div className="glass-panel history-empty" aria-live="polite">
          <span className="loading-spinner" />
          <p>Carregando histórico de reservas...</p>
        </div>
      ) : error ? (
        <div className="glass-panel history-empty" style={{ color: '#ef4444' }}>
          <Info size={32} />
          <p>{error}</p>
        </div>
      ) : filteredReservations.length === 0 ? (
        <div className="glass-panel history-empty">
          <History size={36} color="var(--text-muted)" />
          <strong>Nenhum registro encontrado</strong>
          <p>Não há histórico de reservas para a seleção e filtros informados.</p>
        </div>
      ) : (
        <div className="history-timeline">
          {filteredReservations.map(res => {
            const isDevolvido = res.status === 'Devolvido';
            const isEmUso = res.status === 'Em Uso';
            const isReservado = res.status === 'Reservado';

            return (
              <div key={res.id} className="glass-panel history-card animate-fade-in">
                <div className="history-card__header">
                  <div className="history-card__tags">
                    <span className="asset-tag-pill">{res.asset_tag || 'PAT-N/A'}</span>
                    <span className="analyzer-title">{res.analyzer_name || 'Simulador'}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({res.analyzer_type || 'Geral'})</span>
                  </div>

                  <div className="history-card__tags">
                    <span className={`status-badge ${isDevolvido ? 'status-badge--devolvido' : isEmUso ? 'status-badge--emuso' : 'status-badge--reservado'}`}>
                      {isDevolvido && <CheckCircle2 size={13} />}
                      {isEmUso && <Clock size={13} />}
                      {isReservado && <Calendar size={13} />}
                      {res.status}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryItem(res.id)}
                      title="Apagar Registro do Banco (Admin)"
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '6px',
                        color: '#dc2626',
                        padding: '4px 6px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="history-card__body">
                  <div className="history-detail-item">
                    <small><User size={12} /> Técnico Responsável</small>
                    <strong>{res.technician_name || 'Não informado'}</strong>
                  </div>

                  <div className="history-detail-item">
                    <small><Calendar size={12} /> Atendimento / Cliente</small>
                    <strong>{res.client_name || `Atendimento #${res.appointment_id}`}</strong>
                  </div>

                  <div className="history-detail-item">
                    <small><Clock size={12} /> Data do Atendimento</small>
                    <strong>{formatDate(res.appointment_date || res.reserved_date)}</strong>
                  </div>

                  <div className="history-detail-item">
                    <small><Clock size={12} /> Retirada / Checkout</small>
                    <strong>{formatDateTime(res.checkout_at)}</strong>
                  </div>

                  <div className="history-detail-item">
                    <small><CheckCircle2 size={12} /> Devolução / Checkin</small>
                    <strong>{formatDateTime(res.checkin_at)}</strong>
                  </div>
                </div>

                {res.notes && (
                  <div className="history-card__notes">
                    <FileText size={13} style={{ display: 'inline', marginRight: '6px' }} />
                    {res.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
