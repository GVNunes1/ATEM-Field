import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CarFront,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Plus,
  RotateCcw,
  TimerReset,
  TriangleAlert,
  X
} from 'lucide-react';
import { ModalOverlay } from '../components/ModalOverlay';
import { safeFetchJson } from '../lib/api';
import { AuthUser } from '../types/auth';
import './FleetView.css';

interface FleetViewProps {
  appointments: any[];
  currentUser?: AuthUser | null;
  onRefresh: () => Promise<void>;
}

type ModalMode = 'checkout' | 'checkin' | 'vehicle' | null;

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const formatDate = (value: string) => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00`)).replace('.', '') : 'Sem data';

async function fileToDataUrl(file: File | undefined) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Envie uma foto JPEG, PNG ou WebP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('A foto deve ter no máximo 2 MB.');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    reader.readAsDataURL(file);
  });
}

export function FleetView({ appointments, currentUser, onRefresh }: FleetViewProps) {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkoutForm, setCheckoutForm] = useState({ appointment_id: '', km_initial: '', photo: null as File | null, body_ok: true, tires_ok: true, glass_ok: true, notes: '' });
  const [checkinForm, setCheckinForm] = useState({ km_final: '', photo: null as File | null, has_new_damage: false, fuel_checked: true, tires_calibrated: true, notes: '' });
  const [vehicleForm, setVehicleForm] = useState({ name: '', plate: '', brand_model: '', current_km: '' });

  const loadFleet = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await safeFetchJson('/api/fleet/vehicles', { cache: 'no-store' });
      if (!data.success) throw new Error(data.error || 'Não foi possível carregar a frota.');
      setVehicles(data.vehicles || []);
      setUsage(data.usage || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao carregar a frota.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFleet(); }, []);

  const upcomingAppointments = useMemo(() => appointments
    .filter(item => item.appointment_date && item.appointment_date >= todayKey() && !/cancelado/i.test(`${item.status || ''} ${item.workflow_status || ''}`))
    .sort((a, b) => `${a.appointment_date} ${a.appointment_time || ''}`.localeCompare(`${b.appointment_date} ${b.appointment_time || ''}`)), [appointments]);

  const closeModal = () => { if (!saving) setModalMode(null); };
  const refreshAll = async () => { await Promise.all([loadFleet(), onRefresh()]); };

  const submitCheckout = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedVehicle) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const photo = await fileToDataUrl(checkoutForm.photo || undefined);
      const data = await safeFetchJson(`/api/fleet/vehicles/${selectedVehicle.id}/checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: checkoutForm.appointment_id || undefined,
          km_initial: Number(checkoutForm.km_initial),
          odometer_photo_data: photo,
          damage_inspection: { body_ok: checkoutForm.body_ok, tires_ok: checkoutForm.tires_ok, glass_ok: checkoutForm.glass_ok },
          notes: checkoutForm.notes
        })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível registrar a retirada.');
      setNotice(data.message || 'Retirada registrada.');
      setModalMode(null);
      setCheckoutForm({ appointment_id: '', km_initial: '', photo: null, body_ok: true, tires_ok: true, glass_ok: true, notes: '' });
      await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao registrar a retirada.');
    } finally { setSaving(false); }
  };

  const submitCheckin = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUsage) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const photo = await fileToDataUrl(checkinForm.photo || undefined);
      const data = await safeFetchJson(`/api/fleet/usage/${selectedUsage.id}/checkin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          km_final: Number(checkinForm.km_final),
          return_photo_data: photo,
          damage_inspection: { has_new_damage: checkinForm.has_new_damage, requires_review: checkinForm.has_new_damage },
          fuel_checked: checkinForm.fuel_checked,
          tires_calibrated: checkinForm.tires_calibrated,
          notes: checkinForm.notes
        })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível registrar a devolução.');
      setNotice(data.message || 'Devolução registrada.');
      setModalMode(null);
      setCheckinForm({ km_final: '', photo: null, has_new_damage: false, fuel_checked: true, tires_calibrated: true, notes: '' });
      await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao registrar a devolução.');
    } finally { setSaving(false); }
  };

  const submitVehicle = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await safeFetchJson('/api/fleet/vehicles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...vehicleForm, current_km: Number(vehicleForm.current_km) })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível cadastrar o veículo.');
      setNotice('Veículo cadastrado.'); setModalMode(null); setVehicleForm({ name: '', plate: '', brand_model: '', current_km: '' }); await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao cadastrar o veículo.');
    } finally { setSaving(false); }
  };

  const openCheckout = (vehicle: any) => { setSelectedVehicle(vehicle); setModalMode('checkout'); setError(''); };
  const openCheckin = (activeUsage: any) => { setSelectedUsage(activeUsage); setModalMode('checkin'); setError(''); setCheckinForm(form => ({ ...form, km_final: String(activeUsage?.vehicle?.current_km || '') })); };

  return (
    <section className="fleet-page" aria-labelledby="fleet-heading">
      <header className="field-page-heading fleet-heading">
        <div>
          <span className="field-eyebrow">Patrimônio em campo</span>
          <h1 id="fleet-heading">Frota</h1>
          <p>Retirada e devolução com KM, evidência fotográfica e checklist de condição.</p>
        </div>
        {currentUser?.role === 'admin' && <button className="btn btn-primary" onClick={() => setModalMode('vehicle')}><Plus size={16} /> Novo veículo</button>}
      </header>

      {notice && <div className="fleet-notice fleet-notice--success" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && <div className="fleet-notice fleet-notice--error" role="alert"><TriangleAlert size={17} />{error}<button onClick={() => setError('')} aria-label="Fechar alerta"><X size={15} /></button></div>}

      <div className="fleet-summary" aria-label="Resumo da frota">
        <div><span>Veículos</span><strong>{vehicles.length}</strong></div>
        <div><span>Em uso</span><strong>{vehicles.filter(vehicle => vehicle.active_usage).length}</strong></div>
        <div><span>Disponíveis</span><strong>{vehicles.filter(vehicle => vehicle.status === 'Disponível').length}</strong></div>
        <div><span>Em revisão</span><strong>{vehicles.filter(vehicle => vehicle.status === 'Em revisão').length}</strong></div>
      </div>

      {loading ? <div className="fleet-empty">Carregando frota…</div> : vehicles.length === 0 ? (
        <div className="fleet-empty"><CarFront size={28} /><strong>Nenhum veículo cadastrado</strong><span>Cadastre a primeira viatura para iniciar o controle de retiradas.</span></div>
      ) : (
        <div className="fleet-grid">
          {vehicles.map(vehicle => {
            const activeUsage = vehicle.active_usage;
            const scheduled = vehicle.scheduled_appointments?.[0];
            return <article className="fleet-card" key={vehicle.id}>
              <div className="fleet-card-top"><span className={`fleet-status fleet-status--${String(vehicle.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{vehicle.status}</span><CarFront size={22} /></div>
              <h2>{vehicle.name}</h2><p className="fleet-plate">{vehicle.plate} {vehicle.brand_model ? `· ${vehicle.brand_model}` : ''}</p>
              <div className="fleet-km"><Gauge size={16} /><span>KM atual</span><strong>{Number(vehicle.current_km || 0).toLocaleString('pt-BR')}</strong></div>
              {activeUsage ? <div className="fleet-active"><span><TimerReset size={15} /> Em uso por {activeUsage.withdrawn_by_name || 'usuário'}</span><button className="btn btn-secondary btn-sm" onClick={() => openCheckin({ ...activeUsage, vehicle })}><RotateCcw size={15} /> Registrar devolução</button></div> : <button className="btn btn-primary fleet-action" onClick={() => openCheckout(vehicle)} disabled={vehicle.status !== 'Disponível'}><ClipboardCheck size={16} /> Registrar retirada</button>}
              {scheduled && <div className="fleet-scheduled"><span>Próxima agenda</span><strong>{formatDate(scheduled.appointment_date)} · {scheduled.appointment_time || 'horário pendente'}</strong><small>{scheduled.client_name || scheduled.title}</small></div>}
            </article>;
          })}
        </div>
      )}

      {usage.length > 0 && <section className="fleet-history"><div className="fleet-section-title"><div><span className="field-eyebrow">Rastreabilidade</span><h2>Últimas movimentações</h2></div><button className="btn btn-secondary btn-sm" onClick={() => void loadFleet()}>Atualizar</button></div><div className="fleet-history-list">{usage.slice(0, 8).map(item => <div key={item.id}><span className={`fleet-dot fleet-dot--${item.status === 'Em Uso' ? 'active' : item.status === 'Devolvido com pendência' ? 'warning' : 'done'}`} /><div><strong>{item.withdrawn_by_name || 'Usuário'} · {item.status}</strong><small>Saída em {new Date(item.checkout_at).toLocaleString('pt-BR')} · KM {item.km_initial}</small></div></div>)}</div></section>}

      {modalMode === 'checkout' && selectedVehicle && <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-checkout-title"><div className="fleet-modal"><div className="fleet-modal-heading"><div><span className="field-eyebrow">Saída de veículo</span><h2 id="fleet-checkout-title">{selectedVehicle.name}</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={submitCheckout} className="fleet-form"><label>Agendamento associado<select value={checkoutForm.appointment_id} onChange={event => setCheckoutForm({ ...checkoutForm, appointment_id: event.target.value })}><option value="">Uso avulso / sem agenda</option>{upcomingAppointments.map(item => <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.appointment_time || 'horário pendente'} · {item.client_name || item.title}</option>)}</select></label><label>KM do hodômetro<input type="number" min="0" step="0.1" required value={checkoutForm.km_initial} onChange={event => setCheckoutForm({ ...checkoutForm, km_initial: event.target.value })} /></label><label className="fleet-file"><Camera size={16} /> Foto do hodômetro<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={event => setCheckoutForm({ ...checkoutForm, photo: event.target.files?.[0] || null })} /></label><fieldset><legend>Condições na retirada</legend><label><input type="checkbox" checked={checkoutForm.body_ok} onChange={event => setCheckoutForm({ ...checkoutForm, body_ok: event.target.checked })} /> Carroceria sem nova avaria</label><label><input type="checkbox" checked={checkoutForm.tires_ok} onChange={event => setCheckoutForm({ ...checkoutForm, tires_ok: event.target.checked })} /> Pneus em condição adequada</label><label><input type="checkbox" checked={checkoutForm.glass_ok} onChange={event => setCheckoutForm({ ...checkoutForm, glass_ok: event.target.checked })} /> Vidros e acessórios conferidos</label></fieldset><label>Observações<textarea rows={3} value={checkoutForm.notes} onChange={event => setCheckoutForm({ ...checkoutForm, notes: event.target.value })} /></label><button className="btn btn-primary fleet-submit" disabled={saving}>{saving ? 'Registrando…' : 'Confirmar retirada'}</button></form></div></ModalOverlay>}

      {modalMode === 'checkin' && selectedUsage && <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-checkin-title"><div className="fleet-modal"><div className="fleet-modal-heading"><div><span className="field-eyebrow">Retorno de veículo</span><h2 id="fleet-checkin-title">Checklist de devolução</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={submitCheckin} className="fleet-form"><label>KM de retorno<input type="number" min={selectedUsage.km_initial} step="0.1" required value={checkinForm.km_final} onChange={event => setCheckinForm({ ...checkinForm, km_final: event.target.value })} /></label><label className="fleet-file"><Camera size={16} /> Foto do retorno<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={event => setCheckinForm({ ...checkinForm, photo: event.target.files?.[0] || null })} /></label><fieldset><legend>Condições na devolução</legend><label><input type="checkbox" checked={checkinForm.has_new_damage} onChange={event => setCheckinForm({ ...checkinForm, has_new_damage: event.target.checked })} /> Há nova avaria ou precisa de revisão</label><label><input type="checkbox" checked={checkinForm.fuel_checked} onChange={event => setCheckinForm({ ...checkinForm, fuel_checked: event.target.checked })} /> Abastecimento conferido</label><label><input type="checkbox" checked={checkinForm.tires_calibrated} onChange={event => setCheckinForm({ ...checkinForm, tires_calibrated: event.target.checked })} /> Pneus calibrados</label></fieldset><label>Observações<textarea rows={3} value={checkinForm.notes} onChange={event => setCheckinForm({ ...checkinForm, notes: event.target.value })} /></label><button className="btn btn-primary fleet-submit" disabled={saving}>{saving ? 'Registrando…' : 'Confirmar devolução'}</button></form></div></ModalOverlay>}

      {modalMode === 'vehicle' && <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-vehicle-title"><div className="fleet-modal"><div className="fleet-modal-heading"><div><span className="field-eyebrow">Cadastro</span><h2 id="fleet-vehicle-title">Novo veículo</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={submitVehicle} className="fleet-form"><label>Nome de identificação<input required value={vehicleForm.name} onChange={event => setVehicleForm({ ...vehicleForm, name: event.target.value })} placeholder="Van Assistência 01" /></label><label>Placa<input required value={vehicleForm.plate} onChange={event => setVehicleForm({ ...vehicleForm, plate: event.target.value.toUpperCase() })} placeholder="ABC1D23" /></label><label>Marca e modelo<input value={vehicleForm.brand_model} onChange={event => setVehicleForm({ ...vehicleForm, brand_model: event.target.value })} /></label><label>KM atual<input type="number" min="0" step="0.1" required value={vehicleForm.current_km} onChange={event => setVehicleForm({ ...vehicleForm, current_km: event.target.value })} /></label><button className="btn btn-primary fleet-submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar veículo'}</button></form></div></ModalOverlay>}
    </section>
  );
}
