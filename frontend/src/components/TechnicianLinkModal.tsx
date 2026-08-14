import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  MessageSquare,
  ShieldCheck,
  X
} from 'lucide-react';
import './TechnicianLinkModal.css';

interface TechnicianLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  technicians: any[];
  defaultTechnicianId?: number | null;
}

export const TechnicianLinkModal: React.FC<TechnicianLinkModalProps> = ({
  isOpen,
  onClose,
  technicians,
  defaultTechnicianId
}) => {
  const activeTechnicians = useMemo(() => {
    return technicians.filter(t => t.status !== 'Inativo');
  }, [technicians]);

  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [portalUrl, setPortalUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedType, setCopiedType] = useState<'url' | 'message' | null>(null);
  const [error, setError] = useState<string>('');

  const fetchPortalLink = useCallback(async (techId: number) => {
    if (!techId) return;
    setLoading(true);
    setError('');
    setCopiedType(null);
    try {
      const res = await fetch(`/api/technicians/${techId}/portal-link`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.portal_url) {
        setPortalUrl(data.portal_url);
      } else {
        setError(data.error || 'Não foi possível gerar o link.');
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Falha na conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPortalUrl('');
      setError('');
      setCopiedType(null);
      setSelectedTechId('');
      return;
    }

    const initialId = defaultTechnicianId
      ? String(defaultTechnicianId)
      : activeTechnicians.length > 0
        ? String(activeTechnicians[0].id)
        : '';

    setSelectedTechId(initialId);
    if (initialId) {
      void fetchPortalLink(Number(initialId));
    }
  }, [isOpen, defaultTechnicianId, activeTechnicians, fetchPortalLink]);

  if (!isOpen) return null;

  const currentTechnician = activeTechnicians.find(t => String(t.id) === String(selectedTechId));

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const techIdStr = e.target.value;
    setSelectedTechId(techIdStr);
    if (techIdStr) {
      void fetchPortalLink(Number(techIdStr));
    }
  };

  const getFormattedMessage = () => {
    const name = currentTechnician?.name || 'Técnico';
    return `🚨 ACCESSO AO PORTAL DO TÉCNICO - ATEM FIELD\nOlá ${name}! Aqui está o seu link individual para consultar sua agenda de atendimentos e registrar a reserva e devolução de simuladores:\n\n🔗 ${portalUrl}\n\n(Válido por 72 horas · Acesso seguro e individual)`;
  };

  const handleCopyUrl = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopiedType('url');
      setTimeout(() => setCopiedType(null), 3000);
    } catch {
      setError('Não foi possível copiar automaticamente.');
    }
  };

  const handleCopyMessage = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(getFormattedMessage());
      setCopiedType('message');
      setTimeout(() => setCopiedType(null), 3000);
    } catch {
      setError('Não foi possível copiar automaticamente.');
    }
  };

  return (
    <div className="link-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="link-modal-card animate-fade-in">
        <div className="link-modal-header">
          <div>
            <h3><Link2 size={20} /> Gerador de Link do Técnico</h3>
            <p>Gere o acesso individual ao portal de reservas de qualquer profissional</p>
          </div>
          <button type="button" className="link-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="link-modal-body">
          {/* Technician Select */}
          <div className="link-modal-field">
            <label htmlFor="tech-select">Selecione o Técnico</label>
            <select
              id="tech-select"
              className="link-modal-select"
              value={selectedTechId}
              onChange={handleSelectChange}
            >
              {activeTechnicians.map(tech => (
                <option key={tech.id} value={tech.id}>
                  {tech.name} {tech.phone ? `· ${tech.phone}` : ''}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              <LoaderCircle className="spin" size={24} style={{ margin: '0 auto 8px display' }} />
              <p style={{ fontSize: '0.85rem' }}>Gerando link com token seguro HMAC-SHA256...</p>
            </div>
          ) : error ? (
            <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : portalUrl ? (
            <>
              {/* Copied Toast Notification */}
              {copiedType && (
                <div className="link-copy-toast">
                  <CheckCircle2 size={16} />
                  <span>
                    {copiedType === 'url'
                      ? 'Link copiado para a área de transferência!'
                      : 'Mensagem formatada copiada! Pronta para colar no WhatsApp.'}
                  </span>
                </div>
              )}

              {/* Direct URL Box */}
              <div className="link-result-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#0369a1' }}>
                    <ShieldCheck size={14} style={{ display: 'inline', marginRight: '4px' }} />
                    URL Individual de Acesso (Válido por 72h)
                  </span>
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '0.78rem', color: '#0284c7', textDecoration: 'none', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    Testar / Abrir <ExternalLink size={13} />
                  </a>
                </div>

                <div className="link-result-row">
                  <input className="link-result-input" readOnly value={portalUrl} />
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleCopyUrl} style={{ gap: '6px' }}>
                    {copiedType === 'url' ? <Check size={16} /> : <Copy size={16} />}
                    {copiedType === 'url' ? 'Copiado!' : 'Copiar Link'}
                  </button>
                </div>
              </div>

              {/* Formatted Message Preview */}
              <div className="link-modal-field">
                <label>Mensagem Formatada (Pronta para colar)</label>
                <div className="link-message-preview">{getFormattedMessage()}</div>
              </div>

              {/* Action Buttons */}
              <div className="link-modal-actions">
                <button type="button" className="btn btn-primary" onClick={handleCopyMessage} style={{ flex: 1, gap: '8px' }}>
                  <MessageSquare size={16} />
                  {copiedType === 'message' ? 'Mensagem Copiada!' : 'Copiar Mensagem Formatada'}
                </button>

                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Fechar
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
