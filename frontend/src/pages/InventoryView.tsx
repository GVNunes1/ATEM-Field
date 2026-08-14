import React, { useMemo, useState } from 'react';
import { Box, Plus, Search, Filter, CheckCircle2, ArrowRightLeft, ShieldCheck, Tag, UserRoundCheck, RotateCcw } from 'lucide-react';
import { safeFetchJson } from '../lib/api';

interface InventoryViewProps {
  analyzers: any[];
  onRefresh: () => void;
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

export const InventoryView: React.FC<InventoryViewProps> = ({ analyzers, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [reservationOwnerFilter, setReservationOwnerFilter] = useState('ALL');
  const [calibrationFilter, setCalibrationFilter] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);

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
    const normalizedTerm = normalizeSearchText(searchTerm);

    return analyzers.filter(item => {
      const reservationOwner = getReservationOwner(item);
      const searchableText = normalizeSearchText([
        item.asset_tag,
        item.name,
        item.type,
        item.serial_number,
        item.brand_model,
        reservationOwner,
        item.notes
      ].join(' '));

      const matchesSearch = !normalizedTerm || searchableText.includes(normalizedTerm);
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      const matchesType = typeFilter === 'ALL' || item.type === typeFilter;
      const matchesReservationOwner = reservationOwnerFilter === 'ALL' || reservationOwner === reservationOwnerFilter;
      const itemCalibrationFilter = getCalibrationFilter(item.calibration_expiry, todayIso, calibrationWarningIso);
      const matchesCalibration = calibrationFilter === 'ALL' || itemCalibrationFilter === calibrationFilter;

      return matchesSearch && matchesStatus && matchesType && matchesReservationOwner && matchesCalibration;
    });
  }, [analyzers, searchTerm, statusFilter, typeFilter, reservationOwnerFilter, calibrationFilter, todayIso, calibrationWarningIso]);

  const activeFilterCount = [
    Boolean(searchTerm.trim()),
    statusFilter !== 'ALL',
    typeFilter !== 'ALL',
    reservationOwnerFilter !== 'ALL',
    calibrationFilter !== 'ALL'
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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Action & Filter Bar */}
      <section className="glass-panel inventory-control-panel" aria-labelledby="inventory-title">
        <div className="inventory-control-panel__header">
          <div>
            <h2 id="inventory-title" className="inventory-title">
              <Box size={22} aria-hidden="true" /> Inventário de Patrimônios & Analisadores
            </h2>
            <p className="inventory-description">
              Controle individual por número de patrimônio, rastreabilidade de calibração e status de alocação.
            </p>
            <p className="inventory-result-count" aria-live="polite">
              Exibindo <strong>{filtered.length.toLocaleString('pt-BR')}</strong> de <strong>{analyzers.length.toLocaleString('pt-BR')}</strong> patrimônios carregados.
              {activeFilterCount > 0 && <span> · {activeFilterCount} {activeFilterCount === 1 ? 'filtro ativo' : 'filtros ativos'}</span>}
            </p>
          </div>

          <button onClick={() => setShowAddModal(true)} className="btn btn-primary inventory-add-button">
            <Plus size={18} aria-hidden="true" /> Cadastrar Patrimônio
          </button>
        </div>

        <div className="inventory-filters" role="search" aria-label="Filtros do inventário">
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
            <span>Reservado por</span>
            <select value={reservationOwnerFilter} onChange={event => setReservationOwnerFilter(event.target.value)}>
              <option value="ALL">Todos os responsáveis</option>
              {reservationOwnerOptions.map(([owner, count]) => (
                <option key={owner} value={owner}>{owner} ({count})</option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Calibração</span>
            <select value={calibrationFilter} onChange={event => setCalibrationFilter(event.target.value)}>
              <option value="ALL">Todas as validades</option>
              <option value="EXPIRED">Vencida</option>
              <option value="EXPIRING">Vence em até 30 dias</option>
              <option value="VALID">Válida por mais de 30 dias</option>
              <option value="NO_DATE">Sem data informada</option>
            </select>
          </label>

          <div className="inventory-filter-actions">
            <Filter size={16} aria-hidden="true" />
            <span>{activeFilterCount > 0 ? `${activeFilterCount} ativo${activeFilterCount > 1 ? 's' : ''}` : 'Sem filtros'}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters} disabled={activeFilterCount === 0}>
              <RotateCcw size={14} aria-hidden="true" /> Limpar
            </button>
          </div>
        </div>
      </section>

      {msg && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: msg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: msg.type === 'success' ? '#34d399' : '#f87171',
          border: `1px solid ${msg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
        }}>
          {msg.text}
        </div>
      )}

      {/* Grid of Analyzer Cards */}
      <div className="inventory-grid">
        {filtered.map((item: any) => {
          const isAvailable = item.status === 'Disponível';
          const isReserved = item.status === 'Reservado';
          const isInUse = item.status === 'Em Uso';
          const calibrationState = getCalibrationFilter(item.calibration_expiry, todayIso, calibrationWarningIso);
          const reservationOwner = getReservationOwner(item);

          return (
            <div key={item.id} className="glass-panel" style={{
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div>
                {/* Header Asset Tag & Status Badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Tag size={16} color="var(--primary)" />
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1rem', color: 'var(--primary)' }}>
                      {item.asset_tag}
                    </span>
                  </div>
                  <span className={`badge ${
                    isAvailable ? 'badge-success' : isReserved ? 'badge-info' : isInUse ? 'badge-purple' : 'badge-warning'
                  }`}>
                    {item.status}
                  </span>
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

                {/* Active Reservation Block if reserved or in use */}
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

        {filtered.length === 0 && (
          <div className="inventory-empty-state">
            <Filter size={24} aria-hidden="true" />
            <h3>Nenhum patrimônio encontrado</h3>
            <p>Revise os termos da busca ou remova alguns filtros para ampliar os resultados.</p>
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              <RotateCcw size={16} aria-hidden="true" /> Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Add Analyzer Modal */}
      {showAddModal && (
        <div style={{
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
        </div>
      )}

    </div>
  );
};
