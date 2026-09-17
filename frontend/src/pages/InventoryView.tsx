import { ModalOverlay } from '../components/ModalOverlay';
import React, { useMemo, useState } from 'react';
import {
  Box,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  ArrowRightLeft,
  ShieldCheck,
  Tag,
  UserRoundCheck,
  RotateCcw,
  Edit2,
  Trash2,
  X,
  AlertTriangle,
  FileSpreadsheet,
  Activity
} from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import { ExcelSyncModal } from '../components/ExcelSyncModal';

import { AuthUser } from '../types/auth';

interface InventoryViewProps {
  analyzers: any[];
  onRefresh: () => void;
  currentUser?: AuthUser | null;
}

const normalizeSearchText = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .trim();

const toLocalIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCalibrationFilter = (expiry: unknown, today: string, warningLimit: string) => {
  const date = String(expiry ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'NO_DATE';
  if (date < today) return 'EXPIRED';
  if (date <= warningLimit) return 'EXPIRING';
  return 'VALID';
};

const formatCalibrationExpiry = (expiry: unknown) => {
  const date = String(expiry ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Sem data informada';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(`${date}T12:00:00`));
};

const getReservationOwner = (item: any) => {
  const reservation = item?.current_reservation;
  if (!reservation) return 'Sem reserva ativa';

  const owner = [reservation.reserved_by, reservation.technician_name, reservation.sector]
    .map(value => String(value ?? '').trim())
    .find(value => value && value !== 'N/A');

  return owner || 'Setor não informado';
};

export const InventoryView: React.FC<InventoryViewProps> = ({ analyzers, onRefresh, currentUser }) => {
  const isAdmin = currentUser?.role === 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [reservationOwnerFilter, setReservationOwnerFilter] = useState('ALL');
  const [calibrationFilter, setCalibrationFilter] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExcelSyncModal, setShowExcelSyncModal] = useState(false);

  // New Analyzer form state
  const [formData, setFormData] = useState({
    asset_tag: '',
    name: '',
    type: 'Analisador de Desfibrilador',
    serial_number: '',
    brand_model: '',
    calibration_date: '',
    calibration_expiry: '',
    current_location: 'Almoxarifado Central',
    notes: ''
  });

  // Edit Analyzer modal state
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => toLocalIsoDate(today), [today]);
  const calibrationWarningIso = useMemo(() => {
    const warningLimit = new Date(today);
    warningLimit.setDate(warningLimit.getDate() + 30);
    return toLocalIsoDate(warningLimit);
  }, [today]);

  const countOptions = (field: 'status' | 'type') => {
    const counts = new Map<string, number>();
    analyzers.forEach(item => {
      const value = String(item[field] ?? '').trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([labelA], [labelB]) => labelA.localeCompare(labelB, 'pt-BR'));
  };

  const statusOptions = useMemo(() => countOptions('status'), [analyzers]);
  const typeOptions = useMemo(() => countOptions('type'), [analyzers]);
  const reservationOwnerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    analyzers.forEach(item => {
      const owner = getReservationOwner(item);
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([ownerA], [ownerB]) => ownerA.localeCompare(ownerB, 'pt-BR'));
  }, [analyzers]);

  const filtered = useMemo(() => {
    const normalizedSearch = normalizeSearchText(searchTerm);

    return analyzers.filter(item => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;

      const owner = getReservationOwner(item);
      if (reservationOwnerFilter !== 'ALL' && owner !== reservationOwnerFilter) return false;

      if (calibrationFilter !== 'ALL') {
        const itemCalibrationStatus = getCalibrationFilter(item.calibration_expiry, todayIso, calibrationWarningIso);
        if (itemCalibrationStatus !== calibrationFilter) return false;
      }

      if (!normalizedSearch) return true;

      const targetText = [
        item.asset_tag,
        item.name,
        item.serial_number,
        item.brand_model,
        item.type,
        owner,
        item.current_location,
        item.notes
      ].map(normalizeSearchText).join(' ');

      return targetText.includes(normalizedSearch);
    });
  }, [analyzers, searchTerm, statusFilter, typeFilter, reservationOwnerFilter, calibrationFilter, todayIso, calibrationWarningIso]);

  const activeFilterCount = [
    statusFilter !== 'ALL',
    typeFilter !== 'ALL',
    reservationOwnerFilter !== 'ALL',
    calibrationFilter !== 'ALL',
    searchTerm.trim().length > 0
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setReservationOwnerFilter('ALL');
    setCalibrationFilter('ALL');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    try {
      const data = await safeFetchJson('/api/analyzers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (data.success) {
        setMsg({ type: 'success', text: `Patrimônio ${formData.asset_tag} cadastrado com sucesso!` });
        setShowAddModal(false);
        setFormData({
          asset_tag: '',
          name: '',
          type: 'Analisador de Desfibrilador',
          serial_number: '',
          brand_model: '',
          calibration_date: '',
          calibration_expiry: '',
          current_location: 'Almoxarifado Central',
          notes: ''
        });
        onRefresh();
      } else {
        setMsg({ type: 'error', text: data.error || 'Erro ao cadastrar analisador.' });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEdit = (item: any) => {
    setEditItem(item);
    setEditFormData({
      asset_tag: item.asset_tag || '',
      name: item.name || '',
      type: item.type || 'Analisador de Desfibrilador',
      serial_number: item.serial_number || '',
      brand_model: item.brand_model || '',
      status: item.status || 'Disponível',
      calibration_date: item.calibration_date ? item.calibration_date.slice(0, 10) : '',
      calibration_expiry: item.calibration_expiry ? item.calibration_expiry.slice(0, 10) : '',
      current_location: item.current_location || 'Almoxarifado Central',
      notes: item.notes || ''
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setLoading(true);
    setMsg(null);

    try {
      const data = await safeFetchJson(`/api/analyzers/${editItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData)
      });
      if (data.success) {
        setMsg({ type: 'success', text: `Patrimônio ${editFormData.asset_tag} atualizado com sucesso!` });
        setEditItem(null);
        onRefresh();
      } else {
        setMsg({ type: 'error', text: data.error || 'Erro ao atualizar patrimônio.' });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item: any) => {
    if (!window.confirm(`⚠️ Tem certeza que deseja excluir o padrão "${item.asset_tag} - ${item.name}" definitivamente do banco de dados?`)) {
      return;
    }
    setLoading(true);
    try {
      const data = await safeFetchJson(`/api/analyzers/${item.id}`, {
        method: 'DELETE'
      });
      if (data.success) {
        setMsg({ type: 'success', text: `Patrimônio ${item.asset_tag} excluído com sucesso!` });
        onRefresh();
      } else {
        setMsg({ type: 'error', text: data.error || 'Falha ao excluir patrimônio.' });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckin = async (resId: number) => {
    if (!window.confirm('Confirmar a devolução (Check-in) deste patrimônio para o almoxarifado?')) return;
    try {
      const data = await safeFetchJson(`/api/reservations/${resId}/checkin`, { method: 'POST' });
      if (data.success) {
        alert(data.message);
        onRefresh();
      }
    } catch (err: any) {
      alert('Erro: ' + err.message);
    }
  };

  const handleCheckout = async (resId: number) => {
    try {
      const data = await safeFetchJson(`/api/reservations/${resId}/checkout`, { method: 'POST' });
      if (data.success) {
        alert(data.message);
        onRefresh();
      }
    } catch (err: any) {
      alert('Erro: ' + err.message);
    }
  };

  const calibrationAlertsCount = useMemo(() => analyzers.filter(a => {
    const st = getCalibrationFilter(a.calibration_expiry, todayIso, calibrationWarningIso);
    return st === 'EXPIRING' || st === 'EXPIRED';
  }).length, [analyzers, todayIso, calibrationWarningIso]);

  return (
    <div className="inventory-view field-dashboard">
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Controle de Patrimônio</span>
          <h1>Inventário de padrões.</h1>
          <p>Rastreabilidade de analisadores, calibrações vigentes e alocação da equipe técnica.</p>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowExcelSyncModal(true)}
              className="btn btn-secondary inventory-excel-sync-button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              title="Sincronizar identificação e datas de calibração via Excel"
            >
              <FileSpreadsheet size={18} aria-hidden="true" /> Sincronizar Excel
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary inventory-add-button"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={18} aria-hidden="true" /> Cadastrar Patrimônio
            </button>
          </div>
        )}
      </header>

      {/* Feedback message */}
      {msg && (
        <div className={`operations-notice ${msg.type === 'success' ? 'is-success' : 'is-error'}`} role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: msg.type === 'success' ? '#ecfdf5' : '#fef2f2', border: `1px solid ${msg.type === 'success' ? '#a7f3d0' : '#fecaca'}`, color: msg.type === 'success' ? '#065f46' : '#991b1b', borderRadius: '8px', fontSize: '0.85rem' }}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor' }}><X size={16} /></button>
        </div>
      )}

      {/* Metrics Strip */}
      <section className="field-metrics" aria-label="Indicadores do inventário">
        <button
          type="button"
          className="field-metric available"
          onClick={() => setStatusFilter('ALL')}
        >
          <span className="field-metric-label">
            Total no acervo
            <Box size={17} aria-hidden="true" />
          </span>
          <strong>{analyzers.length}</strong>
          <span className="field-metric-detail">Patrimônios cadastrados</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('Disponível')}
        >
          <span className="field-metric-label">
            Disponíveis
            <CheckCircle2 size={17} aria-hidden="true" />
          </span>
          <strong>{analyzers.filter(a => a.status === 'Disponível').length}</strong>
          <span className="field-metric-detail">Prontos para saída</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setStatusFilter('Em Uso')}
        >
          <span className="field-metric-label">
            Em campo / reserva
            <Activity size={17} aria-hidden="true" />
          </span>
          <strong>{analyzers.filter(a => a.status === 'Em Uso' || a.status === 'Reservado').length}</strong>
          <span className="field-metric-detail">Alocados com técnicos</span>
        </button>

        <button
          type="button"
          className="field-metric"
          onClick={() => setCalibrationFilter('EXPIRING')}
        >
          <span className="field-metric-label">
            Calibração em atenção
            <AlertTriangle size={17} aria-hidden="true" />
          </span>
          <strong>{calibrationAlertsCount}</strong>
          <span className="field-metric-detail">Vencendo ou vencidos</span>
        </button>
      </section>

      {/* Filter Surface */}
      <section className="field-surface" style={{ padding: '20px 24px' }}>
        <div className="field-section-heading" style={{ padding: '0 0 16px 0', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <div>
            <h2>
              Acervo de Analisadores <span className="field-count">{filtered.length}</span>
            </h2>
            <p>Filtre por patrimônio, série, responsável ou validade de calibração</p>
          </div>
        </div>

        <div className="inventory-filters" style={{ marginTop: '16px' }} role="search" aria-label="Filtros do inventário">
          <label className="filter-field inventory-search-field">
            <span>Buscar patrimônio</span>
            <div className="inventory-search-input">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="Patrimônio, nome, série, modelo ou responsável"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
              />
            </div>
          </label>

          <label className="filter-field">
            <span>Status</span>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="ALL">Todos os status</option>
              {statusOptions.map(([status, count]) => (
                <option key={status} value={status}>{status} ({count})</option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Tipo de equipamento</span>
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
              <option value="ALL">Todos os tipos</option>
              {typeOptions.map(([type, count]) => (
                <option key={type} value={type}>{type} ({count})</option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Alocado para</span>
            <select value={reservationOwnerFilter} onChange={event => setReservationOwnerFilter(event.target.value)}>
              <option value="ALL">Todos os responsáveis</option>
              {reservationOwnerOptions.map(([owner, count]) => (
                <option key={owner} value={owner}>{owner} ({count})</option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Validade da calibração</span>
            <select value={calibrationFilter} onChange={event => setCalibrationFilter(event.target.value)}>
              <option value="ALL">Todas as validades</option>
              <option value="VALID">Válida</option>
              <option value="EXPIRING">Vence em até 30 dias</option>
              <option value="EXPIRED">Vencida</option>
              <option value="NO_DATE">Sem data informada</option>
            </select>
          </label>
        </div>

        {activeFilterCount > 0 && (
          <div className="inventory-active-filters" style={{ marginTop: '16px' }} aria-label="Filtros selecionados">
            <span className="inventory-active-filters__label">Filtros aplicados:</span>
            {searchTerm.trim() && (
              <span className="inventory-filter-chip">
                Busca: "{searchTerm.trim()}"
                <button type="button" onClick={() => setSearchTerm('')} aria-label="Remover busca">×</button>
              </span>
            )}
            {statusFilter !== 'ALL' && (
              <span className="inventory-filter-chip">
                Status: {statusFilter}
                <button type="button" onClick={() => setStatusFilter('ALL')} aria-label="Remover filtro de status">×</button>
              </span>
            )}
            {typeFilter !== 'ALL' && (
              <span className="inventory-filter-chip">
                Tipo: {typeFilter}
                <button type="button" onClick={() => setTypeFilter('ALL')} aria-label="Remover filtro de tipo">×</button>
              </span>
            )}
            {reservationOwnerFilter !== 'ALL' && (
              <span className="inventory-filter-chip">
                Alocado para: {reservationOwnerFilter}
                <button type="button" onClick={() => setReservationOwnerFilter('ALL')} aria-label="Remover filtro de alocação">×</button>
              </span>
            )}
            {calibrationFilter !== 'ALL' && (
              <span className="inventory-filter-chip">
                Calibração: {calibrationFilter}
                <button type="button" onClick={() => setCalibrationFilter('ALL')} aria-label="Remover filtro de calibração">×</button>
              </span>
            )}
            <button type="button" className="btn btn-secondary btn-sm inventory-clear-all" onClick={clearFilters}>
              <RotateCcw size={14} aria-hidden="true" /> Limpar todos
            </button>
          </div>
        )}
      </section>

      {/* Grid of Analyzers */}
      {filtered.length > 0 ? (
        <div className="field-inventory-grid">
        {filtered.map(item => {
          const isReserved = item.status === 'Reservado';
          const isInUse = item.status === 'Em Uso';
          const isMaintenance = item.status === 'Em Manutenção';
          const isAvailable = item.status === 'Disponível';
          const reservationOwner = getReservationOwner(item);
          const calibrationState = getCalibrationFilter(item.calibration_expiry, todayIso, calibrationWarningIso);

          return (
            <div key={item.id} className="glass-panel" style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '18px',
              border: isMaintenance ? '1px solid #fecaca' : isInUse ? '1px solid #fed7aa' : isReserved ? '1px solid #bfdbfe' : '1px solid var(--border-color)',
              position: 'relative'
            }}>
              <div>
                {/* Header Tag & Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    color: 'var(--primary)'
                  }}>
                    <Tag size={13} style={{ display: 'inline', marginRight: '4px' }} />
                    {item.asset_tag}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`badge ${
                      isAvailable ? 'badge-success' :
                      isReserved ? 'badge-warning' :
                      isInUse ? 'badge-danger' :
                      'badge-neutral'
                    }`} style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                      {item.status}
                    </span>

                    {/* Admin Actions: Edit & Delete (Apenas Administrador) */}
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          title="Editar Padrão (Admin)"
                          style={{
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '6px',
                            color: '#1d4ed8',
                            padding: '4px 6px',
                            cursor: 'pointer'
                          }}
                        >
                          <Edit2 size={13} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          title="Excluir Padrão do Banco (Admin)"
                          style={{
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            color: '#dc2626',
                            padding: '4px 6px',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px' }}>
                  {item.name}
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Tipo: <strong style={{ color: 'var(--text-main)' }}>{item.type}</strong>
                </p>

                {/* Details list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.82rem', color: 'var(--text-muted)', background: '#f7f9fc', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px' }}>
                  <div>Modelo: <span style={{ color: 'var(--text-main)' }}>{item.brand_model}</span></div>
                  <div>Nº de Série: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{item.serial_number}</span></div>
                  <div>Reservado por: <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{reservationOwner}</span></div>
                  <div>Validade Calibração: <span className={`calibration-value calibration-value--${calibrationState.toLowerCase()}`}>{formatCalibrationExpiry(item.calibration_expiry)}</span></div>
                </div>

                {/* Active Reservation Block */}
                {item.current_reservation && (
                  <div style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px dashed rgba(59, 130, 246, 0.3)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    marginBottom: '14px',
                    fontSize: '0.8rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: 'var(--primary)', marginBottom: '4px' }}>
                      <UserRoundCheck size={15} aria-hidden="true" /> Alocado para Atendimento
                    </div>
                    <div>Responsável: <strong>{reservationOwner}</strong></div>
                    <div>Cliente: <strong>{item.current_reservation.client_name}</strong></div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                {item.current_reservation && isReserved && (
                  <button onClick={() => handleCheckout(item.current_reservation.id)} className="btn btn-primary btn-sm" style={{ width: '100%' }}>
                    <ArrowRightLeft size={14} /> Registrar Check-out (Retirada)
                  </button>
                )}

                {item.current_reservation && isInUse && (
                  <button onClick={() => handleCheckin(item.current_reservation.id)} className="btn btn-success btn-sm" style={{ width: '100%' }}>
                    <CheckCircle2 size={14} /> Registrar Check-in (Devolução)
                  </button>
                )}

                {isAvailable && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={14} /> Pronto para reserva no painel e portal técnico
                  </span>
                )}
              </div>

            </div>
          );
        })}
        </div>
      ) : (
        <div className="field-empty field-surface" style={{ padding: '48px 24px' }}>
          <Box size={36} />
          <h3>Nenhum patrimônio encontrado</h3>
          <p>Revise os termos da busca ou limpe os filtros para ampliar os resultados.</p>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '12px' }} onClick={clearFilters}>
            <RotateCcw size={15} /> Limpar filtros
          </button>
        </div>
      )}

      {/* Add Analyzer Modal */}
      {showAddModal && (
        <ModalOverlay onDismiss={() => { if (!loading) setShowAddModal(false); }} role="dialog" aria-modal="true" aria-label="Cadastrar novo padrão" style={{
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
          <div className="glass-panel" style={{ width: '100%', maxWidth: '520px', padding: '24px', position: 'relative' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '16px' }}>
              Cadastrar Novo Analisador / Patrimônio
            </h3>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="field-modal-form-grid">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nº de Patrimônio *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: 005130"
                    className="input-field"
                    value={formData.asset_tag}
                    onChange={e => setFormData({ ...formData, asset_tag: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nº de Série *</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: SN-FLK88201"
                    className="input-field"
                    value={formData.serial_number}
                    onChange={e => setFormData({ ...formData, serial_number: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nome do Analisador *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Analisador de Desfibrilador Fluke Impulse 7000"
                  className="input-field"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tipo do Analisador *</label>
                <select
                  className="select-field"
                  value={formData.type}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="Analisador de Desfibrilador">Analisador de Desfibrilador</option>
                  <option value="Simulador de Sinais Vitais (Multiparamétrico)">Simulador de Sinais Vitais (Multiparamétrico)</option>
                  <option value="Analisador de Segurança Elétrica">Analisador de Segurança Elétrica</option>
                  <option value="Analisador de Fluxo de Gás e Pressão">Analisador de Fluxo de Gás e Pressão</option>
                  <option value="Analisador de Infusão / Fluxômetro">Analisador de Infusão / Fluxômetro</option>
                </select>
              </div>

              <div className="field-modal-form-grid">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Marca / Modelo</label>
                  <input
                    type="text"
                    placeholder="ex: Fluke Impulse 7000DP"
                    className="input-field"
                    value={formData.brand_model}
                    onChange={e => setFormData({ ...formData, brand_model: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vencimento Calibração</label>
                  <input
                    type="date"
                    className="input-field"
                    value={formData.calibration_expiry}
                    onChange={e => setFormData({ ...formData, calibration_expiry: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Salvando...' : 'Salvar Patrimônio'}
                </button>
              </div>
            </form>

          </div>
        </ModalOverlay>
      )}

      {/* Edit Analyzer Modal */}
      {editItem && (
        <ModalOverlay onDismiss={() => { if (!loading) setEditItem(null); }} role="dialog" aria-modal="true" aria-label="Editar patrimônio" style={{
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
          <div className="glass-panel" style={{ width: '100%', maxWidth: '560px', padding: '24px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                ✏️ Editar Patrimônio (Admin Master)
              </h3>
              <button type="button" onClick={() => setEditItem(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="field-modal-form-grid">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nº de Patrimônio *</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={editFormData.asset_tag}
                    onChange={e => setEditFormData({ ...editFormData, asset_tag: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status do Padrão *</label>
                  <select
                    className="select-field"
                    value={editFormData.status}
                    onChange={e => setEditFormData({ ...editFormData, status: e.target.value })}
                  >
                    <option value="Disponível">Disponível</option>
                    <option value="Reservado">Reservado</option>
                    <option value="Em Uso">Em Uso</option>
                    <option value="Em Manutenção">Em Manutenção</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nome do Padrão / Analisador *</label>
                <input
                  type="text"
                  required
                  className="input-field"
                  value={editFormData.name}
                  onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                />
              </div>

              <div className="field-modal-form-grid">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Marca / Modelo</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editFormData.brand_model}
                    onChange={e => setEditFormData({ ...editFormData, brand_model: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nº de Série</label>
                  <input
                    type="text"
                    className="input-field"
                    value={editFormData.serial_number}
                    onChange={e => setEditFormData({ ...editFormData, serial_number: e.target.value })}
                  />
                </div>
              </div>

              <div className="field-modal-form-grid">
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Data da Calibração</label>
                  <input
                    type="date"
                    className="input-field"
                    value={editFormData.calibration_date}
                    onChange={e => setEditFormData({ ...editFormData, calibration_date: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vencimento da Calibração</label>
                  <input
                    type="date"
                    className="input-field"
                    value={editFormData.calibration_expiry}
                    onChange={e => setEditFormData({ ...editFormData, calibration_expiry: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Localização no Setor</label>
                <input
                  type="text"
                  className="input-field"
                  value={editFormData.current_location}
                  onChange={e => setEditFormData({ ...editFormData, current_location: e.target.value })}
                />
              </div>

              <div className="field-modal-actions">
                <button type="button" onClick={() => setEditItem(null)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Salvando...' : 'Salvar Alterações no Banco'}
                </button>
              </div>
            </form>

          </div>
        </ModalOverlay>
      )}

      {/* Excel Synchronization Modal */}
      <ExcelSyncModal
        isOpen={showExcelSyncModal}
        onClose={() => setShowExcelSyncModal(false)}
        onSuccess={() => {
          onRefresh();
          setMsg({ type: 'success', text: 'Sincronização de padrões via Excel concluída com sucesso!' });
        }}
        existingAnalyzers={analyzers}
      />

    </div>
  );
};

export default InventoryView;
