import React from 'react';
import { Box, CheckCircle2, Clock, AlertTriangle, Calendar, Users, ArrowRight, Shield, PackageCheck } from 'lucide-react';

interface DashboardViewProps {
  stats: any;
  recentReservations: any[];
  onNavigate: (tab: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ stats, recentReservations, onNavigate }) => {
  if (!stats) return <div style={{ color: 'var(--text-muted)', padding: '20px' }}>Carregando dados...</div>;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Hero Banner */}
      <div className="glass-panel" style={{
        padding: '24px 32px',
        background: 'linear-gradient(135deg, #ffffff 0%, #eef5ff 100%)',
        borderLeft: '5px solid var(--primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '6px' }}>
            Visão Geral das Operações & Controle de Patrimônio
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '680px' }}>
            Agenda sincronizada, controle de padrões por patrimônio e reservas feitas pelo administrador ou pelo portal individual de cada técnico.
          </p>
        </div>
        <button onClick={() => onNavigate('operations')} className="btn btn-primary">
          <PackageCheck size={18} /> Administrar reservas
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>DISPONÍVEIS</span>
            <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
              <CheckCircle2 size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399' }}>{stats.availableAnalyzers}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>de {stats.totalAnalyzers} analisadores cadastrados</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>RESERVADOS</span>
            <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
              <Clock size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#60a5fa' }}>{stats.reservedAnalyzers}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Patrimônios reservados por técnicos</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>EM CAMPO (USO)</span>
            <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' }}>
              <Box size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#c084fc' }}>{stats.inUseAnalyzers}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Em atendimento com técnico</span>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>ATENDIMENTOS HOJE</span>
            <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
              <Calendar size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fbbf24' }}>{stats.todayAppointments}</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sincronizados na Agenda</span>
        </div>

      </div>

      {/* Main Content Sections Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
        
        {/* Recent Reservations Log */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} color="var(--primary)" /> Últimas Reservas de Patrimônio
            </h3>
            <button onClick={() => onNavigate('operations')} className="btn btn-secondary btn-sm">
              Ver Todos <ArrowRight size={14} />
            </button>
          </div>

          {recentReservations && recentReservations.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentReservations.map((res: any) => (
                <div key={res.id} style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '14px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="badge badge-purple" style={{ fontFamily: 'var(--font-mono)' }}>{res.asset_tag}</span>
                      <strong style={{ fontSize: '0.9rem' }}>{res.analyzer_name}</strong>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Técnico: <span style={{ color: 'var(--text-main)' }}>{res.technician_name}</span> • Cliente: <span style={{ color: 'var(--text-main)' }}>{res.client_name}</span>
                    </p>
                  </div>
                  <span className={`badge ${res.status === 'Em Uso' ? 'badge-warning' : res.status === 'Reservado' ? 'badge-info' : 'badge-success'}`}>
                    {res.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>
              Nenhuma reserva registrada recentemente.
            </div>
          )}
        </div>

        {/* System Workflow Summary */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={18} color="var(--secondary)" /> Fluxo Automatizado da Rotina
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>1</div>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Agenda Online Sincronizada</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>O supervisor cadastra os atendimentos na Agenda Online. O sistema importa automaticamente cliente, equipamentos e horários.</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>2</div>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Reserva administrativa</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>O supervisor seleciona o atendimento, o técnico responsável e um patrimônio disponível diretamente no painel.</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>3</div>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Portal individual do técnico</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Por um acesso temporário e individual, o técnico visualiza somente seus atendimentos, confere os requisitos e reserva o patrimônio correto.</p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>4</div>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>WhatsApp com link da reserva</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Próxima etapa: enviar às 17:00 e 07:00 um lembrete no WhatsApp com o link individual do portal e o resumo da agenda.</p>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
