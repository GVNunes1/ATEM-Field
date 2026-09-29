import { useCallback, useEffect, useMemo, useState } from 'react';
import { CarFront, RefreshCw, Search } from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import './FleetHistoryPanel.css';

interface FleetMovement {
  id: string;
  kind: 'usage' | 'reservation';
  vehicle_id: number | null;
  vehicle_name: string;
  plate: string;
  appointment_id: number | null;
  client_name: string;
  responsible_name: string;
  returned_by_name?: string | null;
  status: string;
  occurred_at: string;
  checkout_at?: string | null;
  checkin_at?: string | null;
  km_initial?: number | null;
  km_final?: number | null;
  notes?: string | null;
}

const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const km = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString('pt-BR');

export function FleetHistoryPanel() {
  const [movements, setMovements] = useState<FleetMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [error, setError] = useState('');
  const [vehicleId, setVehicleId] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    setError('');
    try {
      const result = await safeFetchJson(`/api/fleet/history?offset=${offset}`, { cache: 'no-store' });
      if (!result.success) throw new Error(result.error || 'Não foi possível carregar o histórico da frota.');
      setMovements(previous => offset === 0 ? result.movements || [] : [...previous, ...(result.movements || [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
      setHasMore(Boolean(result.has_more));
      setNextOffset(offset + 100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o histórico da frota.');
    } finally { setLoading(false); setLoadingMore(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const vehicles = useMemo(() => [...new Map(movements.filter(item => item.vehicle_id)
    .map(item => [Number(item.vehicle_id), { id: Number(item.vehicle_id), name: item.vehicle_name, plate: item.plate }])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), [movements]);
  const filtered = useMemo(() => movements.filter(item => {
    if (vehicleId !== 'all' && Number(item.vehicle_id) !== Number(vehicleId)) return false;
    if (status !== 'all' && item.status !== status) return false;
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return !term || [item.vehicle_name, item.plate, item.client_name, item.responsible_name, item.returned_by_name, item.notes]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(term));
  }), [movements, vehicleId, status, search]);

  return <section className="fleet-audit" aria-labelledby="fleet-audit-title">
    <div className="fleet-audit__heading"><div><h2 id="fleet-audit-title">Histórico da frota</h2><p>Reservas, cancelamentos, retiradas e devoluções dos carros.</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />Atualizar</button></div>
    <div className="fleet-audit__filters">
      <label>Carro<select value={vehicleId} onChange={event => setVehicleId(event.target.value)}><option value="all">Todos os carros</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select></label>
      <label>Situação<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todas</option>{['Reservado', 'Reserva cancelada', 'Reserva alterada', 'Em Uso', 'Devolvido', 'Devolvido com pendência', 'Cancelado'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Buscar<span className="fleet-audit__search"><Search size={16} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Placa, pessoa ou atendimento" /></span></label>
    </div>
    <p className="fleet-audit__count" role="status">{filtered.length} {filtered.length === 1 ? 'movimentação' : 'movimentações'} no filtro</p>
    {loading ? <p className="fleet-audit__state" role="status">Carregando histórico da frota…</p>
      : error && movements.length === 0 ? <div className="fleet-audit__state" role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => void load()}>Tentar novamente</button></div>
        : filtered.length === 0 ? <p className="fleet-audit__state">Nenhuma movimentação encontrada para estes filtros.</p>
          : <div className="fleet-audit__table-wrap"><table className="field-table fleet-audit__table"><thead><tr><th>Carro</th><th>Movimento</th><th>Atendimento</th><th>Responsável</th><th>Registro</th><th>Saída / retorno</th><th>KM saída / retorno</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}>
            <td><span className="fleet-audit__vehicle"><CarFront size={16} aria-hidden="true" /><span><strong>{item.vehicle_name}</strong><small>{item.plate || 'Placa não informada'}</small></span></span></td>
            <td><span className="fleet-audit__status">{item.status}</span></td>
            <td>{item.client_name || (item.appointment_id ? `Atendimento #${item.appointment_id}` : 'Sem atendimento')}</td>
            <td><strong>{item.responsible_name}</strong>{item.returned_by_name && <small className="fleet-audit__secondary">Devolvido por {item.returned_by_name}</small>}</td>
            <td>{dateTime(item.occurred_at)}</td>
            <td>{item.kind === 'usage' ? <><span>{dateTime(item.checkout_at)}</span><small className="fleet-audit__secondary">{dateTime(item.checkin_at)}</small></> : 'Reserva na agenda'}</td>
            <td>{item.kind === 'usage' ? `${km(item.km_initial)} / ${km(item.km_final)}` : '—'}</td>
          </tr>)}</tbody></table></div>}
    {error && movements.length > 0 && <p role="alert" className="fleet-audit__error">{error}</p>}
    {hasMore && !loading && <button type="button" className="btn btn-secondary fleet-audit__more" disabled={loadingMore} onClick={() => void load(nextOffset)}>{loadingMore ? 'Carregando…' : 'Carregar mais movimentações'}</button>}
  </section>;
}
