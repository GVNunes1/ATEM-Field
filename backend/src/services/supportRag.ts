import fs from 'fs';
import path from 'path';

export interface SupportSource {
  id: string;
  title: string;
  section?: string;
  kind: 'faq' | 'catalog';
}

/**
 * Procedimento operacional curado. Estes campos ficam separados da resposta
 * curta para que o LLM consiga explicar pré-requisitos, passos, validações e
 * resultado sem precisar inferir o fluxo a partir da interface.
 */
export interface SupportProcedure {
  purpose?: string;
  roles?: string;
  prerequisites?: string[];
  steps?: string[];
  validations?: string[];
  result?: string;
  cautions?: string[];
}

export interface SupportMatch {
  score: number;
  question: string;
  answer: string;
  spokenSummary: string;
  source: SupportSource;
  keywords: string[];
  procedure?: SupportProcedure;
}

interface SupportFaqEntry {
  id: string;
  question: string;
  answer: string;
  spokenSummary?: string;
  keywords: string[];
  source: SupportSource;
  procedure?: SupportProcedure;
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
        keywords: overlap,
        procedure: entry.procedure
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

export function renderSupportProcedure(match: SupportMatch): string {
  const procedure = match.procedure;
  if (!procedure) return match.answer;

  const sections = [procedure.purpose || match.answer];
  if (procedure.roles) sections.push(`Quem pode fazer: ${procedure.roles}`);
  if (procedure.prerequisites?.length) sections.push(`Antes de começar:\n${procedure.prerequisites.map(item => `• ${item}`).join('\n')}`);
  if (procedure.steps?.length) sections.push(`Passo a passo:\n${procedure.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  if (procedure.validations?.length) sections.push(`Confira:\n${procedure.validations.map(item => `• ${item}`).join('\n')}`);
  if (procedure.result) sections.push(`Resultado esperado: ${procedure.result}`);
  if (procedure.cautions?.length) sections.push(`Se houver problema ou dúvida:\n${procedure.cautions.map(item => `• ${item}`).join('\n')}`);
  return sections.join('\n\n');
}

export function buildSupportContext(matches: SupportMatch[]): string {
  return matches
    .map(match => {
      const procedure = match.procedure;
      const sections = [
        `Fonte: ${match.source.title}${match.source.section ? ` · ${match.source.section}` : ''}`,
        `Pergunta relacionada: ${match.question}`,
        `Conteúdo aprovado: ${match.answer}`
      ];

      if (!procedure) return sections.join('\n');
      if (procedure.purpose) sections.push(`Objetivo da função: ${procedure.purpose}`);
      if (procedure.roles) sections.push(`Perfil/permissão: ${procedure.roles}`);
      if (procedure.prerequisites?.length) sections.push(`Pré-requisitos: ${procedure.prerequisites.join(' | ')}`);
      if (procedure.steps?.length) {
        sections.push(`Passo a passo:\n${procedure.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
      }
      if (procedure.validations?.length) sections.push(`Validações do sistema: ${procedure.validations.join(' | ')}`);
      if (procedure.result) sections.push(`Resultado esperado: ${procedure.result}`);
      if (procedure.cautions?.length) sections.push(`Cuidados: ${procedure.cautions.join(' | ')}`);
      return sections.join('\n');
    })
    .join('\n\n');
}
