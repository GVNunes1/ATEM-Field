import React, { useMemo, useState } from 'react';
import { LoginSuccessHandler } from '../types/auth';
import { safeFetchJson } from '../lib/api';
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Lock,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
  Wrench,
  X
} from 'lucide-react';
import './LoginView.css';

interface LoginViewProps {
  technicians: any[];
  onLoginSuccess: LoginSuccessHandler;
}

export const LoginView: React.FC<LoginViewProps> = ({ technicians, onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'technician'>('admin');
  const [adminPin, setAdminPin] = useState('');
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [techPin, setTechPin] = useState('');
  const [techSearch, setTechSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filtrar técnicos oficiais ativos
  const activeTechnicians = useMemo(() => {
    return (technicians || [])
      .filter(t => t.status === 'Ativo')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [technicians]);

  // Técnicos filtrados pela busca
  const filteredTechs = useMemo(() => {
    if (!techSearch.trim()) return activeTechnicians;
    const query = techSearch.trim().toLowerCase();
    return activeTechnicians.filter(t => t.name.toLowerCase().includes(query));
  }, [activeTechnicians, techSearch]);

  // Submit Admin Login
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPin.trim()) return;
    setLoading(true);
    setError('');

    try {
      const data = await safeFetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'admin', pin: adminPin.trim() })
      });

      if (data.success && data.user && data.token) {
        onLoginSuccess(data.user, data.token);
      } else {
        setError(data.error || 'PIN ou Senha de administrador incorreta.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  // Submit Technician Login
  const handleTechnicianSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTechId) {
      setError('Por favor, selecione seu nome na lista de técnicos.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const data = await safeFetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'technician',
          technician_id: Number(selectedTechId),
          pin: techPin.trim() || '1234'
        })
      });

      if (data.success && data.user && data.token) {
        onLoginSuccess(data.user, data.token);
      } else {
        setError(data.error || 'PIN incorreto. Tente 1234.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page-root">
      <section className="login-intro" aria-labelledby="login-intro-title">
        <div className="login-intro-brand"><img src="/logomarca_azul_clinico_sem_fundo.png" alt="ATEM" /><span>Field</span></div>
        <div className="login-intro-copy"><span className="field-overline">Assistência técnica</span><h2 id="login-intro-title">Mais clareza.<br />Em cada atendimento.</h2><p>Acompanhe sua agenda, organize os padrões e mantenha a equipe pronta para ir a campo.</p></div>
        <div className="login-intro-footer"><Wrench size={17} /><span>Mult Med Equipamentos Hospitalares</span></div>
      </section>
      <div className="login-card">
        {/* Brand Header */}
        <div className="login-brand-header">
          <img src="/logomarca_azul_clinico_sem_fundo.png" alt="ATEM" className="login-logo-img" />
          <h1>Bem-vindo ao ATEM Field</h1>
          <p>Escolha seu perfil para acessar a operação.</p>
        </div>

        {/* Tab Switcher */}
        <div className="login-tabs">
          <button
            type="button"
            aria-pressed={activeTab === 'admin'}
            className={`login-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('admin');
              setError('');
            }}
          >
            <ShieldCheck size={18} />
            <span>Administrador</span>
          </button>
          <button
            type="button"
            aria-pressed={activeTab === 'technician'}
            className={`login-tab-btn ${activeTab === 'technician' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('technician');
              setError('');
            }}
          >
            <UserRound size={18} />
            <span>Técnico de Campo</span>
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="login-error-alert" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dispensar mensagem de erro" onClick={() => setError('')}><X size={15} /></button>
          </div>
        )}

        {/* Admin Login Form */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminSubmit} className="login-form">
            <div className="login-field-group">
              <label htmlFor="admin-pin-input">PIN / Senha de Administrador</label>
              <div className="login-input-wrap">
                <Lock size={18} className="login-input-icon" />
                <input
                  id="admin-pin-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Digite o PIN de administrador"
                  value={adminPin}
                  onChange={e => setAdminPin(e.target.value)}
                  autoFocus
                />
              </div>
              <small className="login-field-hint">Acesso total: edição de reservas, cadastro de padrões e relatórios.</small>
            </div>

            <button type="submit" disabled={loading || !adminPin.trim()} className="login-submit-btn admin">
              {loading ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
              <span>{loading ? 'Autenticando…' : 'Entrar como Administrador'}</span>
            </button>
          </form>
        )}

        {/* Technician Login Form */}
        {activeTab === 'technician' && (
          <form onSubmit={handleTechnicianSubmit} className="login-form">
            <div className="login-field-group">
              <label htmlFor="tech-select-input">Identifique seu Nome</label>
              <div className="login-input-wrap">
                <UserCheck size={18} className="login-input-icon" />
                <select
                  id="tech-select-input"
                  required
                  value={selectedTechId}
                  onChange={e => setSelectedTechId(e.target.value)}
                  className="login-select"
                >
                  <option value="">Selecione seu nome na lista...</option>
                  {activeTechnicians.map(tech => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name} ({tech.role || 'Técnico de Campo'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="login-field-group">
              <label htmlFor="tech-pin-input">PIN de Acesso</label>
              <div className="login-input-wrap">
                <Lock size={18} className="login-input-icon" />
                <input
                  id="tech-pin-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Digite seu PIN (padrão: 1234)"
                  value={techPin}
                  onChange={e => setTechPin(e.target.value)}
                />
              </div>
              <small className="login-field-hint">Técnicos só podem visualizar sua própria agenda e reservar em seu próprio nome.</small>
            </div>

            <button type="submit" disabled={loading || !selectedTechId} className="login-submit-btn technician">
              {loading ? <LoaderCircle className="spin" size={18} /> : <UserCheck size={18} />}
              <span>{loading ? 'Acessando…' : 'Entrar como Técnico'}</span>
            </button>
          </form>
        )}

        {/* Footer info */}
        <div className="login-card-footer">
          <span>Mult Med Equipamentos Hospitalares · Uso interno © 2026</span>
          <nav aria-label="Informações institucionais">
            <a href="/sobre">Sobre</a>
            <a href="/privacidade">Privacidade</a>
            <a href="/termos">Termos</a>
          </nav>
        </div>
      </div>
    </main>
  );
};

export default LoginView;
