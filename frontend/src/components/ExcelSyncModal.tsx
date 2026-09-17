import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  PlusCircle,
  FileCheck,
  Layers,
  Search,
  Calendar
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

const normalizeHeaderKey = (header: string): string =>
  String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_SHEETS = 20;
const MAX_IMPORT_ROWS = 5000;

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

const scoreHeaderRow = (row: any[]): number => {
  if (!Array.isArray(row)) return 0;
  let score = 0;
  const keywords = [
    /patrimonio|pat\b|asset_tag|tag\b|c[oó]digo/i,
    /modelo|marca/i,
    /s[eé]rie|serial/i,
    /calibra[cç][aã]o|verifica[cç][aã]o/i,
    /validade|vencimento|pr[oó]xima/i,
    /descri[cç][aã]o|equipamento|analisador|nome/i,
    /executor|certificado|localiza[cç][aã]o/i
  ];
  for (const cell of row) {
    const text = String(cell || '').trim();
    if (!text) continue;
    for (const kw of keywords) {
      if (kw.test(text)) {
        score++;
        break;
      }
    }
  }
  return score;
};

const findBestHeaderRow = (grid: any[][]): { headerIdx: number; headerKeys: string[]; score: number } => {
  let bestIdx = 0;
  let bestScore = 0;
  const searchDepth = Math.min(15, grid.length);

  for (let i = 0; i < searchDepth; i++) {
    const s = scoreHeaderRow(grid[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }

  const headerRow = grid[bestIdx] || [];
  const headerKeys = headerRow.map((cell: any) => normalizeHeaderKey(cell));
  return { headerIdx: bestIdx, headerKeys, score: bestScore };
};

export const ExcelSyncModal: React.FC<ExcelSyncModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  existingAnalyzers
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState('');
  const [resultSummary, setResultSummary] = useState<{
    total: number;
    createdCount: number;
    updatedCount: number;
    errorCount: number;
    errors?: Array<{ asset_tag: string; error: string }>;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lock body scroll when modal is active
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !syncing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, syncing, onClose]);

  const existingMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of existingAnalyzers || []) {
      if (item.asset_tag) {
        const tag = String(item.asset_tag).toUpperCase().trim();
        map.set(tag, item);
        if (/^\d+$/.test(tag)) {
          map.set(tag.padStart(6, '0'), item);
          const unpadded = tag.replace(/^0+/, '');
          if (unpadded) map.set(unpadded, item);
        }
      }
    }
    return map;
  }, [existingAnalyzers]);

  const parseSheetData = (wb: XLSX.WorkBook, sheetName: string) => {
    const worksheet = wb.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`A aba "${sheetName}" não foi encontrada no arquivo.`);
    }

    const grid = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
    if (!grid || grid.length === 0) {
      throw new Error(`A aba "${sheetName}" está vazia.`);
    }

    const { headerIdx, headerKeys, score } = findBestHeaderRow(grid);

    if (score === 0 && grid.length > 1) {
      throw new Error('Não foi possível identificar as colunas de Patrimônio ou Calibração nesta aba.');
    }

    const items: ParsedItem[] = [];

    for (let r = headerIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!Array.isArray(row) || row.every(c => c === '' || c === null || c === undefined)) continue;

      const normalized: Record<string, any> = {};
      headerKeys.forEach((key, cIdx) => {
        if (key) {
          normalized[key] = row[cIdx];
        } else {
          normalized[`__col_${cIdx}`] = row[cIdx];
        }
      });

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

      const rawAssetTag = find('pat', 'patrimonio', 'asset_tag', 'tag', 'novo_pat', 'codigo', 'cod_patrimonio', 'num_patrimonio', 'id_patrimonio');
      if (!rawAssetTag || String(rawAssetTag).trim() === '-' || String(rawAssetTag).trim() === '') continue;

      let assetTag = String(rawAssetTag).trim().toUpperCase();
      if (/^\d+$/.test(assetTag) && assetTag.length < 6) {
        assetTag = assetTag.padStart(6, '0');
      }

      const existing = existingMap.get(assetTag) || existingMap.get(assetTag.replace(/^0+/, ''));

      const rawName = find('descricao_marca', 'descricao', 'nome', 'analisador', 'nome_analisador', 'equipamento', 'padrao') || existing?.name || `Analisador ${assetTag}`;
      const nameStr = String(rawName).trim();

      let inferredType = 'Padrão Geral';
      if (nameStr.includes('/')) {
        const prefix = nameStr.split('/')[0].trim();
        if (prefix) inferredType = prefix;
      }

      const rawType = find('tipo', 'tipo_de_padrao', 'categoria', 'tipo_analisador') || existing?.type || inferredType;
      const rawSerial = find('no_serie', 'numero_de_serie', 'n_de_serie', 'serie', 'serial', 'serial_number') || existing?.serial_number || assetTag;
      const rawModel = find('modelo', 'marca_modelo', 'modelo_marca', 'marca', 'brand_model') || existing?.brand_model || nameStr;
      const rawCalib = find('data_calibracao', 'data_verificacao', 'data_de_calibracao', 'calibracao', 'calibrado_em', 'calibration_date');
      const rawExpiry = find('proxima_calibracao', 'proxima_verificacao', 'validade_da_calibracao', 'validade_calibracao', 'validade', 'vencimento', 'calibration_expiry', 'calibration_due');
      const rawStatus = find('status', 'situacao');
      const rawLocation = find('localizacao', 'local', 'almoxarifado') || existing?.current_location || 'Matriz';

      const cert = find('no_certificado', 'certificado');
      const executor = find('executor', 'responsavel');
      const approver = find('aprovado_por', 'aprovador');
      const periodicity = find('periodicidade');
      const existingNotes = find('observacoes', 'observacao', 'notas', 'notes');

      const calibDate = parseCellDate(rawCalib) ?? (existing?.calibration_date ? existing.calibration_date.slice(0, 10) : null);
      const expiryDate = parseCellDate(rawExpiry) ?? (existing?.calibration_expiry ? existing.calibration_expiry.slice(0, 10) : null);

      let status = existing?.status || 'Disponível';
      if (rawStatus) {
        const s = String(rawStatus).trim().toLowerCase();
        if (s.includes('uso') || s.includes('campo')) status = 'Em Uso';
        else if (s.includes('reser')) status = 'Reservado';
        else if (s.includes('manuten') || s.includes('quebr') || s.includes('defeito')) status = 'Em Manutenção';
        else status = 'Disponível';
      }

      const noteParts: string[] = [];
      if (existingNotes) noteParts.push(String(existingNotes).trim());
      if (cert) noteParts.push(`Certificado: ${cert}`);
      if (executor) noteParts.push(`Executor: ${executor}`);
      if (approver) noteParts.push(`Aprovado por: ${approver}`);
      if (periodicity) noteParts.push(`Periodicidade: ${periodicity} ano(s)`);

      items.push({
        asset_tag: assetTag,
        name: nameStr,
        type: String(rawType).trim(),
        serial_number: String(rawSerial).trim(),
        brand_model: String(rawModel).trim(),
        calibration_date: calibDate,
        calibration_expiry: expiryDate,
        status,
        current_location: String(rawLocation).trim() || 'Matriz',
        notes: noteParts.length > 0 ? noteParts.join(' | ') : (existing?.notes || ''),
        isExisting: Boolean(existing),
        existingItem: existing
      });
    }

    if (items.length === 0) {
      throw new Error(`Nenhum padrão com identificação (Patrimônio/Tag) encontrado na aba "${sheetName}".`);
    }

    return items;
  };

  const handleFileProcess = async (selectedFile: File) => {
    setErrorMsg(null);
    setResultSummary(null);
    setLoading(true);
    setFile(selectedFile);

    try {
      const extension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
      if (!['.xls', '.xlsx', '.csv'].includes(extension)) {
        throw new Error('Selecione um arquivo .xls, .xlsx ou .csv.');
      }
      if (selectedFile.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error('A planilha excede o limite de 5 MB.');
      }

      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        sheetRows: MAX_IMPORT_ROWS + 1
      });

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('O arquivo não contém nenhuma planilha legível.');
      }
      if (wb.SheetNames.length > MAX_IMPORT_SHEETS) {
        throw new Error(`A planilha excede o limite de ${MAX_IMPORT_SHEETS} abas.`);
      }

      setWorkbook(wb);
      setSheetNames(wb.SheetNames);

      // Determine best sheet by header scoring
      let targetSheet = wb.SheetNames[0];
      let bestScore = -1;

      for (const sName of wb.SheetNames) {
        const ws = wb.Sheets[sName];
        const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
        const { score } = findBestHeaderRow(grid);
        if (score > bestScore) {
          bestScore = score;
          targetSheet = sName;
        }
      }

      setCurrentSheet(targetSheet);
      const items = parseSheetData(wb, targetSheet);
      setParsedItems(items);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar planilha.');
      setParsedItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSheetChange = (newSheetName: string) => {
    if (!workbook || newSheetName === currentSheet) return;
    setErrorMsg(null);
    try {
      setCurrentSheet(newSheetName);
      const items = parseSheetData(workbook, newSheetName);
      setParsedItems(items);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar aba selecionada.');
      setParsedItems([]);
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
  const withDatesCount = parsedItems.filter(p => Boolean(p.calibration_expiry)).length;

  const filteredPreviewItems = useMemo(() => {
    if (!previewFilter.trim()) return parsedItems;
    const q = previewFilter.toLowerCase().trim();
    return parsedItems.filter(p =>
      p.asset_tag.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.brand_model.toLowerCase().includes(q) ||
      p.serial_number.toLowerCase().includes(q)
    );
  }, [parsedItems, previewFilter]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="excel-sync-title"
      onClick={e => {
        if (e.target === e.currentTarget && !syncing) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.78)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '960px',
          maxHeight: 'min(92vh, 880px)',
          backgroundColor: '#ffffff',
          color: '#0f172a',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'field-page-enter 180ms ease-out both'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#ffffff'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3
                id="excel-sync-title"
                style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.02em' }}
              >
                Sincronizar Padrões e Calibrações via Excel
              </h3>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Compatível com planilhas PAT03-F1 (Controle de Calibração / Matriz) e modelos customizados (.xls, .xlsx, .csv).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={syncing}
            style={{
              background: '#f1f5f9',
              border: 'none',
              cursor: syncing ? 'not-allowed' : 'pointer',
              color: '#64748b',
              padding: '8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Fechar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          {/* Error notification */}
          {errorMsg && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '0.9rem'
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Result View */}
          {resultSummary ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                padding: '28px 20px',
                borderRadius: '14px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                textAlign: 'center',
                alignItems: 'center'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: '#22c55e',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <CheckCircle2 size={34} />
              </div>
              <h4 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#166534', margin: 0 }}>
                Sincronização Concluída com Sucesso!
              </h4>
              <p style={{ margin: 0, fontSize: '0.92rem', color: '#15803d', maxWidth: '520px' }}>
                A identificação dos equipamentos e os registros de calibração foram sincronizados no banco de dados.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  width: '100%',
                  maxWidth: '540px',
                  marginTop: '8px'
                }}
              >
                <div style={{ backgroundColor: '#ffffff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block', fontWeight: 700 }}>TOTAL PROCESSADO</span>
                  <strong style={{ fontSize: '1.5rem', color: '#0f172a' }}>{resultSummary.total}</strong>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.74rem', color: '#166534', display: 'block', fontWeight: 700 }}>ATUALIZADOS</span>
                  <strong style={{ fontSize: '1.5rem', color: '#16a34a' }}>{resultSummary.updatedCount}</strong>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.74rem', color: '#1e40af', display: 'block', fontWeight: 700 }}>NOVOS CADASTRADOS</span>
                  <strong style={{ fontSize: '1.5rem', color: '#2563eb' }}>{resultSummary.createdCount}</strong>
                </div>
              </div>

              {resultSummary.errorCount > 0 && (
                <div
                  style={{
                    width: '100%',
                    maxWidth: '540px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#fff1f2',
                    border: '1px solid #fecdd3',
                    color: '#9f1239',
                    fontSize: '0.82rem',
                    textAlign: 'left'
                  }}
                >
                  <strong>{resultSummary.errorCount} padrão(ões) com falha no processamento.</strong>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                onClick={onClose}
                style={{ marginTop: '12px', minWidth: '180px', padding: '10px 20px' }}
              >
                Concluir e Fechar
              </button>
            </div>
          ) : (
            <>
              {/* Step 1: Upload and Template */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#334155' }}>
                    1. Selecione a planilha de controle (.xls, .xlsx ou .csv)
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                  >
                    <Download size={14} /> Baixar Modelo Padrão (.xlsx)
                  </button>
                </div>

                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? '#2563eb' : '#cbd5e1'}`,
                    borderRadius: '12px',
                    padding: '28px 16px',
                    textAlign: 'center',
                    backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.05)' : '#f8fafc',
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
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '50%',
                      backgroundColor: '#e0f2fe',
                      color: '#0284c7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Upload size={22} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.98rem', color: '#0f172a' }}>
                      {file ? file.name : 'Clique para escolher ou arraste o arquivo Excel aqui'}
                    </strong>
                    <span style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                      Reconhece automaticamente PAT03-F1 (Controle de Calibração) e planilhas com colunas PAT, Modelo, Série e Validade
                    </span>
                  </div>
                </div>
              </div>

              {/* Multi-sheet selection pill tabs */}
              {sheetNames.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 12px', backgroundColor: '#f1f5f9', borderRadius: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
                    <Layers size={16} /> Aba da planilha:
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {sheetNames.map(sName => (
                      <button
                        key={sName}
                        type="button"
                        onClick={() => handleSheetChange(sName)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          border: currentSheet === sName ? '1px solid #2563eb' : '1px solid #cbd5e1',
                          backgroundColor: currentSheet === sName ? '#2563eb' : '#ffffff',
                          color: currentSheet === sName ? '#ffffff' : '#334155',
                          fontSize: '0.8rem',
                          fontWeight: currentSheet === sName ? 700 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {sName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 2: Preview & Validation Table */}
              {parsedItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#334155' }}>
                        2. Pré-visualização dos Padrões ({parsedItems.length} detectados)
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: '0.76rem',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          backgroundColor: '#dcfce7',
                          color: '#166534',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <RefreshCw size={12} /> {toUpdateCount} para atualizar
                      </span>
                      <span
                        style={{
                          fontSize: '0.76rem',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          backgroundColor: '#dbeafe',
                          color: '#1e40af',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <PlusCircle size={12} /> {toCreateCount} novos
                      </span>
                      <span
                        style={{
                          fontSize: '0.76rem',
                          padding: '4px 10px',
                          borderRadius: '999px',
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Calendar size={12} /> {withDatesCount} com calibração
                      </span>
                    </div>
                  </div>

                  {/* Filter Search Input */}
                  <div style={{ position: 'relative', maxWidth: '340px' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      type="text"
                      placeholder="Filtrar por patrimônio, descrição ou série..."
                      value={previewFilter}
                      onChange={e => setPreviewFilter(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 12px 7px 32px',
                        fontSize: '0.82rem',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        color: '#0f172a',
                        outline: 'none'
                      }}
                    />
                  </div>

                  {/* Table Preview */}
                  <div
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      backgroundColor: '#ffffff',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 2, borderBottom: '1px solid #e2e8f0' }}>
                        <tr style={{ color: '#475569' }}>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Ação</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Patrimônio</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Descrição / Equipamento</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Modelo</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Nº Série</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Calibração</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Validade</th>
                          <th style={{ padding: '9px 12px', fontWeight: 700 }}>Localização</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreviewItems.slice(0, 50).map((item, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff'
                            }}
                          >
                            <td style={{ padding: '8px 12px' }}>
                              {item.isExisting ? (
                                <span
                                  style={{
                                    padding: '3px 8px',
                                    borderRadius: '999px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    backgroundColor: '#dcfce7',
                                    color: '#166534'
                                  }}
                                >
                                  Atualizar
                                </span>
                              ) : (
                                <span
                                  style={{
                                    padding: '3px 8px',
                                    borderRadius: '999px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    backgroundColor: '#dbeafe',
                                    color: '#1e40af'
                                  }}
                                >
                                  Novo
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                              {item.asset_tag}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#1e293b', fontWeight: 500 }}>
                              {item.name}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>
                              {item.brand_model || '-'}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748b', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                              {item.serial_number || '-'}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#334155' }}>
                              {formatDatePtBr(item.calibration_date)}
                            </td>
                            <td
                              style={{
                                padding: '8px 12px',
                                fontWeight: 700,
                                color: item.calibration_expiry ? '#0284c7' : '#94a3b8'
                              }}
                            >
                              {formatDatePtBr(item.calibration_expiry)}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748b' }}>
                              {item.current_location}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {filteredPreviewItems.length > 50 && (
                      <div style={{ padding: '10px', textAlign: 'center', fontSize: '0.8rem', color: '#64748b', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                        Exibindo os primeiros 50 itens de {filteredPreviewItems.length}. Todos os {parsedItems.length} itens serão processados na sincronização.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        {!resultSummary && (
          <div
            style={{
              padding: '16px 24px',
              borderTop: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '12px'
            }}
          >
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
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 20px' }}
            >
              {syncing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Sincronizando com o Banco...
                </>
              ) : (
                <>
                  <FileCheck size={16} /> Confirmar e Sincronizar ({parsedItems.length} Padrões)
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
