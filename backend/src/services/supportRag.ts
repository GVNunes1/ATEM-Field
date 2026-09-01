import fs from 'fs';
import path from 'path';

export interface SupportSource {
  id: string;
  title: string;
  section?: string;
  kind: 'faq' | 'catalog';
}

export interface SupportMatch {
  score: number;
  question: string;
  answer: string;
  spokenSummary: string;
  source: SupportSource;
  keywords: string[];
}

interface SupportFaqEntry {
  id: string;
  question: string;
  answer: string;
  spokenSummary?: string;
  keywords: string[];
  source: SupportSource;
}

const FAQ_PATH = path.resolve(__dirname, '../../data/support-faq.json');

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter(token => token.length >= 3 && !['como', 'para', 'uma', 'que', 'dos', 'das', 'por', 'com', 'sem', 'tem'].includes(token));
}

function loadFaq(): SupportFaqEntry[] {
  try {
    const raw = fs.readFileSync(FAQ_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SupportFaqEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[support] Não foi possível carregar a FAQ curada:', error);
    return [];
  }
}

const faqEntries = loadFaq();

export function findSupportMatches(question: string, limit = 3): SupportMatch[] {
  const questionTokens = new Set(tokenize(question));
  if (!questionTokens.size) return [];

  return faqEntries
    .map(entry => {
      const entryTokens = new Set([
        ...tokenize(entry.question),
        ...entry.keywords.flatMap(tokenize)
      ]);
      const overlap = [...questionTokens].filter(token => entryTokens.has(token));
      const score = overlap.length / Math.max(3, questionTokens.size);
      return {
        score,
        question: entry.question,
        answer: entry.answer,
        spokenSummary: entry.spokenSummary || entry.answer,
        source: entry.source,
        keywords: overlap
      };
    })
    .filter(match => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function getBestSupportMatch(question: string): SupportMatch | null {
  const [best] = findSupportMatches(question, 1);
  return best && best.score >= 0.2 ? best : null;
}

export function buildSupportContext(matches: SupportMatch[]): string {
  return matches
    .map(match => `Fonte: ${match.source.title}${match.source.section ? ` · ${match.source.section}` : ''}\nPergunta relacionada: ${match.question}\nConteúdo aprovado: ${match.answer}`)
    .join('\n\n');
}
