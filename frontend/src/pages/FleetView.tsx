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
  UserCheck,
  X,
  ShieldAlert,
  Info
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

type ModalMode = 'checkout' | 'checkin' | 'vehicle' | 'cancel' | 'reassign' | null;

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
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  // Checklist de Retirada: KM; Comentário/observação; Empresa (Trabalho e deslocamento residência); Particular; Veículo Limpo; Status da Revisão; Verificar Água / Óleo
  const [checkoutForm, setCheckoutForm] = useState({
    appointment_id: '',
    km_initial: '',
    photo: null as File | null,
    usage_type: 'Empresa (Trabalho e deslocamento residência)',
    cleanliness_ok: true,
    revision_status: 'Em dia',
    fluids_checked: true,
    notes: '',
    manager_override: false
  });

  // Checklist de Devolução: KM; Apresenta novas avarias?; Realizado abastecimento?; Calibrado pneus?; Comentários, Observações.
  const [checkinForm, setCheckinForm] = useState({
    km_final: '',
    photo: null as File | null,
    has_new_damage: false,
    damage_description: '',
    fuel_checked: true,
    tires_calibrated: true,
    notes: ''
  });

  // Modal de Cancelamento de Retirada (Gestão)
  const [cancelReason, setCancelReason] = useState('');

  // Modal de Reatribuição de Responsável (Gestão)
  const [reassignForm, setReassignForm] = useState({
    new_user_id: '',
    new_user_name: ''
  });

  const [vehicleForm, setVehicleForm] = useState({ name: '', plate: '', brand_model: '', current_km: '' });

  const isManager = useMemo(() => {
    const role = String(currentUser?.role || '').toLowerCase();
    return ['admin', 'manager', 'gerente', 'supervisor'].includes(role);
  }, [currentUser?.role]);

  const loadFleet = async () => {
    setLoading(true);
    setError('');
    try {
      const [fleetData, techData] = await Promise.all([
        safeFetchJson('/api/fleet/vehicles', { cache: 'no-store' }),
        safeFetchJson('/api/technicians', { cache: 'no-store' }).catch(() => ({ success: false, technicians: [] }))
      ]);
      if (!fleetData.success) throw new Error(fleetData.error || 'Não foi possível carregar a frota.');
      setVehicles(fleetData.vehicles || []);
      setUsage(fleetData.usage || []);
      if (techData.success && Array.isArray(techData.technicians)) {
        setTechnicians(techData.technicians);
      }
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointment_id: checkoutForm.appointment_id || undefined,
          km_initial: Number(checkoutForm.km_initial),
          odometer_photo_data: photo,
          usage_type: checkoutForm.usage_type,
          cleanliness_ok: checkoutForm.cleanliness_ok,
          revision_status: checkoutForm.revision_status,
          fluids_checked: checkoutForm.fluids_checked,
          notes: checkoutForm.notes,
          manager_override: isManager ? checkoutForm.manager_override : undefined
        })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível registrar a retirada.');
      setNotice(data.message || 'Retirada registrada com sucesso.');
      setModalMode(null);
      setCheckoutForm({
        appointment_id: '',
        km_initial: '',
        photo: null,
        usage_type: 'Empresa (Trabalho e deslocamento residência)',
        cleanliness_ok: true,
        revision_status: 'Em dia',
        fluids_checked: true,
        notes: '',
        manager_override: false
      });
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          km_final: Number(checkinForm.km_final),
          return_photo_data: photo,
          has_new_damage: checkinForm.has_new_damage,
          damage_description: checkinForm.damage_description,
          fuel_checked: checkinForm.fuel_checked,
          tires_calibrated: checkinForm.tires_calibrated,
          notes: checkinForm.notes
        })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível registrar a devolução.');
      setNotice(data.message || 'Devolução registrada. Veículo disponível.');
      setModalMode(null);
      setCheckinForm({
        km_final: '',
        photo: null,
        has_new_damage: false,
        damage_description: '',
        fuel_checked: true,
        tires_calibrated: true,
        notes: ''
      });
      await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao registrar a devolução.');
    } finally { setSaving(false); }
  };

  const submitCancelUsage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUsage) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/fleet/usage/${selectedUsage.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível cancelar a retirada.');
      setNotice(data.message || 'Retirada cancelada com sucesso. Veículo disponível.');
      setModalMode(null);
      setCancelReason('');
      await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao cancelar a retirada.');
    } finally { setSaving(false); }
  };

  const submitReassignUsage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUsage) return;
    if (!reassignForm.new_user_name.trim()) {
      setError('Informe o nome do novo responsável.');
      return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await safeFetchJson(`/api/fleet/usage/${selectedUsage.id}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_user_id: reassignForm.new_user_id || undefined,
          new_user_name: reassignForm.new_user_name.trim()
        })
      });
      if (!data.success) throw new Error(data.error || 'Não foi possível transferir o veículo.');
      setNotice(data.message || 'Responsável atualizado com sucesso.');
      setModalMode(null);
      setReassignForm({ new_user_id: '', new_user_name: '' });
      await refreshAll();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao transferir o veículo.');
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

  const openCheckout = (vehicle: any) => {
    setSelectedVehicle(vehicle);
    setCheckoutForm(form => ({
      ...form,
      km_initial: String(vehicle.current_km || ''),
      manager_override: false
    }));
    setModalMode('checkout');
    setError('');
  };

  const openCheckin = (activeUsage: any) => {
    setSelectedUsage(activeUsage);
    setCheckinForm(form => ({
      ...form,
      km_final: String(activeUsage?.vehicle?.current_km || ''),
      has_new_damage: false,
      damage_description: '',
      fuel_checked: true,
      tires_calibrated: true,
      notes: ''
    }));
    setModalMode('checkin');
    setError('');
  };

  const openCancel = (activeUsage: any) => {
    setSelectedUsage(activeUsage);
    setCancelReason('');
    setModalMode('cancel');
    setError('');
  };

  const openReassign = (activeUsage: any) => {
    setSelectedUsage(activeUsage);
    setReassignForm({
      new_user_id: String(activeUsage.withdrawn_by_user_id || ''),
      new_user_name: activeUsage.withdrawn_by_name || ''
    });
    setModalMode('reassign');
    setError('');
  };

  return (
    <section className="fleet-page" aria-labelledby="fleet-heading">
      <header className="field-page-heading fleet-heading">
        <div>
          <span className="field-eyebrow">Patrimônio em campo</span>
          <h1 id="fleet-heading">Frota</h1>
          <p>Retirada e devolução com KM, evidência fotográfica e checklist de condição.</p>
        </div>
        {isManager && <button className="btn btn-primary" onClick={() => setModalMode('vehicle')}><Plus size={16} /> Novo veículo</button>}
      </header>

      {notice && <div className="fleet-notice fleet-notice--success" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && <div className="fleet-notice fleet-notice--error" role="alert"><TriangleAlert size={17} />{error}<button onClick={() => setError('')} aria-label="Fechar alerta"><X size={15} /></button></div>}

      <div className="fleet-summary" aria-label="Resumo da frota">
        <div><span>Veículos</span><strong>{vehicles.length}</strong></div>
        <div><span>Em uso</span><strong>{vehicles.filter(vehicle => vehicle.active_usage).length}</strong></div>
        <div><span>Disponíveis</span><strong>{vehicles.filter(vehicle => !vehicle.active_usage && !/baixado/i.test(vehicle.status || '')).length}</strong></div>
        <div><span>Em revisão/obs</span><strong>{vehicles.filter(vehicle => vehicle.status === 'Em revisão').length}</strong></div>
      </div>

      {loading ? <div className="fleet-empty">Carregando frota…</div> : vehicles.length === 0 ? (
        <div className="fleet-empty"><CarFront size={28} /><strong>Nenhum veículo cadastrado</strong><span>Cadastre a primeira viatura para iniciar o controle de retiradas.</span></div>
      ) : (
        <div className="fleet-grid">
          {vehicles.map(vehicle => {
            const activeUsage = vehicle.active_usage;
            const scheduled = vehicle.scheduled_appointments?.[0];
            const isVehicleInUse = Boolean(activeUsage);
            const isVehicleDecommissioned = /baixado/i.test(vehicle.status || '');

            return <article className="fleet-card" key={vehicle.id}>
              <div className="fleet-card-top">
                <span className={`fleet-status fleet-status--${String(isVehicleInUse ? 'em-uso' : vehicle.status || '').toLowerCase().replace(/\s+/g, '-')}`}>
                  {isVehicleInUse ? 'Em Uso' : vehicle.status}
                </span>
                <CarFront size={22} />
              </div>
              <h2>{vehicle.name}</h2>
              <p className="fleet-plate">{vehicle.plate} {vehicle.brand_model ? `· ${vehicle.brand_model}` : ''}</p>
              <div className="fleet-km"><Gauge size={16} /><span>KM atual</span><strong>{Number(vehicle.current_km || 0).toLocaleString('pt-BR')}</strong></div>

              {activeUsage ? (
                <div className="fleet-active">
                  <span><TimerReset size={15} /> Em uso por <strong>{activeUsage.withdrawn_by_name || 'usuário'}</strong></span>
                  <div className="fleet-actions-group">
                    <button className="btn btn-secondary btn-sm" onClick={() => openCheckin({ ...activeUsage, vehicle })}>
                      <RotateCcw size={14} /> Registrar devolução
                    </button>
                    {isManager && (
                      <>
                        <button className="btn btn-outline-secondary btn-sm" onClick={() => openReassign({ ...activeUsage, vehicle })} title="Tirar do nome / Trocar responsável">
                          <UserCheck size={14} /> Trocar responsável
                        </button>
                        <button className="btn btn-outline-danger btn-sm" onClick={() => openCancel({ ...activeUsage, vehicle })} title="Cancelar retirada ativa">
                          <X size={14} /> Cancelar retirada
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-primary fleet-action"
                  onClick={() => openCheckout(vehicle)}
                  disabled={isVehicleDecommissioned}
                >
                  <ClipboardCheck size={16} /> Registrar retirada
                </button>
              )}

              {scheduled && <div className="fleet-scheduled"><span>Próxima agenda</span><strong>{formatDate(scheduled.appointment_date)} · {scheduled.appointment_time || 'horário pendente'}</strong><small>{scheduled.client_name || scheduled.title}</small></div>}
            </article>;
          })}
        </div>
      )}

      {usage.length > 0 && (
        <section className="fleet-history">
          <div className="fleet-section-title">
            <div><span className="field-eyebrow">Rastreabilidade</span><h2>Últimas movimentações</h2></div>
            <button className="btn btn-secondary btn-sm" onClick={() => void loadFleet()}>Atualizar</button>
          </div>
          <div className="fleet-history-list">
            {usage.slice(0, 8).map(item => (
              <div key={item.id}>
                <span className={`fleet-dot fleet-dot--${item.status === 'Em Uso' ? 'active' : item.status === 'Cancelado' ? 'warning' : 'done'}`} />
                <div>
                  <strong>{item.withdrawn_by_name || 'Usuário'} · {item.status}</strong>
                  <small>Saída em {new Date(item.checkout_at).toLocaleString('pt-BR')} · KM {item.km_initial}</small>
                  {item.notes && <small style={{ color: 'var(--text-secondary)' }}>{item.notes}</small>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MODAL DE RETIRADA */}
      {modalMode === 'checkout' && selectedVehicle && (
        <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-checkout-title">
          <div className="fleet-modal">
            <div className="fleet-modal-heading">
              <div>
                <span className="field-eyebrow">Saída de veículo</span>
                <h2 id="fleet-checkout-title">{selectedVehicle.name}</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
            </div>
            <form onSubmit={submitCheckout} className="fleet-form">
              <label>
                Agendamento associado
                <select value={checkoutForm.appointment_id} onChange={event => setCheckoutForm({ ...checkoutForm, appointment_id: event.target.value })}>
                  <option value="">Uso avulso / sem agenda</option>
                  {upcomingAppointments.map(item => (
                    <option key={item.id} value={item.id}>{formatDate(item.appointment_date)} · {item.appointment_time || 'horário pendente'} · {item.client_name || item.title}</option>
                  ))}
                </select>
              </label>

              <label>
                KM do hodômetro
                <input type="number" min="0" step="0.1" required value={checkoutForm.km_initial} onChange={event => setCheckoutForm({ ...checkoutForm, km_initial: event.target.value })} />
              </label>

              <label>
                Tipo de deslocamento
                <select value={checkoutForm.usage_type} onChange={event => setCheckoutForm({ ...checkoutForm, usage_type: event.target.value })}>
                  <option value="Empresa (Trabalho e deslocamento residência)">Empresa (Trabalho e deslocamento residência)</option>
                  <option value="Particular">Particular</option>
                </select>
              </label>

              <fieldset>
                <legend>Checklist de Retirada</legend>
                <label>
                  <input type="checkbox" checked={checkoutForm.cleanliness_ok} onChange={event => setCheckoutForm({ ...checkoutForm, cleanliness_ok: event.target.checked })} />
                  Veículo Limpo
                </label>
                <label>
                  Status da Revisão
                  <select value={checkoutForm.revision_status} onChange={event => setCheckoutForm({ ...checkoutForm, revision_status: event.target.value })}>
                    <option value="Em dia">Em dia</option>
                    <option value="Próxima">Próxima</option>
                    <option value="Pendente">Pendente</option>
                  </select>
                </label>
                <label>
                  <input type="checkbox" checked={checkoutForm.fluids_checked} onChange={event => setCheckoutForm({ ...checkoutForm, fluids_checked: event.target.checked })} />
                  Verificar Água / Óleo
                </label>
              </fieldset>

              <label className="fleet-file">
                <Camera size={16} /> Foto do hodômetro
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setCheckoutForm({ ...checkoutForm, photo: event.target.files?.[0] || null })} />
              </label>

              <label>
                Comentário / Observação
                <textarea rows={3} placeholder="Observações sobre o estado do veículo..." value={checkoutForm.notes} onChange={event => setCheckoutForm({ ...checkoutForm, notes: event.target.value })} />
              </label>

              {isManager && (
                <label className="fleet-override-box">
                  <input
                    type="checkbox"
                    checked={checkoutForm.manager_override}
                    onChange={event => setCheckoutForm({ ...checkoutForm, manager_override: event.target.checked })}
                  />
                  <span><strong>Privilégio de Gestão:</strong> Permitir retirada mesmo com agendamento/reserva conflitante no horário</span>
                </label>
              )}

              <div className="fleet-helper-note">
                <Info size={14} />
                <span>Qualquer observação, avaria ou pendência não bloqueia o uso do veículo.</span>
              </div>

              <button className="btn btn-primary fleet-submit" disabled={saving}>
                {saving ? 'Registrando…' : 'Confirmar retirada'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* MODAL DE DEVOLUÇÃO */}
      {modalMode === 'checkin' && selectedUsage && (
        <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-checkin-title">
          <div className="fleet-modal">
            <div className="fleet-modal-heading">
              <div>
                <span className="field-eyebrow">Retorno de veículo</span>
                <h2 id="fleet-checkin-title">Checklist de Devolução</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
            </div>
            <form onSubmit={submitCheckin} className="fleet-form">
              <label>
                KM de retorno
                <input type="number" min={selectedUsage.km_initial} step="0.1" required value={checkinForm.km_final} onChange={event => setCheckinForm({ ...checkinForm, km_final: event.target.value })} />
              </label>

              <fieldset>
                <legend>Checklist de Devolução</legend>
                <label>
                  <input type="checkbox" checked={checkinForm.has_new_damage} onChange={event => setCheckinForm({ ...checkinForm, has_new_damage: event.target.checked })} />
                  Apresenta novas avarias?
                </label>
                {checkinForm.has_new_damage && (
                  <label>
                    Descrição da nova avaria
                    <textarea rows={2} required placeholder="Descreva os danos observados..." value={checkinForm.damage_description} onChange={event => setCheckinForm({ ...checkinForm, damage_description: event.target.value })} />
                  </label>
                )}
                <label>
                  <input type="checkbox" checked={checkinForm.fuel_checked} onChange={event => setCheckinForm({ ...checkinForm, fuel_checked: event.target.checked })} />
                  Realizado abastecimento?
                </label>
                <label>
                  <input type="checkbox" checked={checkinForm.tires_calibrated} onChange={event => setCheckinForm({ ...checkinForm, tires_calibrated: event.target.checked })} />
                  Calibrado pneus?
                </label>
              </fieldset>

              <label className="fleet-file">
                <Camera size={16} /> Foto do retorno
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setCheckinForm({ ...checkinForm, photo: event.target.files?.[0] || null })} />
              </label>

              <label>
                Comentários, Observações
                <textarea rows={3} placeholder="Observações de retorno..." value={checkinForm.notes} onChange={event => setCheckinForm({ ...checkinForm, notes: event.target.value })} />
              </label>

              <div className="fleet-helper-note">
                <Info size={14} />
                <span>Qualquer avaria ou pendência informada não travará o uso futuro do veículo.</span>
              </div>

              <button className="btn btn-primary fleet-submit" disabled={saving}>
                {saving ? 'Registrando…' : 'Confirmar devolução'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* MODAL DE CANCELAMENTO (GESTÃO) */}
      {modalMode === 'cancel' && selectedUsage && (
        <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-cancel-title">
          <div className="fleet-modal">
            <div className="fleet-modal-heading">
              <div>
                <span className="field-eyebrow">Ação Administrativa</span>
                <h2 id="fleet-cancel-title">Cancelar Retirada</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
            </div>
            <form onSubmit={submitCancelUsage} className="fleet-form">
              <div className="fleet-override-box" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>
                <ShieldAlert size={20} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Atenção:</strong> Você está cancelando a retirada em andamento por <strong>{selectedUsage.withdrawn_by_name || 'usuário'}</strong>. O veículo voltará imediatamente para o status <strong>Disponível</strong>.
                </div>
              </div>

              <label>
                Motivo do cancelamento (opcional)
                <input
                  type="text"
                  placeholder="Ex: Saída cancelada pelo gestor, veículo retornado à base"
                  value={cancelReason}
                  onChange={event => setCancelReason(event.target.value)}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={saving}>
                  Voltar
                </button>
                <button type="submit" className="btn btn-danger" disabled={saving}>
                  {saving ? 'Cancelando…' : 'Confirmar cancelamento'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* MODAL DE REATRIBUIÇÃO / TROCA DE RESPONSÁVEL (GESTÃO) */}
      {modalMode === 'reassign' && selectedUsage && (
        <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-reassign-title">
          <div className="fleet-modal">
            <div className="fleet-modal-heading">
              <div>
                <span className="field-eyebrow">Ação Administrativa</span>
                <h2 id="fleet-reassign-title">Trocar Responsável</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
            </div>
            <form onSubmit={submitReassignUsage} className="fleet-form">
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Responsável atual: <strong>{selectedUsage.withdrawn_by_name || 'Desconhecido'}</strong>
              </p>

              <label>
                Selecione um técnico da lista
                <select
                  value={reassignForm.new_user_id}
                  onChange={event => {
                    const techId = event.target.value;
                    const tech = technicians.find(t => String(t.id) === techId);
                    setReassignForm({
                      new_user_id: techId,
                      new_user_name: tech ? tech.name : reassignForm.new_user_name
                    });
                  }}
                >
                  <option value="">-- Selecione ou digite abaixo --</option>
                  {technicians.map(tech => (
                    <option key={tech.id} value={tech.id}>{tech.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Nome do novo responsável
                <input
                  type="text"
                  required
                  placeholder="Nome do colaborador"
                  value={reassignForm.new_user_name}
                  onChange={event => setReassignForm({ ...reassignForm, new_user_name: event.target.value })}
                />
              </label>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={saving}>
                  Voltar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Transferindo…' : 'Confirmar transferência'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* MODAL DE CADASTRO DE NOVO VEÍCULO */}
      {modalMode === 'vehicle' && (
        <ModalOverlay onDismiss={closeModal} role="dialog" aria-modal="true" aria-labelledby="fleet-vehicle-title">
          <div className="fleet-modal">
            <div className="fleet-modal-heading">
              <div>
                <span className="field-eyebrow">Cadastro</span>
                <h2 id="fleet-vehicle-title">Novo veículo</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
            </div>
            <form onSubmit={submitVehicle} className="fleet-form">
              <label>
                Nome de identificação
                <input required value={vehicleForm.name} onChange={event => setVehicleForm({ ...vehicleForm, name: event.target.value })} placeholder="Van Assistência 01" />
              </label>
              <label>
                Placa
                <input required value={vehicleForm.plate} onChange={event => setVehicleForm({ ...vehicleForm, plate: event.target.value.toUpperCase() })} placeholder="ABC1D23" />
              </label>
              <label>
                Marca e modelo
                <input value={vehicleForm.brand_model} onChange={event => setVehicleForm({ ...vehicleForm, brand_model: event.target.value })} placeholder="Ex: Renault Duster" />
              </label>
              <label>
                KM atual
                <input type="number" min="0" step="0.1" required value={vehicleForm.current_km} onChange={event => setVehicleForm({ ...vehicleForm, current_km: event.target.value })} />
              </label>
              <button className="btn btn-primary fleet-submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Cadastrar veículo'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}
    </section>
  );
}
