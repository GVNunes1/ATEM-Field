import * as XLSX from 'xlsx';

// Keep spreadsheet parsing bounded. These limits protect both the browser
// preview and the backend sync endpoint from oversized or pathological files.
export const MAX_EXCEL_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_EXCEL_BASE64_LENGTH = Math.ceil(MAX_EXCEL_FILE_BYTES / 3) * 4;
export const MAX_EXCEL_SHEETS = 20;
export const MAX_EXCEL_ROWS = 5000;

export interface AnalyzerExcelRow {
  asset_tag: string;
  name: string;
  type: string;
  serial_number: string;
  brand_model?: string;
  status?: string;
  calibration_date?: string | null;
  calibration_expiry?: string | null;
  current_location?: string;
  notes?: string;
  rawRowIndex?: number;
}

/**
 * Normalizes an arbitrary header string (removes accents, non-alphanumeric chars, lowercases).
 */
export function normalizeHeader(header: string): string {
  return String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Converts various date formats (DD/MM/YYYY, ISO, Excel serial number, JS Date) to ISO YYYY-MM-DD.
 */
export function parseExcelDate(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;

  // If already a JS Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If numeric (Excel serial date number)
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

  // Format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // Format: DD/MM/YYYY or DD/MM/YY
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

  // Attempt generic JS Date parse
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1980 && parsed.getFullYear() < 2100) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Scores a candidate header row based on presence of key standard columns.
 */
export function scoreHeaderRow(row: any[]): number {
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
}

/**
 * Finds the most likely header row index and normalized keys in a 2D sheet grid.
 */
export function findBestHeaderRow(grid: any[][]): { headerIdx: number; headerKeys: string[]; score: number } {
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
  const headerKeys = headerRow.map((cell: any) => normalizeHeader(cell));

  return { headerIdx: bestIdx, headerKeys, score: bestScore };
}

/**
 * Maps arbitrary row object from Excel to standard AnalyzerExcelRow.
 */
export function mapRowToAnalyzer(rowObj: Record<string, any>, rowIndex: number): AnalyzerExcelRow | null {
  const normalizedKeys: Record<string, any> = {};
  for (const [key, val] of Object.entries(rowObj)) {
    normalizedKeys[normalizeHeader(key)] = val;
  }

  // Helper to find value from possible key aliases
  const findValue = (...aliases: string[]) => {
    for (const alias of aliases) {
      if (normalizedKeys[alias] !== undefined && normalizedKeys[alias] !== null && String(normalizedKeys[alias]).trim() !== '') {
        return normalizedKeys[alias];
      }
    }
    // Also check partial match
    for (const [key, val] of Object.entries(normalizedKeys)) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        for (const alias of aliases) {
          if (key.includes(alias)) return val;
        }
      }
    }
    return undefined;
  };

  const rawAssetTag = findValue('pat', 'patrimonio', 'asset_tag', 'tag', 'novo_pat', 'codigo', 'cod_patrimonio', 'num_patrimonio', 'id_patrimonio');
  if (!rawAssetTag || String(rawAssetTag).trim() === '-' || String(rawAssetTag).trim() === '') return null;

  let assetTag = String(rawAssetTag).trim().toUpperCase();
  // Standardize purely numeric asset tags (e.g. 378 -> 000378)
  if (/^\d+$/.test(assetTag) && assetTag.length < 6) {
    assetTag = assetTag.padStart(6, '0');
  }

  const rawName = findValue('descricao_marca', 'descricao', 'nome', 'analisador', 'nome_analisador', 'equipamento', 'padrao', 'instrumento') || `Analisador ${assetTag}`;
  const nameStr = String(rawName).trim();

  // In PAT03, "Descrição / Marca" can be split to infer type if type column isn't present
  let inferredType = 'Padrão Geral';
  if (nameStr.includes('/')) {
    const prefix = nameStr.split('/')[0].trim();
    if (prefix) inferredType = prefix;
  }

  const rawType = findValue('tipo', 'tipo_de_padrao', 'tipo_analisador', 'categoria', 'tipo_equipamento') || inferredType;
  const rawSerial = findValue('no_serie', 'numero_de_serie', 'n_de_serie', 'serie', 'serial', 'serial_number', 'n_serie', 'sn') || assetTag;
  const rawModel = findValue('modelo', 'marca_modelo', 'modelo_marca', 'marca', 'brand_model', 'fabricante') || nameStr;
  const rawStatus = findValue('status', 'situacao', 'estado');
  const rawLocation = findValue('localizacao', 'local', 'almoxarifado', 'current_location') || 'Matriz';

  const rawCalibDate = findValue('data_calibracao', 'data_verificacao', 'data_de_calibracao', 'calibracao', 'calibrado_em', 'calibration_date', 'dt_calibracao', 'ultima_calibracao');
  const rawExpiryDate = findValue('proxima_calibracao', 'proxima_verificacao', 'validade_da_calibracao', 'validade_calibracao', 'validade', 'vencimento', 'calibration_expiry', 'calibration_due', 'dt_validade', 'vencimento_calibracao');

  const calibDate = parseExcelDate(rawCalibDate);
  const expiryDate = parseExcelDate(rawExpiryDate);

  const cert = findValue('no_certificado', 'certificado', 'cert');
  const executor = findValue('executor', 'responsavel');
  const approver = findValue('aprovado_por', 'aprovador');
  const periodicity = findValue('periodicidade', 'periodo');
  const existingNotes = findValue('observacoes', 'observacao', 'notas', 'notes', 'comentarios');

  // Compose clean, descriptive metadata notes
  const noteParts: string[] = [];
  if (existingNotes) noteParts.push(String(existingNotes).trim());
  if (cert) noteParts.push(`Certificado: ${cert}`);
  if (executor) noteParts.push(`Executor: ${executor}`);
  if (approver) noteParts.push(`Aprovado por: ${approver}`);
  if (periodicity) noteParts.push(`Periodicidade: ${periodicity} ano(s)`);

  let status = 'Disponível';
  if (rawStatus) {
    const s = String(rawStatus).trim().toLowerCase();
    if (s.includes('uso') || s.includes('campo')) status = 'Em Uso';
    else if (s.includes('reser')) status = 'Reservado';
    else if (s.includes('manuten') || s.includes('quebr') || s.includes('defeito')) status = 'Em Manutenção';
    else status = 'Disponível';
  }

  return {
    asset_tag: assetTag,
    name: nameStr,
    type: String(rawType).trim(),
    serial_number: String(rawSerial).trim(),
    brand_model: String(rawModel).trim(),
    status,
    calibration_date: calibDate,
    calibration_expiry: expiryDate,
    current_location: String(rawLocation).trim() || 'Matriz',
    notes: noteParts.join(' | '),
    rawRowIndex: rowIndex
  };
}

