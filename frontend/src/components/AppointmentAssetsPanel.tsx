import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Camera, CarFront, ClipboardCheck, PackageCheck } from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import type { CalendarAppointment, CalendarTechnician } from './CalendarEventEditor';
import './AppointmentAssetsPanel.css';

interface Props {
  appointment: CalendarAppointment;
  technicians: CalendarTechnician[];
  currentUser?: { id?: number | string; role?: string } | null;
  onRefresh?: () => Promise<void>;
}
interface Analyzer { id: number; name: string; asset_tag: string; status: string; calibration_expiry?: string }
interface Vehicle { id: number; name: string; plate: string; status: string; current_km?: number; active_usage?: { id: number } | null }
interface Reservation { id: number; analyzer_id: number; technician_id: number; status: string; asset_tag?: string; analyzer_name?: string; operation_type?: string }

const managementRoles = new Set(['admin', 'manager', 'supervisor']);

async function photoData(file: File | null) {
  if (!file) throw new Error('Adicione uma foto do hodômetro.');
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Use uma foto JPEG, PNG ou WebP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('A foto deve ter no máximo 2 MB.');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    reader.readAsDataURL(file);
  });
}

export function AppointmentAssetsPanel({ appointment, technicians, currentUser, onRefresh }: Props) {
  const [analyzers, setAnalyzers] = useState<Analyzer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [patternId, setPatternId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [km, setKm] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [usageType, setUsageType] = useState('Empresa (Trabalho e deslocamento residência)');
  const [cleanlinessOk, setCleanlinessOk] = useState(true);
  const [revisionStatus, setRevisionStatus] = useState('Em dia');
  const [fluidsChecked, setFluidsChecked] = useState(true);
  const [hasDamage, setHasDamage] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const teamIds = useMemo(() => [...new Set([...(appointment.technician_ids || []), appointment.technician_id].filter(Boolean).map(Number))], [appointment.technician_ids, appointment.technician_id]);
  const team = technicians.filter(person => teamIds.includes(Number(person.id)) && person.status !== 'Inativo');
  const isManager = managementRoles.has(currentUser?.role || '');
  const isTeamMember = teamIds.includes(Number(currentUser?.id));
  const canOperate = isManager || isTeamMember;
  const linkedVehicle = vehicles.find(vehicle => Number(vehicle.id) === Number(appointment.vehicle_id));
  const reservations = (appointment.reservations || []) as Reservation[];
  const availablePatterns = analyzers.filter(item => !/reservado|em uso|emprest|manuten|indispon|baixado/i.test(item.status));

  useEffect(() => {
    let alive = true;
    Promise.all([
      safeFetchJson('/api/analyzers', { cache: 'no-store' }),
      safeFetchJson('/api/fleet/vehicles', { cache: 'no-store' })
    ]).then(([patterns, fleet]) => {
      if (!alive) return;
      setAnalyzers(patterns.analyzers || []);
      setVehicles(fleet.vehicles || []);
    }).catch(() => { if (alive) setError('Não foi possível carregar padrões e veículos. Tente reabrir o atendimento.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const preferred = teamIds.includes(Number(currentUser?.id)) ? Number(currentUser?.id) : teamIds[0];
    setTechnicianId(preferred ? String(preferred) : '');
  }, [appointment.id, currentUser?.id, teamIds.join(',')]);
  useEffect(() => { setVehicleId(appointment.vehicle_id ? String(appointment.vehicle_id) : ''); }, [appointment.vehicle_id]);

  const reservePattern = async (event: FormEvent) => {
    event.preventDefault();
    if (!patternId || !technicianId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await safeFetchJson('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointment_id: appointment.id, analyzer_id: Number(patternId), technician_id: Number(technicianId), operation_type: 'Atendimento' }) });
      if (!result.success) throw new Error(result.error || 'Não foi possível reservar o padrão.');
      setNotice([result.message || 'Padrão reservado para este atendimento.', result.calibration_warning ? result.calibration_message || 'Calibração vencida; confirme antes de retirar.' : ''].filter(Boolean).join(' '));
      setAnalyzers(items => items.map(item => Number(item.id) === Number(patternId) ? { ...item, status: 'Reservado' } : item));
      setPatternId('');
      await onRefresh?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na reserva do padrão.'); }
    finally { setBusy(false); }
  };

  const checkoutPattern = async (reservationId: number) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await safeFetchJson(`/api/reservations/${reservationId}/checkout`, { method: 'POST' });
      if (!result.success) throw new Error(result.error || 'Não foi possível registrar a saída.');
      setNotice(result.message || 'Saída do padrão registrada.');
      await onRefresh?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na retirada do padrão.'); }
    finally { setBusy(false); }
  };

  const reserveVehicle = async () => {
    if (!vehicleId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await safeFetchJson(`/api/appointments/${appointment.id}/workflow`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicle_id: Number(vehicleId) }) });
      if (!result.success) throw new Error(result.error || 'Não foi possível vincular o veículo.');
      setNotice('Veículo reservado para este atendimento.');
      await onRefresh?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na reserva do veículo.'); }
    finally { setBusy(false); }
  };

  const checkoutVehicle = async (event: FormEvent) => {
    event.preventDefault();
    if (!linkedVehicle) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await safeFetchJson(`/api/fleet/vehicles/${linkedVehicle.id}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointment_id: appointment.id, km_initial: Number(km), odometer_photo_data: await photoData(photo), usage_type: usageType, cleanliness_ok: cleanlinessOk, revision_status: revisionStatus, fluids_checked: fluidsChecked, damage_inspection: { has_damage: hasDamage, description: hasDamage ? notes.trim() : '' }, notes: notes.trim() }) });
      if (!result.success) throw new Error(result.error || 'Não foi possível registrar a retirada do carro.');
      setNotice('Carro retirado e associado a este atendimento.');
      setShowVehicleForm(false); setPhoto(null); setKm('');
      const fleet = await safeFetchJson('/api/fleet/vehicles', { cache: 'no-store' });
      setVehicles(fleet.vehicles || []);
      await onRefresh?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na retirada do carro.'); }
    finally { setBusy(false); }
  };

  return <div className="appointment-assets">
    {error && <p className="appointment-assets__message appointment-assets__message--error" role="alert">{error}</p>}
    {notice && <p className="appointment-assets__message" role="status">{notice}</p>}
    <section className="appointment-assets__section" aria-label="Padrões deste atendimento">
      <h3><PackageCheck size={18} />Padrões e analisadores</h3>
      {reservations.length ? <ul className="appointment-assets__list">{reservations.map(item => <li key={item.id}><span><strong>{[item.asset_tag, item.analyzer_name].filter(Boolean).join(' · ') || `Padrão ${item.analyzer_id}`}</strong><small>{item.status}</small></span>{item.status === 'Reservado' && canOperate && (isManager || Number(item.technician_id) === Number(currentUser?.id)) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void checkoutPattern(item.id)}>Registrar retirada</button>}</li>)}</ul> : <p>Nenhum padrão reservado para este atendimento.</p>}
      {canOperate && team.length > 0 && <form className="appointment-assets__inline-form" onSubmit={reservePattern}><label>Padrão disponível<select value={patternId} onChange={event => setPatternId(event.target.value)} required><option value="">Selecione o padrão</option>{availablePatterns.map(item => <option key={item.id} value={item.id}>{item.asset_tag} · {item.name}</option>)}</select></label>{isManager && team.length > 1 && <label>Técnico responsável<select value={technicianId} onChange={event => setTechnicianId(event.target.value)}>{team.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}<button type="submit" className="btn btn-secondary" disabled={busy || !patternId || !technicianId}><ClipboardCheck size={16} />Reservar padrão</button></form>}
      {team.length === 0 && <p className="appointment-assets__hint">Escalone um técnico antes de reservar padrões.</p>}
    </section>
    <section className="appointment-assets__section" aria-label="Carro deste atendimento">
      <h3><CarFront size={18} />Carro da agenda</h3>
      {linkedVehicle ? <div className="appointment-assets__vehicle"><strong>{linkedVehicle.name} · {linkedVehicle.plate}</strong><span>{linkedVehicle.active_usage ? 'Em uso' : 'Reservado para este atendimento'}</span></div> : <p>Nenhum carro vinculado a este atendimento.</p>}
      {isManager && !linkedVehicle && <div className="appointment-assets__inline-form"><label>Carro disponível<select value={vehicleId} onChange={event => setVehicleId(event.target.value)}><option value="">Selecione o carro</option>{vehicles.filter(item => !item.active_usage && !/baixado/i.test(item.status)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.plate}</option>)}</select></label><button type="button" className="btn btn-secondary" disabled={busy || !vehicleId} onClick={() => void reserveVehicle()}>Reservar carro</button></div>}
      {linkedVehicle && !linkedVehicle.active_usage && canOperate && <>{!showVehicleForm ? <button type="button" className="btn btn-secondary" onClick={() => setShowVehicleForm(true)}>Registrar retirada do carro</button> : <form className="appointment-assets__vehicle-form" onSubmit={checkoutVehicle}><label>KM atual<input type="number" min="0" step="0.1" required value={km} onChange={event => setKm(event.target.value)} /></label><label className="appointment-assets__file"><Camera size={16} />Foto do hodômetro<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={event => setPhoto(event.target.files?.[0] || null)} /></label><label>Tipo de deslocamento<select value={usageType} onChange={event => setUsageType(event.target.value)}><option>Empresa (Trabalho e deslocamento residência)</option><option>Particular</option></select></label><label>Status da revisão<select value={revisionStatus} onChange={event => setRevisionStatus(event.target.value)}><option>Em dia</option><option>Próxima</option><option>Pendente</option></select></label><label className="appointment-assets__check"><input type="checkbox" checked={cleanlinessOk} onChange={event => setCleanlinessOk(event.target.checked)} />Veículo limpo</label><label className="appointment-assets__check"><input type="checkbox" checked={fluidsChecked} onChange={event => setFluidsChecked(event.target.checked)} />Água e óleo verificados</label><label className="appointment-assets__check"><input type="checkbox" checked={hasDamage} onChange={event => setHasDamage(event.target.checked)} />Há danos ou avarias na retirada</label><label>Observações{hasDamage ? ' sobre as avarias' : ''}<textarea rows={2} required={hasDamage} value={notes} onChange={event => setNotes(event.target.value)} /></label><div className="appointment-assets__form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setShowVehicleForm(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={busy || !photo || (hasDamage && !notes.trim())}>{busy ? 'Registrando…' : 'Confirmar retirada'}</button></div></form>}</>}
      {!linkedVehicle && !isManager && <p className="appointment-assets__hint">O supervisor precisa reservar o carro nesta agenda antes da retirada.</p>}
    </section>
  </div>;
}
