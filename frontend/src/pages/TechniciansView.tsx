import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageCircleMore,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X
} from 'lucide-react';
import { TechnicianLinkModal } from '../components/TechnicianLinkModal';
import { apiUrl } from '../lib/api';

interface TechniciansViewProps {
  technicians: Technician[];
  onRefresh: () => void;
}

interface Technician {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  avatar_url?: string | null;
  status: string;
  pin?: string | null;
}

interface TechnicianForm {
  name: string;
  phone: string;
  email: string;
  role: string;
  status: string;
  pin: string;
}

interface AppCredential {
  id: number;
  user_type: string;
  technician_id: number | null;
  username: string;
  display_name: string;
  pin: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const defaultForm: TechnicianForm = {
  name: '',
  phone: '',
  email: '',
  role: 'Técnico Especialista em Assistência Técnica',
  status: 'Ativo',
  pin: '3247'
};

function hasValue(value: unknown) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized && normalized !== 'pendente' && !normalized.startsWith('pendente ('));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'TC';
}

function normalizedName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(sourceName: string, targetName: string) {
  const source = normalizedName(sourceName);
  const target = normalizedName(targetName);
  const sourceTokens = source.split(' ').filter(Boolean);
  const targetTokens = target.split(' ').filter(Boolean);
  const commonTokens = sourceTokens.filter(token => targetTokens.includes(token)).length;
  let score = commonTokens * 10;
  if (sourceTokens[0] && sourceTokens[0] === targetTokens[0]) score += 20;
  if (source && target && (source.startsWith(target) || target.startsWith(source))) score += 8;
  return score;
}

function profileFromTechnicians(source: Technician, target: Technician): TechnicianForm {
  const preferred = (targetValue: string | null | undefined, sourceValue: string | null | undefined) => {
    if (hasValue(targetValue)) return String(targetValue);
    if (hasValue(sourceValue)) return String(sourceValue);
    return String(targetValue || sourceValue || '');
  };

  return {
    name: target.name,
    phone: preferred(target.phone, source.phone),
    email: preferred(target.email, source.email),
    role: preferred(target.role, source.role) || 'Técnico de Campo',
    status: target.status === 'Inativo' && source.status !== 'Inativo' ? 'Ativo' : target.status,
    pin: target.pin || source.pin || '3247'
  };
}

async function readApiResponse(response: Response): Promise<any> {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    if (body.trimStart().startsWith('<')) {
      throw new Error('O backend em execução está desatualizado. Feche a janela antiga do backend e execute iniciar-local.bat novamente.');
    }
    throw new Error(`A API retornou uma resposta inválida (HTTP ${response.status}).`);
  }
}

