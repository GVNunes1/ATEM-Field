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
    <div className="history-view field-dashboard">
      {/* Header Bar */}
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Rastreabilidade & Auditoria</span>
          <h1>Histórico de reservas.</h1>
          <p>
            Registro cronológico completo de saídas, devoluções e posse dos analisadores em campo.
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
            <Cpu size={16} /> Por Equipamento
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
            <Users size={16} /> Por Técnico
          </button>
        </div>
      </header>

      {/* Metrics Summary Strip */}
      <section className="field-metrics" aria-label="Métricas do histórico">
        <button
          type="button"
          className="field-metric available"
          onClick={() => setStatusFilter('all')}
        >
          <span className="field-metric-label">
            Total registrado
            <History size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.total}</strong>
          <span className="field-metric-detail">Movimentações no sistema</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('Em Uso')}
        >
          <span className="field-metric-label">
            Em campo / Reservados
            <PackageCheck size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.active}</strong>
          <span className="field-metric-detail">Operações ativas</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('Devolvido')}
        >
          <span className="field-metric-label">
            Devolvidos
            <CheckCircle2 size={17} aria-hidden="true" />
          </span>
          <strong>{metrics.completed}</strong>
          <span className="field-metric-detail">Concluídas com sucesso</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => {}}
        >
          <span className="field-metric-label">
            {mode === 'equipment' ? 'Técnicos distintos' : 'Padrões distintos'}
            {mode === 'equipment' ? <Users size={17} aria-hidden="true" /> : <Cpu size={17} aria-hidden="true" />}
          </span>
          <strong>{mode === 'equipment' ? metrics.uniqueTechnicians : metrics.uniqueEquipments}</strong>
          <span className="field-metric-detail">{mode === 'equipment' ? 'Profissionais envolvidos' : 'Equipamentos movimentados'}</span>
        </button>
      </section>

      {/* Filter Controls Panel */}
      <div className="field-surface history-filters" style={{ padding: '20px 24px' }}>
        {mode === 'equipment' ? (
          <div className="history-filters__group">
            <label htmlFor="select-equipment">Selecionar Equipamento (Patrimônio)</label>
            <select
              id="select-equipment"
              className="select-field history-select"
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
              className="select-field history-select"
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
              className="input-field history-search-input"
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
        <div className="field-surface history-entity-banner" style={{ padding: '18px 24px', background: '#f8fafc' }}>
          <div className="history-entity-banner__left">
            <span className="field-asset-icon" style={{ width: '40px', height: '40px', background: '#fff' }}>
              <Cpu size={20} color="var(--primary)" />
            </span>
            <div className="history-entity-banner__copy">
              <h3 style={{ fontSize: '0.95rem', fontWeight: 650, color: 'var(--text-main)' }}>{selectedEquipment.name}</h3>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                Patrimônio: <code>{selectedEquipment.asset_tag}</code> · Tipo: {selectedEquipment.type} {selectedEquipment.brand_model ? `· ${selectedEquipment.brand_model}` : ''}
              </p>
            </div>
          </div>
          <div className="history-entity-banner__right">
            <span className={`badge ${selectedEquipment.status === 'Disponível' ? 'badge-success' : selectedEquipment.status === 'Em Uso' ? 'badge-warning' : 'badge-purple'}`}>
              Status: {selectedEquipment.status}
            </span>
          </div>
        </div>
      )}

      {selectedTechnician && (
        <div className="field-surface history-entity-banner" style={{ padding: '18px 24px', background: '#f8fafc' }}>
          <div className="history-entity-banner__left">
            <span className="field-asset-icon" style={{ width: '40px', height: '40px', background: '#fff' }}>
              <User size={20} color="var(--primary)" />
            </span>
            <div className="history-entity-banner__copy">
              <h3 style={{ fontSize: '0.95rem', fontWeight: 650, color: 'var(--text-main)' }}>{selectedTechnician.name}</h3>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                {selectedTechnician.role || 'Técnico de Campo'} {selectedTechnician.phone ? `· Tel: ${selectedTechnician.phone}` : ''}
              </p>
            </div>
          </div>
          <div className="history-entity-banner__right">
            <span className="badge badge-purple">
              {filteredReservations.filter(r => ['Em Uso', 'Reservado'].includes(r.status)).length} item(ns) em posse atualmente
            </span>
          </div>
        </div>
      )}

      {/* History Records Table / Surface */}
      <section className="field-surface" aria-labelledby="history-records-title">
        <header className="field-section-heading">
          <div>
            <h2 id="history-records-title">
              Registros de movimentação
              <span className="field-count">{filteredReservations.length}</span>
            </h2>
            <p>Histórico detalhado com horários de saída, devolução e responsabilidade técnica.</p>
          </div>
        </header>

        {loading ? (
          <div className="field-empty" style={{ minHeight: '200px' }} aria-live="polite">
            <span className="loading-spinner" />
            <p>Carregando histórico de reservas…</p>
          </div>
        ) : error ? (
          <div className="field-empty" style={{ minHeight: '200px', color: '#ef4444' }}>
            <Info size={30} />
            <p>{error}</p>
          </div>
        ) : !filteredReservations.length ? (
          <div className="field-empty" style={{ minHeight: '200px' }}>
            <History size={30} />
            <h3>Nenhum registro encontrado</h3>
            <p>Não há histórico de reservas para a seleção e filtros informados.</p>
          </div>
        ) : (
          <div className="field-table-scroll">
            <table className="field-table">
              <thead>
                <tr>
                  <th scope="col">Padrão / Patrimônio</th>
                  <th scope="col">Responsável</th>
                  <th scope="col">Atendimento / Cliente</th>
                  <th scope="col">Data</th>
                  <th scope="col">Retirada (Checkout)</th>
                  <th scope="col">Devolução (Checkin)</th>
                  <th scope="col">Situação</th>
                  <th scope="col" style={{ width: '50px' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredReservations.map(res => {
                  const isDevolvido = res.status === 'Devolvido';
                  const isEmUso = res.status === 'Em Uso';

                  return (
                    <tr key={res.id}>
                      <td>
                        <div className="field-asset">
                          <span className="field-asset-icon"><PackageCheck size={16} /></span>
                          <div>
                            <strong>{res.analyzer_name || 'Simulador'}</strong>
                            <code>{res.asset_tag || 'Sem patrimônio'}</code>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--text-main)', fontSize: '0.78rem' }}>{res.technician_name || 'Não informado'}</strong>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: 550, color: 'var(--text-main)' }}>{res.client_name || `Atendimento #${res.appointment_id}`}</span>
                          {res.notes && <small style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{res.notes}</small>}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>{formatDate(res.appointment_date || res.reserved_date)}</span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: res.checkout_at ? 'var(--text-main)' : 'var(--text-muted)' }}>
                          {formatDateTime(res.checkout_at)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: res.checkin_at ? 'var(--text-main)' : 'var(--text-muted)' }}>
                          {formatDateTime(res.checkin_at)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${isDevolvido ? 'badge-success' : isEmUso ? 'badge-warning' : 'badge-purple'}`}>
                          {res.status}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => handleDeleteHistoryItem(res.id)}
                          title="Apagar Registro do Histórico (Admin)"
                          style={{
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            color: '#dc2626',
                            padding: '5px 7px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center'
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
