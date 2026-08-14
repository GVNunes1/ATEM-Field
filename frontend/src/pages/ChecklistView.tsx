import React, { useState } from 'react';
import { CheckSquare, Plus, Activity, Sliders, Shield, Tag } from 'lucide-react';

interface ChecklistViewProps {
  categories: any[];
  onRefresh: () => void;
}

export const ChecklistView: React.FC<ChecklistViewProps> = ({ categories, onRefresh }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState<number>(categories[0]?.id || 1);
  const [analyzerType, setAnalyzerType] = useState('');
  const [paramsInput, setParamsInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const paramsList = paramsInput.split('\n').map(p => p.trim()).filter(Boolean);
      const res = await fetch('/api/categories/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCatId,
          analyzer_type: analyzerType,
          required_parameters: paramsList
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Template de teste e parâmetros salvos com sucesso!');
        setShowAddModal(false);
        setAnalyzerType('');
        setParamsInput('');
        onRefresh();
      } else {
        alert('Erro: ' + data.error);
      }
    } catch (err: any) {
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header Bar */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckSquare size={22} color="var(--primary)" /> Cadastro de Templates & Parâmetros por Categoria
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Mapeamento automático de quais analisadores/simuladores e parâmetros cada tipo de equipamento exige.
          </p>
        </div>

        <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
          <Plus size={18} /> Novo Template de Teste
        </button>
      </div>

      {/* Grid of Equipment Categories */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {categories.map((cat: any) => (
          <div key={cat.id} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={18} /> {cat.name}
              </h3>
              <span className="badge badge-purple">{cat.templates?.length || 0} Analisadores Exigidos</span>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {cat.description}
            </p>

            {/* List of Templates & Parameters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {cat.templates && cat.templates.length > 0 ? (
                cat.templates.map((tmpl: any) => (
                  <div key={tmpl.id} style={{ background: '#f7f9fc', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--status-low)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Shield size={15} /> {tmpl.analyzer_type}
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>
                      📋 Parâmetros Obrigatórios a Testar:
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {tmpl.required_parameters.map((param: string, idx: number) => (
                        <div key={idx} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>•</span> {param}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center', padding: '12px' }}>
                  Nenhum template cadastrado para esta categoria.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal Add Template */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '16px' }}>
              Novo Template de Teste por Equipamento
            </h3>

            <form onSubmit={handleAddTemplate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Categoria do Equipamento</label>
                <select
                  className="select-field"
                  value={selectedCatId}
                  onChange={e => setSelectedCatId(Number(e.target.value))}
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tipo do Analisador Necessário</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Analisador de Desfibrilador"
                  className="input-field"
                  value={analyzerType}
                  onChange={e => setAnalyzerType(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Parâmetros Exigidos (1 por linha)</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Energia de Choque Selecionada (J)&#10;Tempo de Carga (s)&#10;Frequência de Marcapasso (PPM)"
                  className="input-field"
                  value={paramsInput}
                  onChange={e => setParamsInput(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Salvando...' : 'Salvar Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