export function TechniciansView({ technicians, onRefresh }: TechniciansViewProps) {
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingTechnician, setEditingTechnician] = useState<Technician | null>(null);
  const [formData, setFormData] = useState<TechnicianForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [mergeSource, setMergeSource] = useState<Technician | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeProfile, setMergeProfile] = useState<TechnicianForm>(defaultForm);
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Technician | null>(null);
  const [modalError, setModalError] = useState('');
  const [notice, setNotice] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTechId, setLinkTechId] = useState<number | null>(null);

  // Estados para o Gerenciador de PINs e Credenciais do Banco
  const [showPinManager, setShowPinManager] = useState(false);
  const [credentials, setCredentials] = useState<AppCredential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [editingCred, setEditingCred] = useState<AppCredential | null>(null);
  const [credPinInput, setCredPinInput] = useState('');
  const [showNewCredModal, setShowNewCredModal] = useState(false);
  const [newCredForm, setNewCredForm] = useState({
    display_name: '',
    username: '',
    pin: '3247',
    role: 'Técnico de Campo',
    user_type: 'technician'
  });

  // Visibilidade de PINs (ocultos por padrão)
  const [revealedPins, setRevealedPins] = useState<Record<string | number, boolean>>({});
  const [revealedModalPins, setRevealedModalPins] = useState<Record<string | number, boolean>>({});

  const togglePinVisibility = (techId: string | number) => {
    setRevealedPins(prev => ({ ...prev, [techId]: !prev[techId] }));
  };

  const toggleModalPinVisibility = (credId: string | number) => {
    setRevealedModalPins(prev => ({ ...prev, [credId]: !prev[credId] }));
  };

  const activeCount = technicians.filter(tech => tech.status !== 'Inativo').length;
  const phoneCount = technicians.filter(tech => hasValue(tech.phone)).length;

  const fetchCredentials = async () => {
    setLoadingCreds(true);
    try {
      const response = await fetch(apiUrl('/api/credentials'));
      const data = await readApiResponse(response);
      if (data.success) {
        setCredentials(data.credentials || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingCreds(false);
    }
  };

  const handleUpdateCredPin = async (credId: number, pin: string) => {
    setSaving(true);
    try {
      const response = await fetch(apiUrl(`/api/credentials/${credId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() })
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao alterar PIN.');
      setNotice('PIN atualizado no banco de dados com sucesso!');
      setEditingCred(null);
      fetchCredentials();
      onRefresh();
    } catch (err: any) {
      setModalError(err.message || 'Erro ao salvar PIN');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCred = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      const response = await fetch(apiUrl('/api/credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCredForm)
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao criar credencial.');
      setNotice(`Usuário ${newCredForm.display_name} criado no banco com PIN ${newCredForm.pin}!`);
      setShowNewCredModal(false);
      setNewCredForm({
        display_name: '',
        username: '',
        pin: '3247',
        role: 'Técnico de Campo',
        user_type: 'technician'
      });
      fetchCredentials();
      onRefresh();
    } catch (err: any) {
      setModalError(err.message || 'Erro ao criar usuário');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCred = async (credId: number) => {
    if (!confirm('Deseja realmente excluir este usuário e seu PIN de acesso?')) return;
    setSaving(true);
    try {
      const response = await fetch(apiUrl(`/api/credentials/${credId}`), { method: 'DELETE' });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao excluir.');
      setNotice('Credencial excluída com sucesso.');
      fetchCredentials();
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredTechnicians = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return technicians
      .filter(tech => !query || [tech.name, tech.role, tech.phone, tech.email]
        .filter(Boolean)
        .some(value => String(value).toLocaleLowerCase('pt-BR').includes(query)))
      .sort((left, right) => {
        const leftName = String(left.name || '').trim();
        const rightName = String(right.name || '').trim();
        if (!leftName) return 1;
        if (!rightName) return -1;
        return leftName.localeCompare(rightName, 'pt-BR', { sensitivity: 'base', numeric: true });
      });
  }, [search, technicians]);

  const mergeCandidates = useMemo(() => {
    if (!mergeSource) return [];
    const query = normalizedName(mergeSearch);
    return technicians
      .filter(tech => tech.id !== mergeSource.id)
      .filter(tech => !query || normalizedName(`${tech.name} ${tech.phone || ''} ${tech.email || ''}`).includes(query))
      .sort((a, b) => {
        const scoreDifference = similarityScore(mergeSource.name, b.name) - similarityScore(mergeSource.name, a.name);
        return scoreDifference || a.name.localeCompare(b.name, 'pt-BR');
      })
      .slice(0, 10);
  }, [mergeSearch, mergeSource, technicians]);

  const mergeTarget = technicians.find(tech => tech.id === mergeTargetId) || null;

  const closeProfileModal = () => {
    if (saving) return;
    setModalMode(null);
    setEditingTechnician(null);
    setModalError('');
  };

  const openCreateModal = () => {
    setFormData(defaultForm);
    setEditingTechnician(null);
    setModalError('');
    setModalMode('create');
  };

  const openEditModal = (technician: Technician) => {
    setFormData({
      name: technician.name || '',
      phone: technician.phone || '',
      email: technician.email || '',
      role: technician.role || 'Técnico de Campo',
      status: technician.status || 'Ativo',
      pin: technician.pin || '3247'
    });
    setEditingTechnician(technician);
    setOpenMenuId(null);
    setModalError('');
    setModalMode('edit');
  };

  const openMergeModal = (source: Technician) => {
    setMergeSource(source);
    setMergeTargetId(null);
    setMergeSearch('');
    setMergeProfile(defaultForm);
    setMergeConfirmed(false);
    setOpenMenuId(null);
    setModalError('');
  };

  const openDeleteModal = (technician: Technician) => {
    setDeleteTarget(technician);
    setOpenMenuId(null);
    setModalError('');
  };

  const selectMergeTarget = (target: Technician) => {
    if (!mergeSource) return;
    setMergeTargetId(target.id);
    setMergeProfile(profileFromTechnicians(mergeSource, target));
    setMergeConfirmed(false);
    setModalError('');
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setModalError('');
    try {
      const isEditing = modalMode === 'edit' && editingTechnician;
      const targetUrl = isEditing ? apiUrl(`/api/technicians/${editingTechnician.id}`) : apiUrl('/api/technicians');
      const response = await fetch(targetUrl, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Não foi possível salvar o técnico.');
      setNotice(isEditing ? 'Cadastro atualizado com sucesso no banco de dados.' : 'Técnico cadastrado com sucesso no banco.');
      setModalMode(null);
      setEditingTechnician(null);
      setFormData(defaultForm);
      onRefresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Erro ao salvar técnico.');
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async (event: FormEvent) => {
    event.preventDefault();
    if (!mergeSource || !mergeTarget || !mergeConfirmed) return;
    setSaving(true);
    setModalError('');
    try {
      const response = await fetch(apiUrl(`/api/technicians/${mergeSource.id}/merge`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: mergeTarget.id, profile: mergeProfile })
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Não foi possível mesclar os cadastros.');
      setNotice(`${mergeSource.name} foi mesclado em ${mergeProfile.name}.`);
      setMergeSource(null);
      setMergeTargetId(null);
      setMergeConfirmed(false);
      onRefresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Erro ao mesclar cadastros.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setModalError('');
    try {
      const response = await fetch(apiUrl(`/api/technicians/${deleteTarget.id}`), { method: 'DELETE' });
      const data = await readApiResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Não foi possível apagar o usuário.');
      setNotice(`${deleteTarget.name} foi apagado com sucesso.`);
      setDeleteTarget(null);
      onRefresh();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Erro ao apagar usuário.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="technicians-view animate-fade-in" onClick={() => openMenuId !== null && setOpenMenuId(null)}>
      <div className="page-hero technicians-hero">
        <div className="page-hero__copy">
          <span className="eyebrow"><Users size={15} /> Gestão da equipe</span>
          <h2>Técnicos & Acessos</h2>
          <p>Gerencie contatos, permissões e altere os PINs de login e totem de cada profissional diretamente no banco de dados.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setShowPinManager(true); fetchCredentials(); }}
            className="btn btn-secondary"
            style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', fontWeight: 600 }}
          >
            <KeyRound size={17} /> Gerenciar PINs & Acessos
          </button>
          <button onClick={() => { setLinkTechId(null); setShowLinkModal(true); }} className="btn btn-secondary">
            <Link2 size={17} /> Gerar link de acesso
          </button>
          <button onClick={openCreateModal} className="btn btn-primary">
            <Plus size={18} /> Novo técnico
          </button>
        </div>
      </div>

      {notice && (
        <div className="inline-notice inline-notice--success" role="status">
          <CheckCircle2 size={17} /><span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={16} /></button>
        </div>
      )}

      <div className="technicians-summary" aria-label="Resumo da equipe">
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--blue"><Users size={20} /></span>
          <div><strong>{technicians.length}</strong><span>Total cadastrado</span></div>
        </div>
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--green"><CheckCircle2 size={20} /></span>
          <div><strong>{activeCount}</strong><span>Profissionais ativos</span></div>
        </div>
        <div className="summary-card">
          <span className="summary-card__icon summary-card__icon--cyan"><MessageCircleMore size={20} /></span>
          <div><strong>{phoneCount}</strong><span>WhatsApp cadastrado</span></div>
        </div>
      </div>

      <div className="technicians-toolbar">
        <label className="technicians-search" aria-label="Buscar técnicos">
          <Search size={18} />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, cargo, telefone ou e-mail" />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca">
              <X size={16} />
            </button>
          )}
        </label>
      </div>

      {filteredTechnicians.length ? (
        <div className="technicians-grid">
          {filteredTechnicians.map(tech => {
            const phoneConfigured = hasValue(tech.phone);
            const emailConfigured = hasValue(tech.email);
            const isActive = tech.status !== 'Inativo';
            const techPin = tech.pin || '3247';

            return (
              <article key={tech.id} className={`technician-card ${isActive ? '' : 'technician-card--inactive'}`}>
                {/* TOP: Avatar, Nome, Cargo, Status, Menu */}
                <div className="technician-card__top">
                  <div className="technician-avatar">
                    {tech.avatar_url ? (
                      <img src={tech.avatar_url} alt={tech.name} />
                    ) : (
                      <span>{initials(tech.name)}</span>
                    )}
                  </div>
                  <div className="technician-identity">
                    <div className="technician-identity-name-row">
                      <h3>{tech.name}</h3>
                      <span className={`tech-status-badge tech-status-badge--${isActive ? 'active' : 'inactive'}`}>
                        <span className="tech-status-dot" />
                        {isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p>{tech.role || 'Técnico de Campo'}</p>
                  </div>
                  <div className="technician-card__controls">
                    <div className="technician-menu">
                      <button
                        className="icon-button technician-menu__trigger"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === tech.id ? null : tech.id); }}
                        aria-label={`Ações de ${tech.name}`}
                        aria-expanded={openMenuId === tech.id}
                      >
                        <MoreVertical size={17} />
                      </button>
                      {openMenuId === tech.id && (
                        <div className="technician-menu__popover" role="menu" onClick={e => e.stopPropagation()}>
                          <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); openEditModal(tech); }}>
                            <Pencil size={15} /><span><strong>Editar cadastro</strong><small>Alterar dados e PIN</small></span>
                          </button>
                          <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); openMergeModal(tech); }}>
                            <ArrowRightLeft size={15} /><span><strong>Mesclar usuário</strong><small>Unir com outro cadastro</small></span>
                          </button>
                          <button className="technician-menu__delete" type="button" role="menuitem" onClick={() => { setOpenMenuId(null); openDeleteModal(tech); }}>
                            <Trash2 size={15} /><span><strong>Apagar usuário</strong><small>Excluir cadastro sem vínculos</small></span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* PIN BAR / CREDENCIAIS (OCULTO POR PADRÃO) */}
                <div className="technician-pin-box">
                  <div className="technician-pin-info">
                    <span className="technician-pin-icon"><Lock size={15} /></span>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', fontWeight: 600 }}>PIN de Acesso</span>
                      <strong className="technician-pin-val">
                        {revealedPins[tech.id] ? techPin : '••••'}
                      </strong>
                    </div>
                  </div>
                  <div className="technician-pin-actions">
                    <button
                      type="button"
                      className="pin-eye-btn"
                      onClick={() => togglePinVisibility(tech.id)}
                      title={revealedPins[tech.id] ? "Ocultar PIN" : "Visualizar PIN"}
                      aria-label={revealedPins[tech.id] ? "Ocultar PIN" : "Visualizar PIN"}
                    >
                      {revealedPins[tech.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 8px', fontSize: '0.72rem', height: '26px' }}
                      onClick={() => openEditModal(tech)}
                    >
                      Alterar
                    </button>
                  </div>
                </div>

                {/* CONTATOS ORGANIZADOS */}
                <div className="technician-contacts-grid">
                  <div className="tech-contact-item">
                    <div className="tech-contact-icon"><Phone size={13} /></div>
                    <span>Celular</span>
                    <strong>{phoneConfigured ? tech.phone : <em style={{ color: '#94a3b8', fontStyle: 'normal' }}>Não informado</em>}</strong>
                  </div>
                  <div className="tech-contact-item">
                    <div className="tech-contact-icon"><Mail size={13} /></div>
                    <span>E-mail</span>
                    <strong>{emailConfigured ? tech.email : <em style={{ color: '#94a3b8', fontStyle: 'normal' }}>Não informado</em>}</strong>
                  </div>
                </div>

                {/* RODAPÉ DO CARD: Status e Botão de Link */}
                <div className="technician-card-footer">
                  <div className={`notification-state ${phoneConfigured && isActive ? 'notification-state--ready' : ''}`}>
                    {phoneConfigured && isActive ? <CheckCircle2 size={15} /> : <MessageCircleMore size={15} />}
                    <span>{phoneConfigured && isActive ? 'WhatsApp pronto para envio' : 'Cadastre um celular para ativar WhatsApp'}</span>
                  </div>

                  {isActive && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%', gap: '6px', justifyContent: 'center', height: '32px' }}
                      onClick={() => { setLinkTechId(tech.id); setShowLinkModal(true); }}
                    >
                      <Link2 size={14} /> Link do portal de reservas
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <UserRound size={34} />
          <h3>Nenhum técnico encontrado</h3>
          <p>Ajuste o termo de busca ou cadastre um novo profissional.</p>
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE TÉCNICO COM PIN */}
      {modalMode && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target) closeProfileModal();
        }}>
          <div className="modal-content technician-modal" role="dialog" aria-modal="true" aria-labelledby="technician-modal-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">{modalMode === 'edit' ? 'Editar cadastro' : 'Novo cadastro'}</span>
                <h3 id="technician-modal-title">{modalMode === 'edit' ? formData.name : 'Adicionar técnico de campo'}</h3>
                <p>{modalMode === 'edit' ? 'Revise os dados e defina o PIN de acesso do profissional.' : 'Preencha os dados essenciais e defina o PIN de acesso.'}</p>
              </div>
              <button className="icon-button" type="button" onClick={closeProfileModal} aria-label="Fechar modal"><X size={19} /></button>
            </div>

            {modalError && <div className="form-error" role="alert"><ShieldAlert size={17} />{modalError}</div>}

            <form onSubmit={handleSave} className="technician-form">
              <label className="form-field form-field--full">
                <span>Nome completo *</span>
                <input required className="input-field" value={formData.name} onChange={event => setFormData({ ...formData, name: event.target.value })} placeholder="Ex.: Carlos Eduardo Silva" />
              </label>

              <label className="form-field">
                <span>PIN de Acesso (Login / Totem) *</span>
                <input
                  required
                  maxLength={8}
                  className="input-field"
                  style={{ letterSpacing: '3px', fontWeight: 700 }}
                  value={formData.pin}
                  onChange={event => setFormData({ ...formData, pin: event.target.value.replace(/\D/g, '') })}
                  placeholder="3247"
                />
              </label>

              <label className="form-field">
                <span>Celular com DDD {modalMode === 'create' ? '*' : ''}</span>
                <input required={modalMode === 'create'} className="input-field" value={formData.phone} onChange={event => setFormData({ ...formData, phone: event.target.value })} placeholder="(11) 98765-4321" />
              </label>

              <label className="form-field form-field--full">
                <span>E-mail institucional</span>
                <input type="email" className="input-field" value={formData.email} onChange={event => setFormData({ ...formData, email: event.target.value })} placeholder="nome@empresa.com.br" />
              </label>

              <label className="form-field">
                <span>Cargo ou especialidade</span>
                <input className="input-field" value={formData.role} onChange={event => setFormData({ ...formData, role: event.target.value })} />
              </label>

              <label className="form-field">
                <span>Status</span>
                <select className="input-field" value={formData.status} onChange={event => setFormData({ ...formData, status: event.target.value })}>
                  <option value="Ativo">Ativo</option>
                  <option value="Inativo">Inativo</option>
                </select>
              </label>

              <div className="modal-actions form-field--full">
                <button type="button" onClick={closeProfileModal} className="btn btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Salvando…' : 'Salvar no Banco'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL GERENCIADOR DE PINS E ACESSOS DO BANCO DE DADOS */}
      {showPinManager && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target) setShowPinManager(false);
        }}>
          <div className="modal-content" style={{ maxWidth: '680px', width: '95%' }} role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="eyebrow" style={{ color: '#16a34a' }}><KeyRound size={15} /> Banco de Credenciais</span>
                <h3>Gerenciador de PINs de Login</h3>
                <p>Altere os PINs ou crie novos acessos diretamente no banco de dados Supabase.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowPinManager(false)} aria-label="Fechar modal"><X size={19} /></button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {credentials.length} credenciais cadastradas no sistema
              </span>
              <button
                type="button"
                onClick={() => setShowNewCredModal(true)}
                className="btn btn-primary btn-sm"
                style={{ gap: '6px' }}
              >
                <Plus size={15} /> Novo Usuário / PIN
              </button>
            </div>

            {loadingCreds ? (
              <p style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>Carregando dados do banco…</p>
            ) : (
              <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {credentials.map(cred => (
                  <div
                    key={cred.id}
                    style={{
                      background: cred.username === 'admin' ? '#eff6ff' : '#f8fafc',
                      border: `1px solid ${cred.username === 'admin' ? '#bfdbfe' : '#e2e8f0'}`,
                      borderRadius: '10px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{cred.display_name}</strong>
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: cred.role === 'admin' ? '#3b82f6' : '#64748b',
                          color: '#ffffff'
                        }}>
                          {cred.role.toUpperCase()}
                        </span>
                      </div>
                      <small style={{ color: '#64748b' }}>Usuário: @{cred.username}</small>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {editingCred?.id === cred.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="text"
                            maxLength={8}
                            value={credPinInput}
                            onChange={e => setCredPinInput(e.target.value.replace(/\D/g, ''))}
                            placeholder="Novo PIN"
                            style={{
                              width: '80px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              border: '2px solid #0284c7',
                              fontWeight: 700,
                              letterSpacing: '2px',
                              textAlign: 'center'
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ padding: '4px 8px' }}
                            onClick={() => handleUpdateCredPin(cred.id, credPinInput)}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px' }}
                            onClick={() => setEditingCred(null)}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontWeight: 700,
                            letterSpacing: '2.5px',
                            fontSize: '0.95rem',
                            fontFamily: 'monospace'
                          }}>
                            {revealedModalPins[cred.id] ? cred.pin : '••••'}
                          </div>
                          <button
                            type="button"
                            className="pin-eye-btn"
                            onClick={() => toggleModalPinVisibility(cred.id)}
                            title={revealedModalPins[cred.id] ? "Ocultar PIN" : "Visualizar PIN"}
                          >
                            {revealedModalPins[cred.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            onClick={() => { setEditingCred(cred); setCredPinInput(cred.pin); }}
                          >
                            Editar
                          </button>
                          {cred.username !== 'admin' && (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              style={{ padding: '4px 8px' }}
                              onClick={() => handleDeleteCred(cred.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button type="button" onClick={() => setShowPinManager(false)} className="btn btn-secondary">Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR NOVO USUÁRIO / CREDENCIAL */}
      {showNewCredModal && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target) setShowNewCredModal(false);
        }}>
          <div className="modal-content" style={{ maxWidth: '480px', width: '95%' }} role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="eyebrow" style={{ color: '#0284c7' }}><Plus size={15} /> Novo Acesso</span>
                <h3>Cadastrar Usuário & PIN</h3>
                <p>Crie um novo login com PIN personalizado para o banco de dados.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewCredModal(false)} aria-label="Fechar modal"><X size={19} /></button>
            </div>

            <form onSubmit={handleCreateCred} className="technician-form">
              <label className="form-field form-field--full">
                <span>Nome do Profissional / Usuário *</span>
                <input
                  required
                  className="input-field"
                  value={newCredForm.display_name}
                  onChange={e => setNewCredForm({ ...newCredForm, display_name: e.target.value })}
                  placeholder="Ex.: Lucas Mendes"
                />
              </label>

              <label className="form-field">
                <span>Tipo de Acesso</span>
                <select
                  className="input-field"
                  value={newCredForm.role}
                  onChange={e => {
                    const role = e.target.value;
                    setNewCredForm({ ...newCredForm, role, user_type: role === 'admin' ? 'admin' : 'technician' });
                  }}
                >
                  <option value="Técnico de Campo">Técnico de Campo</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>

              <label className="form-field">
                <span>PIN de Login (4 a 8 dígitos) *</span>
                <input
                  required
                  maxLength={8}
                  className="input-field"
                  style={{ letterSpacing: '3px', fontWeight: 700 }}
                  value={newCredForm.pin}
                  onChange={e => setNewCredForm({ ...newCredForm, pin: e.target.value.replace(/\D/g, '') })}
                  placeholder="3247"
                />
              </label>

              <div className="modal-actions form-field--full">
                <button type="button" onClick={() => setShowNewCredModal(false)} className="btn btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? 'Criando…' : 'Salvar no Banco'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mergeSource && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target && !saving) setMergeSource(null);
        }}>
          <div className="modal-content merge-modal" role="dialog" aria-modal="true" aria-labelledby="merge-modal-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow"><ArrowRightLeft size={14} /> Mesclar cadastros</span>
                <h3 id="merge-modal-title">Unir duplicata de {mergeSource.name}</h3>
                <p>Escolha o cadastro que continuará existindo. Todos os vínculos serão transferidos para ele.</p>
              </div>
              <button className="icon-button" type="button" disabled={saving} onClick={() => setMergeSource(null)} aria-label="Fechar modal"><X size={19} /></button>
            </div>

            {modalError && <div className="form-error" role="alert"><ShieldAlert size={17} />{modalError}</div>}

            <form onSubmit={handleMerge} className="merge-form">
              <div className="merge-source-card">
                <div className="technician-avatar technician-avatar--small"><span>{initials(mergeSource.name)}</span></div>
                <div><span>Cadastro que será removido</span><strong>{mergeSource.name}</strong><small>ID #{mergeSource.id}</small></div>
              </div>

              <div className="merge-step">
                <div className="merge-step__heading"><span>1</span><div><strong>Selecione o cadastro final</strong><small>As sugestões mais parecidas aparecem primeiro.</small></div></div>
                <label className="merge-search">
                  <Search size={17} />
                  <input value={mergeSearch} onChange={event => setMergeSearch(event.target.value)} placeholder="Buscar nome, telefone ou e-mail" />
                </label>
                <div className="merge-candidates">
                  {mergeCandidates.map(candidate => {
                    const selected = candidate.id === mergeTargetId;
                    return (
                      <button key={candidate.id} type="button" className={selected ? 'is-selected' : ''} onClick={() => selectMergeTarget(candidate)}>
                        <span className="merge-candidate__avatar">{initials(candidate.name)}</span>
                        <span><strong>{candidate.name}</strong><small>ID #{candidate.id} · {hasValue(candidate.phone) ? candidate.phone : 'sem telefone'}</small></span>
                        <span className="merge-candidate__check">{selected && <Check size={15} />}</span>
                      </button>
                    );
                  })}
                  {!mergeCandidates.length && <p className="merge-empty">Nenhum outro cadastro encontrado.</p>}
                </div>
              </div>

              {mergeTarget && (
                <div className="merge-step">
                  <div className="merge-step__heading"><span>2</span><div><strong>Revise o perfil final</strong><small>Os dados abaixo permanecerão após a mescla.</small></div></div>
                  <div className="technician-form merge-profile-form">
                    <label className="form-field form-field--full">
                      <span>Nome final *</span>
                      <input required className="input-field" value={mergeProfile.name} onChange={event => setMergeProfile({ ...mergeProfile, name: event.target.value })} />
                    </label>
                    <label className="form-field">
                      <span>Celular</span>
                      <input className="input-field" value={mergeProfile.phone} onChange={event => setMergeProfile({ ...mergeProfile, phone: event.target.value })} />
                    </label>
                    <label className="form-field form-field--full">
                      <span>E-mail</span>
                      <input type="email" className="input-field" value={mergeProfile.email} onChange={event => setMergeProfile({ ...mergeProfile, email: event.target.value })} />
                    </label>
                  </div>

                  <label className="merge-confirmation">
                    <input type="checkbox" checked={mergeConfirmed} onChange={event => setMergeConfirmed(event.target.checked)} />
                    <span>Confirmo que <strong>{mergeSource.name}</strong> e <strong>{mergeTarget.name}</strong> são a mesma pessoa. O cadastro #{mergeSource.id} será removido.</span>
                  </label>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" disabled={saving} onClick={() => setMergeSource(null)} className="btn btn-secondary">Cancelar</button>
                <button type="submit" disabled={saving || !mergeTarget || !mergeConfirmed} className="btn btn-primary">
                  <ArrowRightLeft size={17} /> {saving ? 'Mesclando…' : 'Mesclar cadastros'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target && !saving) setDeleteTarget(null);
        }}>
          <div className="modal-content delete-technician-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-technician-title" aria-describedby="delete-technician-description">
            <div className="modal-heading">
              <div>
                <span className="eyebrow eyebrow--danger"><Trash2 size={14} /> Apagar usuário</span>
                <h3 id="delete-technician-title">Apagar {deleteTarget.name}?</h3>
                <p id="delete-technician-description">Esta ação é permanente e não poderá ser desfeita.</p>
              </div>
              <button className="icon-button" type="button" disabled={saving} onClick={() => setDeleteTarget(null)} aria-label="Fechar confirmação"><X size={19} /></button>
            </div>

            {modalError && <div className="form-error" role="alert"><ShieldAlert size={17} />{modalError}</div>}

            <div className="delete-technician-warning">
              <ShieldAlert size={21} />
              <div><strong>Proteção do histórico operacional</strong><p>O usuário só será apagado se não possuir atendimentos, reservas ou notificações vinculadas. Caso possua, use “Mesclar usuário” ou marque o cadastro como inativo.</p></div>
            </div>

            <div className="delete-technician-profile">
              <span className="technician-avatar technician-avatar--small">{initials(deleteTarget.name)}</span>
              <div><strong>{deleteTarget.name}</strong><small>ID #{deleteTarget.id} · {deleteTarget.role || 'Técnico de campo'}</small></div>
            </div>

            <div className="modal-actions">
              <button type="button" disabled={saving} onClick={() => setDeleteTarget(null)} className="btn btn-secondary">Cancelar</button>
              <button type="button" disabled={saving} onClick={() => void handleDelete()} className="btn btn-danger">
                <Trash2 size={17} /> {saving ? 'Apagando…' : 'Apagar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
      <TechnicianLinkModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        technicians={technicians}
        defaultTechnicianId={linkTechId}
      />
    </section>
  );
}
