import fs from 'fs';
import path from 'path';

export interface OfficialTechnician {
  id: number;
  name: string;
  phone?: string;
  telegram_id?: string;
  email?: string;
  role?: string;
  avatar_url?: string;
  status?: string;
  created_at?: string;
}

// Map of common nicknames, variations, abbreviations and typo keys to the exact canonical name
const ALIAS_MAP: Record<string, string> = {
  // Leo / Leonardo
  'leo': 'Leo Santos',
  'leosantos': 'Leo Santos',
  'leonardosantos': 'Leo Santos',
  'leonardoomestre': 'Leonardo Mestre',
  'leonardomestre': 'Leonardo Mestre',
  'mestre': 'Leonardo Mestre',
  'leonardohenrique': 'Leonardo Henrique',
  'leohenrique': 'Leonardo Henrique',

  // Gabriel
  'gabriel': 'Gabriel Patrick',
  'gabrielp': 'Gabriel Patrick',
  'gabrielpatrick': 'Gabriel Patrick',
  'gabrielpatrik': 'Gabriel Patrick',
  'gabrielii': 'Gabriel Patrick',
  'gabriel2': 'Gabriel Patrick',
  'gp': 'Gabriel Patrick',
  'soares': 'Gabriel Soares',
  'gabrielsoares': 'Gabriel Soares',
  'gsoares': 'Gabriel Soares',
  'gabrielconrado': 'Gabriel Conrado',
  'conrado': 'Gabriel Conrado',
  'gconrado': 'Gabriel Conrado',
  'patrick': 'Patrick',

  // Lucas
  'lucas': 'Lucas Almeida',
  'lucasalmeida': 'Lucas Almeida',
  'almeida': 'Lucas Almeida',
  'lucasatyla': 'Lucas Atyla',
  'atyla': 'Lucas Atyla',
  'lucasattila': 'Lucas Atyla',
  'attila': 'Lucas Atyla',

  // Pedro
  'pedro': 'Pedro',
  'pedroalbuquerque': 'Pedro Albuquerque',
  'albuquerque': 'Pedro Albuquerque',
  'pedroalb': 'Pedro Albuquerque',

  // Common typo & variation normalizations
  'eder': 'Éder',
  'edertecnico': 'Éder',
  'fabio': 'Fábio',
  'fabiocirurgico': 'Fábio',
  'helio': 'Hélio',
  'nadia': 'Nádia',
  'isack': 'Isaack',
  'isaac': 'Isaack',
  'isaack': 'Isaack',
  'juliocardoso': 'Júlio Cardoso',
  'julio': 'Júlio Cardoso',
  'mateus': 'Mateus',
  'matheus': 'Mateus',
  'vitor': 'Vittor',
  'victor': 'Vittor',
  'vittor': 'Vittor',
  'diogenes': 'Diógenes',
  'heberly': 'Heberly',
  'heberli': 'Heberly',
  'eberly': 'Heberly',
  'kazis': 'Kazys',
  'kazys': 'Kazys',
  'edmilson': 'Edmilson',
  'edimilson': 'Edmilson',
  'edvan': 'Edvan',
  'edval': 'Edvan',
  'barbara': 'Bárbara',

  // Groups and Teams
  'todos': 'Todos',
  'equipe': 'Equipe externa',
  'equipeexterna': 'Equipe externa',
  'terceiros': 'Equipe externa',
  'terceirizados': 'Equipe externa',
  'terceirizado': 'Equipe externa',
  'externo': 'Equipe externa',
  'equipedecampo': 'Equipe externa',
  'btu': 'BTU',
  'b.t.u': 'BTU',
  'b.t.u.': 'BTU'
};

export function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function cleanDisplayName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates the Levenshtein distance between two normalized strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Returns a similarity score between 0.0 and 1.0 based on Levenshtein and token overlap.
 */
export function calculateSimilarity(input: string, candidate: string): number {
  const normInput = normalizeKey(input);
  const normCandidate = normalizeKey(candidate);

  if (normInput === normCandidate) return 1.0;
  if (!normInput || !normCandidate) return 0.0;

  // Substring match
  if (normCandidate.startsWith(normInput) || normInput.startsWith(normCandidate)) {
    const ratio = Math.min(normInput.length, normCandidate.length) / Math.max(normInput.length, normCandidate.length);
    return Math.max(0.85, ratio);
  }

  const distance = levenshteinDistance(normInput, normCandidate);
  const maxLength = Math.max(normInput.length, normCandidate.length);
  return 1.0 - (distance / maxLength);
}

