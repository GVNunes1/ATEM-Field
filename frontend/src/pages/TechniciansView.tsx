import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Link2,
  Mail,
  MessageCircleMore,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
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
}

interface TechnicianForm {
  name: string;
  phone: string;
  email: string;
  role: string;
  status: string;
}

const defaultForm: TechnicianForm = {
  name: '',
  phone: '',
  email: '',
  role: 'Técnico Especialista em Engenharia Clínica',
  status: 'Ativo'
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
    status: target.status === 'Inativo' && source.status !== 'Inativo' ? 'Ativo' : target.status
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

  const activeCount = technicians.filter(tech => tech.status !== 'Inativo').length;
  const phoneCount = technicians.filter(tech => hasValue(tech.phone)).length;

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
      status: technician.status || 'Ativo'
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
      setNotice(isEditing ? 'Cadastro atualizado com sucesso.' : 'Técnico cadastrado com sucesso.');
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
          <h2>Técnicos de campo</h2>
          <p>Edite contatos, elimine cadastros duplicados com segurança e prepare o acesso individual ao portal de reservas.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
        <label className="technician-search">
          <Search size={18} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por nome, cargo ou contato"
            aria-label="Buscar técnicos"
          />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={16} /></button>}
        </label>
      </div>

      <div className="technicians-results-head">
        <div>
          <h3>Equipe cadastrada</h3>
          <p>{filteredTechnicians.length} {filteredTechnicians.length === 1 ? 'profissional encontrado' : 'profissionais encontrados'}</p>
        </div>
      </div>

      {filteredTechnicians.length > 0 ? (
        <div className="technicians-grid">
          {filteredTechnicians.map(tech => {
            const isActive = tech.status !== 'Inativo';
            const phoneConfigured = hasValue(tech.phone);
            const emailConfigured = hasValue(tech.email);

            return (
              <article key={tech.id} className="technician-card">
                <div className="technician-card__top">
                  <div className="technician-avatar" aria-hidden="true">
                    <span>{initials(tech.name || '')}</span>
                    {tech.avatar_url && (
                      <img
                        src={tech.avatar_url}
                        alt=""
                        onError={event => { event.currentTarget.style.display = 'none'; }}
                      />
                    )}
                  </div>
                  <div className="technician-identity">
                    <h3 title={tech.name}>{tech.name || 'Técnico sem nome'}</h3>
                    <p>{hasValue(tech.role) ? tech.role : 'Técnico de campo'}</p>
                  </div>
                  <div className="technician-card__controls">
                    <span className={`status-pill ${isActive ? 'status-pill--active' : 'status-pill--inactive'}`}>
                      <span /> {isActive ? 'Ativo' : 'Inativo'}
                    </span>
                    <div className="technician-menu" onClick={event => event.stopPropagation()}>
                      <button
                        className="icon-button technician-menu__trigger"
                        type="button"
                        onClick={() => setOpenMenuId(openMenuId === tech.id ? null : tech.id)}
                        aria-label={`Ações de ${tech.name}`}
                        aria-expanded={openMenuId === tech.id}
                      >
                        <MoreVertical size={18} />
                      </button>
                      {openMenuId === tech.id && (
                        <div className="technician-menu__popover" role="menu">
                          <button type="button" role="menuitem" onClick={() => openEditModal(tech)}>
                            <Pencil size={16} /><span><strong>Editar cadastro</strong><small>Alterar dados e status</small></span>
                          </button>
                          <button type="button" role="menuitem" onClick={() => openMergeModal(tech)}>
                            <ArrowRightLeft size={16} /><span><strong>Mesclar usuário</strong><small>Unir com outro cadastro</small></span>
                          </button>
                          <button className="technician-menu__delete" type="button" role="menuitem" onClick={() => openDeleteModal(tech)}>
                            <Trash2 size={16} /><span><strong>Apagar usuário</strong><small>Excluir cadastro sem vínculos</small></span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="technician-contact-list">
                  <div className="contact-row">
                    <span className="contact-row__icon"><Phone size={16} /></span>
                    <div><span>Celular</span><strong>{phoneConfigured ? tech.phone : 'Não informado'}</strong></div>
                  </div>
                  <div className="contact-row">
                    <span className="contact-row__icon"><Mail size={16} /></span>
                    <div><span>E-mail</span><strong>{emailConfigured ? tech.email : 'Não informado'}</strong></div>
                  </div>
                  <div className="contact-row">
                    <span className="contact-row__icon"><Link2 size={16} /></span>
                    <div><span>Portal de reservas</span><strong>{isActive ? 'Acesso disponível no painel Reservas' : 'Indisponível para cadastro inativo'}</strong></div>
                  </div>
                </div>

                <div className={`notification-state ${phoneConfigured && isActive ? 'notification-state--ready' : ''}`}>
                  {phoneConfigured && isActive ? <CheckCircle2 size={16} /> : <MessageCircleMore size={16} />}
                  <span>{phoneConfigured && isActive ? 'Pronto para receber o link' : 'Cadastre um celular e mantenha o técnico ativo'}</span>
                </div>

                {isActive && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ width: '100%', marginTop: '10px', gap: '6px', justifyContent: 'center' }}
                    onClick={() => { setLinkTechId(tech.id); setShowLinkModal(true); }}
                  >
                    <Link2 size={15} /> Gerar e copiar link do portal
                  </button>
                )}
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

      {modalMode && (
        <div className="modal-overlay" role="presentation" onMouseDown={event => {
          if (event.currentTarget === event.target) closeProfileModal();
        }}>
          <div className="modal-content technician-modal" role="dialog" aria-modal="true" aria-labelledby="technician-modal-title">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">{modalMode === 'edit' ? 'Editar cadastro' : 'Novo cadastro'}</span>
                <h3 id="technician-modal-title">{modalMode === 'edit' ? formData.name : 'Adicionar técnico de campo'}</h3>
                <p>{modalMode === 'edit' ? 'Revise os dados do profissional e salve as alterações.' : 'Preencha os dados essenciais para agenda, reservas e futuro envio por WhatsApp.'}</p>
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
                <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Salvando…' : 'Salvar cadastro'}</button>
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
