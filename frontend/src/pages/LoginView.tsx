import React, { useMemo, useState } from 'react';
import { LoginSuccessHandler } from '../types/auth';
import { safeFetchJson } from '../lib/api';
import {
  KeyRound,
  LoaderCircle,
  Lock,
  UserCheck,
  Wrench,
  X
} from 'lucide-react';
import './LoginView.css';

interface LoginViewProps {
  technicians: any[];
  onLoginSuccess: LoginSuccessHandler;
}

export const LoginView: React.FC<LoginViewProps> = ({ technicians, onLoginSuccess }) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filtrar técnicos oficiais ativos
  const activeTechnicians = useMemo(() => {
    return (technicians || [])
      .filter(t => t.status === 'Ativo')
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [technicians]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) { setError('Selecione seu usuário.'); return; }
    if (selectedUserId === 'admin' && !pin.trim()) { setError('Digite o PIN de administrador.'); return; }
    setLoading(true);
    setError('');

    try {
      const data = await safeFetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedUserId === 'admin'
          ? { type: 'admin', pin: pin.trim() }
          : { type: 'technician', technician_id: Number(selectedUserId), pin: pin.trim() || '1234' })
      });

      if (data.success && data.user && data.token) {
        onLoginSuccess(data.user, data.token);
      } else {
        setError(data.error || 'PIN ou senha incorreta.');
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
          <p>Selecione seu usuário para acessar a operação.</p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="login-error-alert" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dispensar mensagem de erro" onClick={() => setError('')}><X size={15} /></button>
          </div>
        )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field-group">
              <label htmlFor="user-select-input">Usuário</label>
              <div className="login-input-wrap">
                <UserCheck size={18} className="login-input-icon" />
                <select
                  id="user-select-input"
                  required
                  value={selectedUserId}
                  onChange={e => { setSelectedUserId(e.target.value); setPin(''); setError(''); }}
                  className="login-select"
                >
                  <option value="">Selecione seu nome...</option>
                  <option value="admin">Administrador</option>
                  {activeTechnicians.map(tech => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name} ({tech.role || 'Técnico de Campo'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="login-field-group">
              <label htmlFor="user-pin-input">PIN / Senha</label>
              <div className="login-input-wrap">
                <Lock size={18} className="login-input-icon" />
                <input
                  id="user-pin-input"
                  type="password"
                  autoComplete="current-password"
                  placeholder={selectedUserId === 'admin' ? 'Digite o PIN de administrador' : 'Digite seu PIN'}
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                />
              </div>
              <small className="login-field-hint">{selectedUserId === 'admin' ? 'Informe o PIN de administrador.' : 'Caso ainda não tenha alterado, use o PIN padrão do seu perfil.'}</small>
            </div>

            <button type="submit" disabled={loading || !selectedUserId || (selectedUserId === 'admin' && !pin.trim())} className="login-submit-btn admin">
              {loading ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
              <span>{loading ? 'Autenticando…' : 'Entrar'}</span>
            </button>
          </form>

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