/**
 * Parses an Excel or CSV buffer into an array of AnalyzerExcelRow items.
 * Intelligently scores sheets and header rows so files with top title rows
 * (like PAT03-F1 - Controle de Calibração.xls) parse accurately.
 */
export function parseAnalyzersExcelBuffer(buffer: Buffer, preferredSheetName?: string): AnalyzerExcelRow[] {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('O arquivo de planilha está vazio ou inválido.');
  }
  if (buffer.length > MAX_EXCEL_FILE_BYTES) {
    throw new Error(`A planilha excede o limite de ${Math.floor(MAX_EXCEL_FILE_BYTES / (1024 * 1024))} MB.`);
  }

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    // Stop parsing after the supported row budget. This is enforced again
    // when converting sheets to arrays, but prevents unnecessary work here.
    sheetRows: MAX_EXCEL_ROWS + 1
  });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) return [];
  if (workbook.SheetNames.length > MAX_EXCEL_SHEETS) {
    throw new Error(`A planilha excede o limite de ${MAX_EXCEL_SHEETS} abas.`);
  }

  // Determine target sheet: use preferredSheetName if valid, or pick sheet with highest header score
  let targetSheetName = preferredSheetName && workbook.Sheets[preferredSheetName] ? preferredSheetName : '';

  if (!targetSheetName) {
    let highestScore = -1;
    for (const sName of workbook.SheetNames) {
      const ws = workbook.Sheets[sName];
      const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
      const { score } = findBestHeaderRow(grid);
      if (score > highestScore) {
        highestScore = score;
        targetSheetName = sName;
      }
    }
  }

  if (!targetSheetName) targetSheetName = workbook.SheetNames[0];

  const worksheet = workbook.Sheets[targetSheetName];
  if (!worksheet) return [];

  const grid = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: '' });
  if (!grid || grid.length === 0) return [];

  const { headerIdx, headerKeys } = findBestHeaderRow(grid);
  const result: AnalyzerExcelRow[] = [];

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.every(c => c === '' || c === null || c === undefined)) continue;

    const rowObj: Record<string, any> = {};
    headerKeys.forEach((key, colIdx) => {
      if (key) {
        rowObj[key] = row[colIdx];
      } else {
        rowObj[`__col_${colIdx}`] = row[colIdx];
      }
    });

    const mapped = mapRowToAnalyzer(rowObj, r + 1);
    if (mapped) result.push(mapped);
  }

  return result;
}