/**
 * Loads the official technicians from the CSV file.
 */
export function loadOfficialTechniciansFromCsv(customPath?: string): OfficialTechnician[] {
  const csvPath = customPath || path.resolve(__dirname, '../../data/technicians_official.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`[TechnicianMatcher] Arquivo CSV oficial não encontrado em: ${csvPath}`);
    return [];
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const idIdx = headers.indexOf('id');
  const nameIdx = headers.indexOf('name');
  const phoneIdx = headers.indexOf('phone');
  const telegramIdx = headers.indexOf('telegram_id');
  const emailIdx = headers.indexOf('email');
  const roleIdx = headers.indexOf('role');
  const avatarIdx = headers.indexOf('avatar_url');
  const statusIdx = headers.indexOf('status');
  const createdIdx = headers.indexOf('created_at');

  const result: OfficialTechnician[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Basic CSV splitting taking quotes into account if present
    const row = parseCsvRow(lines[i]);
    if (!row || row.length < 2) continue;

    const id = parseInt(row[idIdx] || `${i}`, 10);
    const name = row[nameIdx]?.trim();
    if (!name || isNaN(id)) continue;

    result.push({
      id,
      name,
      phone: row[phoneIdx]?.trim() || '',
      telegram_id: row[telegramIdx]?.trim() || '',
      email: row[emailIdx]?.trim() || '',
      role: row[roleIdx]?.trim() || 'Técnico de Campo',
      avatar_url: row[avatarIdx]?.trim() || '',
      status: row[statusIdx]?.trim() || 'Ativo',
      created_at: row[createdIdx]?.trim() || new Date().toISOString()
    });
  }

  return result;
}

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Finds the single best official technician matching a raw technician name.
 * Uses exact match -> alias map -> fuzzy similarity (threshold >= 0.78).
 */
export function matchSingleTechnician(
  rawName: string,
  officialList: OfficialTechnician[]
): OfficialTechnician | null {
  const clean = rawName.trim();
  if (!clean) return null;

  const norm = normalizeKey(clean);
  if (!norm) return null;

  // 1. Direct normalized exact match
  const directMatch = officialList.find(t => normalizeKey(t.name) === norm);
  if (directMatch) return directMatch;

  // 2. Alias dictionary lookup
  const aliasTargetName = ALIAS_MAP[norm];
  if (aliasTargetName) {
    const aliasMatch = officialList.find(t => normalizeKey(t.name) === normalizeKey(aliasTargetName));
    if (aliasMatch) return aliasMatch;
  }

  // 3. Substring / Token match (e.g. "Gabriel Soares" matches "Gabriel Soares")
  const words = cleanDisplayName(clean).split(' ').filter(w => w.length >= 3);
  for (const word of words) {
    const wordAlias = ALIAS_MAP[normalizeKey(word)];
    if (wordAlias) {
      const match = officialList.find(t => normalizeKey(t.name) === normalizeKey(wordAlias));
      if (match) return match;
    }
  }

  // 4. Fuzzy Levenshtein match with high confidence (>= 0.78)
  let bestScore = 0;
  let bestTechnician: OfficialTechnician | null = null;

  for (const tech of officialList) {
    const score = calculateSimilarity(clean, tech.name);
    if (score > bestScore) {
      bestScore = score;
      bestTechnician = tech;
    }
  }

  if (bestScore >= 0.78 && bestTechnician) {
    return bestTechnician;
  }

  return null;
}

/**
 * Parses multiple technician names from calendar text (e.g. "Mauro / Mateus", "Patrick e Gabriel")
 * and resolves each to an official technician record.
 */
export function parseAndMatchTechnicians(
  rawText: string,
  officialList: OfficialTechnician[]
): { matched: OfficialTechnician[]; unparsed: string[] } {
  if (!rawText || typeof rawText !== 'string') {
    return { matched: [], unparsed: [] };
  }

  // Split by common delimiters: comma, semicolon, " e ", " / ", " & ", line breaks
  const tokens = rawText
    .split(/[,;\n\r]|(?:\s+(?:e|&|\/)\s+)|\s*\/\s*/i)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !t.startsWith('http') && !t.includes('@'));

  const matchedSet = new Map<number, OfficialTechnician>();
  const unparsed: string[] = [];

  for (const token of tokens) {
    const matched = matchSingleTechnician(token, officialList);
    if (matched) {
      matchedSet.set(matched.id, matched);
    } else {
      unparsed.push(token);
    }
  }

  return {
    matched: Array.from(matchedSet.values()),
    unparsed
  };
}
