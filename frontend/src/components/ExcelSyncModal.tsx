import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  ArrowRight,
  PlusCircle,
  FileCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { safeFetchJson } from '../lib/api';

interface ExcelSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingAnalyzers: any[];
}

interface ParsedItem {
  asset_tag: string;
  name: string;
  type: string;
  serial_number: string;
  brand_model: string;
  calibration_date: string | null;
  calibration_expiry: string | null;
  status: string;
  current_location: string;
  notes: string;
  isExisting: boolean;
  existingItem?: any;
}

const normalizeHeaderKey = (header: string) =>
  String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const parseCellDate = (value: any): string | null => {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = String(parsed.y).padStart(4, '2000');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  const brMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    let year = brMatch[3];
    if (year.length === 2) {
      const num = parseInt(year, 10);
      year = num >= 70 ? `19${year}` : `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1980 && parsed.getFullYear() < 2100) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
};

const formatDatePtBr = (isoDate: string | null) => {
  if (!isoDate) return 'Não informada';
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return isoDate;
};

export const ExcelSyncModal: React.FC<ExcelSyncModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingAnalyzers
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    total: number;
    createdCount: number;
    updatedCount: number;
    errorCount: number;
    errors?: Array<{ asset_tag: string; error: string }>;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileProcess = async (selectedFile: File) => {
    setErrorMsg(null);
    setResultSummary(null);
    setLoading(true);
    setFile(selectedFile);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('O arquivo não contém nenhuma planilha legível.');
      }

      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        throw new Error('A planilha está vazia ou não contém dados válidos.');
      }

      const existingMap = new Map<string, any>();
      for (const item of existingAnalyzers || []) {
        if (item.asset_tag) {
          existingMap.set(String(item.asset_tag).toUpperCase().trim(), item);
        }
      }

      const items: ParsedItem[] = [];

      for (const row of rawRows) {
        const normalized: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          normalized[normalizeHeaderKey(k)] = v;
        }

        const find = (...aliases: string[]) => {
          for (const alias of aliases) {
            if (normalized[alias] !== undefined && normalized[alias] !== null && String(normalized[alias]).trim() !== '') {
              return normalized[alias];
            }
          }
          for (const [k, v] of Object.entries(normalized)) {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              for (const alias of aliases) {
                if (k.includes(alias)) return v;
              }
            }
          }
          return undefined;
        };

        const rawAssetTag = find('patrimonio', 'asset_tag', 'tag', 'codigo', 'cod_patrimonio', 'num_patrimonio', 'id_patrimonio');
        if (!rawAssetTag) continue;

        const assetTag = String(rawAssetTag).trim().toUpperCase();
        const existing = existingMap.get(assetTag);

        const rawName = find('nome', 'analisador', 'nome_analisador', 'descricao', 'equipamento', 'padrao') || existing?.name || `Analisador ${assetTag}`;
        const rawType = find('tipo', 'tipo_de_padrao', 'categoria', 'tipo_analisador') || existing?.type || 'Padrão Geral';
        const rawSerial = find('numero_de_serie', 'n_de_serie', 'serie', 'serial', 'serial_number') || existing?.serial_number || assetTag;
        const rawModel = find('marca_modelo', 'modelo_marca', 'modelo', 'marca', 'brand_model') || existing?.brand_model || String(rawName);
        const rawCalib = find('data_de_calibracao', 'data_calibracao', 'calibracao', 'calibrado_em', 'calibration_date');
        const rawExpiry = find('validade_da_calibracao', 'validade_calibracao', 'validade', 'vencimento', 'proxima_calibracao', 'calibration_expiry', 'calibration_due');
        const rawStatus = find('status', 'situacao');
        const rawLocation = find('localizacao', 'local', 'almoxarifado') || existing?.current_location || 'Almoxarifado Central';
        const rawNotes = find('observacoes', 'observacao', 'notas', 'notes') || existing?.notes || '';

        const calibDate = parseCellDate(rawCalib) ?? (existing?.calibration_date ? existing.calibration_date.slice(0, 10) : null);
        const expiryDate = parseCellDate(rawExpiry) ?? (existing?.calibration_expiry ? existing.calibration_expiry.slice(0, 10) : null);

        let status = existing?.status || 'Disponível';
        if (rawStatus) {
          const s = String(rawStatus).trim().toLowerCase();
          if (s.includes('uso') || s.includes('campo')) status = 'Em Uso';
          else if (s.includes('reser')) status = 'Reservado';
          else if (s.includes('manuten')) status = 'Em Manutenção';
          else status = 'Disponível';
        }

        items.push({
          asset_tag: assetTag,
          name: String(rawName).trim(),
          type: String(rawType).trim(),
          serial_number: String(rawSerial).trim(),
          brand_model: String(rawModel).trim(),
          calibration_date: calibDate,
          calibration_expiry: expiryDate,
          status,
          current_location: String(rawLocation).trim(),
          notes: String(rawNotes).trim(),
          isExisting: Boolean(existing),
          existingItem: existing
        });
      }

      if (items.length === 0) {
        throw new Error('Nenhuma coluna de Patrimônio encontrada. Certifique-se de que a planilha possui a coluna "Patrimônio" ou "Asset Tag".');
      }

      setParsedItems(items);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar planilha.');
      setParsedItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleDownloadTemplate = () => {
    window.open('/api/analyzers/template-excel', '_blank');
  };

  const handleConfirmSync = async () => {
    if (parsedItems.length === 0) return;
    setSyncing(true);
    setErrorMsg(null);

    try {
      const payload = {
        rows: parsedItems.map(p => ({
          asset_tag: p.asset_tag,
          name: p.name,
          type: p.type,
          serial_number: p.serial_number,
          brand_model: p.brand_model,
          status: p.status,
          calibration_date: p.calibration_date,
          calibration_expiry: p.calibration_expiry,
          current_location: p.current_location,
          notes: p.notes
        }))
      };

      const res = await safeFetchJson('/api/analyzers/sync-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.success) {
        setResultSummary({
          total: res.total,
          createdCount: res.createdCount,
          updatedCount: res.updatedCount,
          errorCount: res.errorCount,
          errors: res.errors
        });
        onSuccess();
      } else {
        setErrorMsg(res.error || 'Erro ao sincronizar dados.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao sincronizar com o servidor.');
    } finally {
      setSyncing(false);
    }
  };

  const toUpdateCount = parsedItems.filter(p => p.isExisting).length;
  const toCreateCount = parsedItems.filter(p => !p.isExisting).length;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
      padding: '20px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '860px',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: '28px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#3b82f6',
                padding: '8px',
                borderRadius: '10px'
              }}>
                <FileSpreadsheet size={24} />
              </div>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                Sincronização de Padrões & Calibração via Excel
              </h3>
            </div>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.86rem', color: '#64748b' }}>
              Importe ou atualize a identificação e os prazos de calibração dos analisadores em lote.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Error notification */}
        {errorMsg && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '10px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.9rem'
          }}>
            <AlertTriangle size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Result screen */}
        {resultSummary ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '20px',
            borderRadius: '14px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            textAlign: 'center',
            alignItems: 'center'
          }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: '#22c55e',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <CheckCircle2 size={32} />
            </div>
            <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#166534', margin: 0 }}>
              Sincronização Concluída com Sucesso!
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              width: '100%',
              maxWidth: '520px',
              marginTop: '8px'
            }}>
              <div style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', fontWeight: 600 }}>TOTAL PROCESSADO</span>
                <strong style={{ fontSize: '1.4rem', color: '#0f172a' }}>{resultSummary.total}</strong>
              </div>
              <div style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.75rem', color: '#166534', display: 'block', fontWeight: 600 }}>ATUALIZADOS</span>
                <strong style={{ fontSize: '1.4rem', color: '#16a34a' }}>{resultSummary.updatedCount}</strong>
              </div>
              <div style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '0.75rem', color: '#1e40af', display: 'block', fontWeight: 600 }}>NOVOS CADASTRADOS</span>
                <strong style={{ fontSize: '1.4rem', color: '#2563eb' }}>{resultSummary.createdCount}</strong>
              </div>
            </div>

            {resultSummary.errorCount > 0 && (
              <div style={{
                width: '100%',
                maxWidth: '520px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#fff1f2',
                border: '1px solid #fecdd3',
                color: '#9f1239',
                fontSize: '0.82rem',
                textAlign: 'left'
              }}>
                <strong>{resultSummary.errorCount} padrão(ões) com falha no processamento.</strong>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={onClose}
              style={{ marginTop: '12px', minWidth: '160px' }}
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            {/* Upload Zone & Download Template */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
                  1. Selecionar Planilha
                </span>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={15} /> Baixar Modelo Excel (.xlsx)
                </button>
              </div>

              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? '#3b82f6' : '#cbd5e1'}`,
                  borderRadius: '14px',
                  padding: '32px 20px',
                  textAlign: 'center',
                  background: isDragging ? 'rgba(59, 130, 246, 0.05)' : '#f8fafc',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  style={{ display: 'none' }}
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileProcess(e.target.files[0]);
                    }
                  }}
                />
                <div style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Upload size={22} />
                </div>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.98rem', color: '#0f172a' }}>
                    {file ? file.name : 'Clique para escolher ou arraste o arquivo Excel aqui'}
                  </strong>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Suporta arquivos .xlsx, .xls e .csv com colunas de patrimônio, modelo e calibração
                  </span>
                </div>
              </div>
            </div>

            {/* Preview Section */}
            {parsedItems.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
                    2. Pré-visualização & Mapeamento ({parsedItems.length} identificados)
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{
                      fontSize: '0.78rem',
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: '#dbeafe',
                      color: '#1e40af',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <PlusCircle size={13} /> {toCreateCount} novos
                    </span>
                    <span style={{
                      fontSize: '0.78rem',
                      padding: '3px 9px',
                      borderRadius: '999px',
                      background: '#dcfce7',
                      color: '#166534',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <RefreshCw size={13} /> {toUpdateCount} atualizações
                    </span>
                  </div>
                </div>

                {/* Table Preview */}
                <div style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  overflowX: 'auto',
                  maxHeight: '280px',
                  background: '#fff'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '8px 12px' }}>Ação</th>
                        <th style={{ padding: '8px 12px' }}>Patrimônio</th>
                        <th style={{ padding: '8px 12px' }}>Nome / Padrão</th>
                        <th style={{ padding: '8px 12px' }}>Tipo</th>
                        <th style={{ padding: '8px 12px' }}>Nº Série</th>
                        <th style={{ padding: '8px 12px' }}>Última Calibração</th>
                        <th style={{ padding: '8px 12px' }}>Validade Calibração</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedItems.slice(0, 15).map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 12px' }}>
                            {item.isExisting ? (
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: '999px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                background: '#dcfce7',
                                color: '#166534'
                              }}>
                                Atualizar
                              </span>
                            ) : (
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: '999px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                background: '#dbeafe',
                                color: '#1e40af'
                              }}>
                                Novo
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0f172a' }}>{item.asset_tag}</td>
                          <td style={{ padding: '8px 12px' }}>{item.name}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{item.type}</td>
                          <td style={{ padding: '8px 12px', color: '#64748b' }}>{item.serial_number}</td>
                          <td style={{ padding: '8px 12px' }}>{formatDatePtBr(item.calibration_date)}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: item.calibration_expiry ? '#0369a1' : '#94a3b8' }}>
                            {formatDatePtBr(item.calibration_expiry)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedItems.length > 15 && (
                    <div style={{ padding: '8px', textAlign: 'center', fontSize: '0.78rem', color: '#64748b', background: '#f8fafc' }}>
                      E mais {parsedItems.length - 15} itens encontrados...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={syncing}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmSync}
                disabled={parsedItems.length === 0 || syncing || loading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                {syncing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Sincronizando...
                  </>
                ) : (
                  <>
                    <FileCheck size={16} /> Confirmar e Sincronizar ({parsedItems.length})
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
