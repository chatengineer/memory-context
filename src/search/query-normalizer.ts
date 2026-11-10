// src/search/query-normalizer.ts
// Query normalization and lightweight entity expansion for long-horizon memory retrieval.

import { Metadata } from '../types';

export interface QueryExpansionSource {
  id: string;
  content: string;
  metadata?: Metadata;
}

export interface NormalizedQuery {
  original: string;
  normalized: string;
  expanded: string;
  expansions: string[];
}

const MONTHS: Record<string, string[]> = {
  jan: ['january', '01', '1'], january: ['jan', '01', '1'],
  feb: ['february', '02', '2'], february: ['feb', '02', '2'],
  mar: ['march', '03', '3'], march: ['mar', '03', '3'],
  apr: ['april', '04', '4'], april: ['apr', '04', '4'],
  may: ['05', '5'],
  jun: ['june', '06', '6'], june: ['jun', '06', '6'],
  jul: ['july', '07', '7'], july: ['jul', '07', '7'],
  aug: ['august', '08', '8'], august: ['aug', '08', '8'],
  sep: ['september', '09', '9'], sept: ['september', '09', '9'], september: ['sep', 'sept', '09', '9'],
  oct: ['october', '10'], october: ['oct', '10'],
  nov: ['november', '11'], november: ['nov', '11'],
  dec: ['december', '12'], december: ['dec', '12']
};

const PARTICIPANT_ALIASES: Record<string, string[]> = {
  i: ['me', 'my', 'user', 'human'],
  me: ['i', 'my', 'user', 'human'],
  my: ['me', 'i', 'user'],
  you: ['assistant', 'agent', 'chatengineer'],
  assistant: ['you', 'agent', 'chatengineer'],
  agent: ['assistant', 'you', 'chatengineer'],
  chatengineer: ['chat engineer', 'assistant', 'agent']
};

export class QueryNormalizer {
  normalize(query: string, sources: QueryExpansionSource[] = []): NormalizedQuery {
    const original = query || '';
    const normalized = this.normalizeText(original);
    const expansions = new Set<string>();

    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      for (const expansion of MONTHS[token] || []) expansions.add(expansion);
      for (const expansion of PARTICIPANT_ALIASES[token] || []) expansions.add(expansion);
    }

    for (const dateExpansion of this.expandDates(normalized)) expansions.add(dateExpansion);
    for (const entityExpansion of this.expandEntities(original, sources)) expansions.add(entityExpansion);

    const expansionList = Array.from(expansions)
      .map(item => item.trim().toLowerCase())
      .filter(item => item && !normalized.includes(item))
      .slice(0, 24);

    return {
      original,
      normalized,
      expanded: [normalized, ...expansionList].join(' ').trim(),
      expansions: expansionList
    };
  }

  private normalizeText(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9\s_+#$./-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private expandDates(text: string): string[] {
    const expansions: string[] = [];
    const isoDates = text.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || [];
    for (const date of isoDates) {
      const [year, month, day] = date.split('-');
      expansions.push(`${Number(month)}/${Number(day)}/${year}`);
      expansions.push(`${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`);
    }
    // Also expand YYYY-MM format
    const yearMonth = text.match(/\b\d{4}-\d{1,2}\b/g) || [];
    for (const ym of yearMonth) {
      if (!isoDates.includes(ym)) {
        const [year, month] = ym.split('-');
        const monthNames = ['', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const m = monthNames[Number(month)];
        if (m) expansions.push(m);
        expansions.push(`${year}-${month.padStart(2, '0')}`);
      }
    }
    return expansions;
  }

  private expandEntities(query: string, sources: QueryExpansionSource[]): string[] {
    const expansions = new Set<string>();
    const queryEntities = this.extractCapitalizedPhrases(query);
    if (queryEntities.length === 0) return [];

    for (const entity of queryEntities) {
      const parts = entity.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        expansions.add(parts[0]);
        expansions.add(parts[parts.length - 1]);
        expansions.add(parts.map(part => part[0]).join(''));
      }

      const lowerEntity = entity.toLowerCase();
      for (const source of sources.slice(0, 1000)) {
        const haystack = `${source.content} ${Object.values(source.metadata || {}).join(' ')}`;
        if (!haystack.toLowerCase().includes(lowerEntity)) continue;
        for (const phrase of this.extractCapitalizedPhrases(haystack)) {
          if (phrase.toLowerCase().includes(lowerEntity) || lowerEntity.includes(phrase.toLowerCase())) {
            expansions.add(phrase);
          }
        }
      }
    }

    return Array.from(expansions).slice(0, 16);
  }

  private extractCapitalizedPhrases(text: string): string[] {
    return Array.from(text.matchAll(/\b[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,3}\b/g))
      .map(match => match[0].trim())
      .filter(phrase => phrase.length > 1);
  }
}