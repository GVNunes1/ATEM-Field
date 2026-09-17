import { ModalOverlay } from '../components/ModalOverlay';
import React, { useMemo, useState } from 'react';
import { CheckSquare, Plus, Activity, Sliders, Shield, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { safeFetchJson } from '../lib/api';

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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const totalTemplates = useMemo(() => categories.reduce((acc, cat) => acc + (cat.templates?.length || 0), 0), [categories]);

  const uniqueAnalyzerTypes = useMemo(() => {
    const types = new Set<string>();
    categories.forEach(cat => cat.templates?.forEach((t: any) => t.analyzer_type && types.add(t.analyzer_type)));
    return types.size;
  }, [categories]);

  const totalParams = useMemo(() => {
    let count = 0;
    categories.forEach(cat => cat.templates?.forEach((t: any) => {
      count += (t.required_parameters?.length || 0);
    }));
    return count;
  }, [categories]);

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const paramsList = paramsInput.split('\n').map(p => p.trim()).filter(Boolean);
      const data = await safeFetchJson('/api/categories/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCatId,
          analyzer_type: analyzerType,
          required_parameters: paramsList
        })
      });
      if (data.success) {
        setNotice('Template de teste e parâmetros salvos com sucesso!');
        setShowAddModal(false);
        setAnalyzerType('');
        setParamsInput('');
        onRefresh();
      } else {
        setError(data.error || 'Erro ao cadastrar template.');
      }
    } catch (err: any) {
      setError(err.message || 'Falha de comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="checklist-view field-dashboard">
      <header className="field-page-heading">
        <div>
          <span className="field-overline">Padronização Técnica</span>
          <h1>Templates de checklist.</h1>
          <p>Mapeamento de analisadores necessários e parâmetros de teste exigidos por categoria de equipamento médico.</p>
        </div>

        <button
          type="button"
          onClick={() => { setShowAddModal(true); setError(''); }}
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Plus size={18} /> Novo template
        </button>
      </header>

      {notice && (
        <div className="operations-notice is-success" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: '8px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckCircle2 size={18} /><span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor' }}><X size={16} /></button>
        </div>
      )}

      {error && !showAddModal && (
        <div className="operations-notice is-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircle size={18} /><span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} aria-label="Fechar erro" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor' }}><X size={16} /></button>
        </div>
      )}

      {/* Metrics Strip */}
      <section className="field-metrics" aria-label="Indicadores dos templates">
        <div className="field-metric available">
          <span className="field-metric-label">
            Categorias médicas
            <Activity size={17} aria-hidden="true" />
          </span>
          <strong>{categories.length}</strong>
          <span className="field-metric-detail">Modalidades mapeadas</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Templates de teste
            <CheckSquare size={17} aria-hidden="true" />
          </span>
          <strong>{totalTemplates}</strong>
          <span className="field-metric-detail">Configurações de ensaio</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Padrões vinculados
            <Shield size={17} aria-hidden="true" />
          </span>
          <strong>{uniqueAnalyzerTypes}</strong>
          <span className="field-metric-detail">Tipos de analisadores</span>
        </div>

        <div className="field-metric">
          <span className="field-metric-label">
            Parâmetros técnicos
            <Sliders size={17} aria-hidden="true" />
          </span>
          <strong>{totalParams}</strong>
          <span className="field-metric-detail">Itens aferidos nos laudos</span>
        </div>
      </section>

      {/* Grid of Equipment Categories */}
      <div className="field-template-grid">
        {categories.map((cat: any) => {
          const templatesCount = cat.templates?.length || 0;
          return (
            <div key={cat.id} className="field-surface" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="field-template-card-heading">
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 650, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '-0.03em' }}>
                    <Activity size={18} color="var(--primary)" /> {cat.name}
                  </h3>
                  {cat.description && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
                      {cat.description}
                    </p>
                  )}
                </div>
                <span className="badge badge-purple" style={{ whiteSpace: 'nowrap' }}>
                  {templatesCount} {templatesCount === 1 ? 'analisador exigido' : 'analisadores exigidos'}
                </span>
              </div>

              {/* List of Templates & Parameters */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {cat.templates && cat.templates.length > 0 ? (
                  cat.templates.map((tmpl: any) => (
                    <div
                      key={tmpl.id}
                      style={{
                        background: '#f8fafc',
                        padding: '14px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-subtle)'
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Shield size={15} color="var(--primary)" /> {tmpl.analyzer_type}
                      </div>

                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Parâmetros obrigatórios ({tmpl.required_parameters?.length || 0})
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {tmpl.required_parameters && tmpl.required_parameters.length > 0 ? (
                          tmpl.required_parameters.map((param: string, idx: number) => (
                            <div key={idx} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ color: 'var(--primary)', fontWeight: 700 }}>•</span> {param}
                            </div>
                          ))
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Nenhum parâmetro configurado.</div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px', background: '#fafbfd', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                    Nenhum template cadastrado para esta modalidade.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Add Template */}
      {showAddModal && (
        <ModalOverlay onDismiss={() => { if (!loading) setShowAddModal(false); }} className="modal-overlay" role="presentation" onMouseDown={e => {
          if (e.currentTarget === e.target) setShowAddModal(false);
        }}>
          <div className="modal-content" style={{ width: '100%', maxWidth: '520px', padding: '26px' }} role="dialog" aria-modal="true" aria-labelledby="modal-template-title">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <span className="field-overline" style={{ marginBottom: '4px' }}>Novo Template</span>
                <h3 id="modal-template-title" style={{ fontSize: '1.2rem', fontWeight: 650, letterSpacing: '-0.03em' }}>
                  Requisitos por Equipamento
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Fechar modal"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="operations-notice is-error" style={{ marginBottom: '14px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', fontSize: '0.82rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleAddTemplate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 550, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Categoria do Equipamento
                </label>
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
                <label style={{ fontSize: '0.78rem', fontWeight: 550, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Tipo do Analisador Necessário
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex.: Analisador de Desfibrilador"
                  className="input-field"
                  value={analyzerType}
                  onChange={e => setAnalyzerType(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 550, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Parâmetros Exigidos (1 por linha)
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Energia de Choque Selecionada (J)&#10;Tempo de Carga (s)&#10;Frequência de Marcapasso (PPM)"
                  className="input-field"
                  value={paramsInput}
                  onChange={e => setParamsInput(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Salvando...' : 'Salvar Template'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};
