import * as XLSX from 'xlsx';

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

  const rawAssetTag = findValue('patrimonio', 'asset_tag', 'tag', 'codigo', 'cod_patrimonio', 'num_patrimonio', 'id_patrimonio');
  if (!rawAssetTag) return null;

  const assetTag = String(rawAssetTag).trim().toUpperCase();

  const rawName = findValue('nome', 'analisador', 'nome_analisador', 'descricao', 'equipamento', 'padrao', 'instrumento') || `Analisador ${assetTag}`;
  const rawType = findValue('tipo', 'tipo_de_padrao', 'tipo_analisador', 'categoria', 'tipo_equipamento') || 'Padrão Geral';
  const rawSerial = findValue('numero_de_serie', 'n_de_serie', 'serie', 'serial', 'serial_number', 'n_serie', 'sn') || assetTag;
  const rawModel = findValue('marca_modelo', 'modelo_marca', 'modelo', 'marca', 'brand_model', 'fabricante') || String(rawName);
  const rawStatus = findValue('status', 'situacao', 'estado');
  const rawLocation = findValue('localizacao', 'local', 'almoxarifado', 'current_location') || 'Almoxarifado Central';
  const rawNotes = findValue('observacoes', 'observacao', 'notas', 'notes', 'comentarios');

  const rawCalibDate = findValue('data_de_calibracao', 'data_calibracao', 'calibracao', 'calibrado_em', 'calibration_date', 'dt_calibracao', 'ultima_calibracao');
  const rawExpiryDate = findValue('validade_da_calibracao', 'validade_calibracao', 'validade', 'vencimento', 'proxima_calibracao', 'calibration_expiry', 'calibration_due', 'dt_validade', 'vencimento_calibracao');

  const calibDate = parseExcelDate(rawCalibDate);
  const expiryDate = parseExcelDate(rawExpiryDate);

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
    name: String(rawName).trim(),
    type: String(rawType).trim(),
    serial_number: String(rawSerial).trim(),
    brand_model: String(rawModel).trim(),
    status,
    calibration_date: calibDate,
    calibration_expiry: expiryDate,
    current_location: String(rawLocation).trim(),
    notes: rawNotes ? String(rawNotes).trim() : '',
    rawRowIndex: rowIndex
  };
}

/**
 * Parses an Excel or CSV buffer into an array of AnalyzerExcelRow items.
 */
export function parseAnalyzersExcelBuffer(buffer: Buffer): AnalyzerExcelRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

  const result: AnalyzerExcelRow[] = [];
  rawRows.forEach((row, index) => {
    const mapped = mapRowToAnalyzer(row, index + 2); // 1-based index including header
    if (mapped) result.push(mapped);
  });

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