/**
 * Generates an Excel template Buffer with standard headers and sample rows.
 */
export function generateAnalyzersExcelTemplate(): Buffer {
  const sampleData = [
    {
      'Patrimônio': 'PAT-004658',
      'Nome do Analisador': 'Analisador de Segurança Elétrica Rigel 288+',
      'Tipo': 'Analisador de Segurança Elétrica',
      'Nº de Série': 'SN-RG-4421',
      'Marca / Modelo': 'Rigel Medical 288+',
      'Data de Calibração': '15/01/2026',
      'Validade da Calibração': '15/01/2027',
      'Status': 'Disponível',
      'Localização': 'Almoxarifado Central',
      'Observações': 'Calibração anual RBC realizada'
    },
    {
      'Patrimônio': 'PAT-004659',
      'Nome do Analisador': 'Simulador de Paciente ProSim 8',
      'Tipo': 'Simulador de ECG e SPO2',
      'Nº de Série': 'SN-PS-8890',
      'Marca / Modelo': 'Fluke Biomedical ProSim 8',
      'Data de Calibração': '20/02/2026',
      'Validade da Calibração': '20/02/2027',
      'Status': 'Disponível',
      'Localização': 'Almoxarifado Central',
      'Observações': 'Certificado nº 2026/0498'
    },
    {
      'Patrimônio': 'PAT-004660',
      'Nome do Analisador': 'Analisador de Desfibrilador Impulse 7000DP',
      'Tipo': 'Analisador de Desfibrilador',
      'Nº de Série': 'SN-IMP-7102',
      'Marca / Modelo': 'Fluke Biomedical Impulse 7000DP',
      'Data de Calibração': '10/03/2026',
      'Validade da Calibração': '10/03/2027',
      'Status': 'Disponível',
      'Localização': 'Almoxarifado Central',
      'Observações': 'Com carga de 50 ohms calibrada'
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);

  // Set column widths for readability
  worksheet['!cols'] = [
    { wch: 16 }, // Patrimônio
    { wch: 45 }, // Nome
    { wch: 32 }, // Tipo
    { wch: 18 }, // Nº de Série
    { wch: 32 }, // Marca / Modelo
    { wch: 20 }, // Data Calibração
    { wch: 22 }, // Validade Calibração
    { wch: 14 }, // Status
    { wch: 24 }, // Localização
    { wch: 35 }  // Observações
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Padrões e Analisadores');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
