import React, { useMemo, useState } from 'react';
import { AuthUser } from '../types/auth';
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
  onLoginSuccess: (user: AuthUser) => void;
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

      if (data.success && data.user) {
        onLoginSuccess(data.user);
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

      if (data.success && data.user) {
        onLoginSuccess(data.user);
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
    <div className="login-page-root">
      <div className="login-card">
        {/* Brand Header */}
        <div className="login-brand-header">
          <img src="/logomarca_azul_clinico_sem_fundo.png" alt="ATEM" className="login-logo-img" />
          <h2>Acesso ao Sistema</h2>
          <p>ATEM Field · Assistência Técnica & Gestão de Campo</p>
        </div>

        {/* Tab Switcher */}
        <div className="login-tabs">
          <button
            type="button"
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
            <button type="button" onClick={() => setError('')}><X size={15} /></button>
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
          <span>ATEM Hospitalar · Assistência Técnica © 2026</span>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
