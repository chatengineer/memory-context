/**
 * Advanced Relevance Scoring System
 *
 * High Priority Issue #7: Advanced Relevance Scoring
 *
 * Multi-factor relevance scoring combining:
 * - BM25 keyword relevance
 * - Recency decay
 * - Context window overlap
 * - Semantic density
 * - Priority keyword boost
 * - Custom metadata weighting
 */

import { BM25Index } from '../search/bm25-index';
import { Metadata } from '../types';

export interface RelevanceConfig {
  // Weight factors (should sum to ~1.0)
  keywordWeight: number;
  recencyWeight: number;
  priorityWeight: number;
  densityWeight: number;
  overlapWeight: number;
  queryCoverageWeight: number;
  exactPhraseWeight: number;

  // Time decay settings
  halfLife: number;
  maxAge: number;

  // Priority keywords (always boosted)
  priorityKeywords: Set<string>;

  // Metadata weight multipliers
  metadataWeights: Record<string, number>;
}

const DEFAULT_CONFIG: RelevanceConfig = {
  keywordWeight: 0.3,
  recencyWeight: 0.2,
  priorityWeight: 0.15,
  densityWeight: 0.08,
  overlapWeight: 0.07,
  queryCoverageWeight: 0.12,
  exactPhraseWeight: 0.08,

  halfLife: 24 * 60 * 60 * 1000,
  maxAge: 7 * 24 * 60 * 60 * 1000,

  priorityKeywords: new Set([
    'decision', 'important', 'critical', 'urgent', 'priority',
    'knowledge', 'state', 'anchor', 'context', 'preserve',
    'shift', 'error', 'fix', 'bug', 'issue', 'task', 'goal',
    'remember', 'note', 'key', 'essential', 'required'
  ]),

  metadataWeights: {
    pinned: 2.0,
    bookmarked: 1.5,
    referenced: 1.3,
    edited: 1.2
  }
};

export interface ScoringContext {
  query?: string;
  currentContext?: string[];
  referenceTime?: number;
  bm25Index?: BM25Index;
  _keywordScore?: number;
}

export interface RelevanceResult {
  score: number;
  factors: {
    keyword: number;
    recency: number;
    priority: number;
    density: number;
    overlap: number;
    queryCoverage: number;
    exactPhrase: number;
  };
  explanation: string;
}

export class AdvancedRelevanceScorer {
  private config: RelevanceConfig;
  private bm25Index: BM25Index;
  private adaptationStats = {
    updates: 0,
    lastAdjustmentAt: 0,
    learningRate: 0.05,
  };

  constructor(config?: Partial<RelevanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bm25Index = new BM25Index();
    this.normalizeWeights();
  }

  computeScore(content: string, metadata?: Metadata, context?: ScoringContext): RelevanceResult {
    const factors = {
      keyword: this.computeKeywordScore(content, context),
      recency: this.computeRecencyScore(metadata?.timestamp, context?.referenceTime),
      priority: this.computePriorityScore(content),
      density: this.computeDensityScore(content),
      overlap: this.computeOverlapScore(content, context?.currentContext),
      queryCoverage: this.computeQueryCoverageScore(content, context?.query),
      exactPhrase: this.computeExactPhraseScore(content, context?.query)
    };

    let metadataMultiplier = 1.0;
    if (metadata) {
      for (const [key, weight] of Object.entries(this.config.metadataWeights)) {
        if (metadata[key]) metadataMultiplier *= weight;
      }
    }

    const weightedScore =
      factors.keyword * this.config.keywordWeight +
      factors.recency * this.config.recencyWeight +
      factors.priority * this.config.priorityWeight +
      factors.density * this.config.densityWeight +
      factors.overlap * this.config.overlapWeight +
      factors.queryCoverage * this.config.queryCoverageWeight +
      factors.exactPhrase * this.config.exactPhraseWeight;

    const finalScore = weightedScore * metadataMultiplier;

    return {
      score: finalScore,
      factors,
      explanation: this.generateExplanation(factors, metadataMultiplier)
    };
  }

  private computeKeywordScore(content: string, context?: ScoringContext): number {
    if (context?._keywordScore !== undefined) {
      return Math.min(context._keywordScore / 10, 1.0);
    }

    if (!context?.query) {
      const terms = content.toLowerCase().split(/\s+/);
      const uniqueTerms = new Set(terms);
      return Math.min(uniqueTerms.size / 100, 1.0);
    }

    const results = this.bm25Index.scoreStandalone(content, context.query);
    return Math.min(results.score / 10, 1.0);
  }

  computeBatchScores(
    candidates: { content: string; metadata?: Metadata }[],
    context: ScoringContext
  ): number[] {
    if (!context.query || !context.bm25Index) {
      return candidates.map(c => this.computeScore(c.content, c.metadata, context).score);
    }

    const searchResults = context.bm25Index.search(context.query, candidates.length * 2);
    const scoreMap = new Map<string, number>();
    for (const res of searchResults) {
      scoreMap.set(res.id, res.score);
    }

    return candidates.map(c => {
      if (c.metadata?.id && scoreMap.has(c.metadata.id)) {
        return this.computeScore(c.content, c.metadata, {
          ...context,
          _keywordScore: scoreMap.get(c.metadata.id)
        }).score;
      }
      return this.computeScore(c.content, c.metadata, context).score;
    });
  }

  private computeRecencyScore(timestamp?: number, referenceTime?: number): number {
    if (!timestamp) return 0.5;
    const now = referenceTime || Date.now();
    const age = now - timestamp;
    if (age > this.config.maxAge) return 0;
    return Math.pow(0.5, age / this.config.halfLife);
  }

  private computePriorityScore(content: string): number {
    if (!content) return 0;
    const lower = content.toLowerCase();
    let matches = 0;
    for (const keyword of this.config.priorityKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      matches += (lower.match(regex) || []).length;
    }
    return Math.min(matches * 0.1, 1.0);
  }

  private computeDensityScore(content: string): number {
    if (!content) return 0;
    const tokens = content.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;

    const uniqueTokens = new Set(tokens.map(t => t.toLowerCase()));
    const uniqueRatio = uniqueTokens.size / tokens.length;
    const avgLength = tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length;
    const lengthScore = Math.min(avgLength / 8, 1.0);
    const punctCount = (content.match(/[.!?,;:]/g) || []).length;
    const punctScore = Math.min(punctCount / tokens.length / 0.1, 1.0);
    return uniqueRatio * 0.5 + lengthScore * 0.3 + punctScore * 0.2;
  }

  private computeQueryCoverageScore(content: string, query?: string): number {
    if (!query?.trim()) return 0;
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 1);
    if (queryTerms.length === 0) return 0;
    const contentLower = content.toLowerCase();
    const matched = queryTerms.filter(term => contentLower.includes(term));
    return matched.length / queryTerms.length;
  }

  private computeExactPhraseScore(content: string, query?: string): number {
    if (!query?.trim()) return 0;
    const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, ' ');
    const normalizedContent = content.toLowerCase().replace(/\s+/g, ' ');
    if (normalizedContent.includes(normalizedQuery)) return 1;
    const queryBigrams = this.buildNGrams(normalizedQuery, 2);
    if (queryBigrams.length === 0) return 0;
    const contentBigrams = new Set(this.buildNGrams(normalizedContent, 2));
    const overlap = queryBigrams.filter(gram => contentBigrams.has(gram)).length;
    return overlap / queryBigrams.length;
  }

  private buildNGrams(text: string, n: number): string[] {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < n) return tokens.length ? [tokens.join(' ')] : [];
    const grams: string[] = [];
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join(' '));
    }
    return grams;
  }

  private computeOverlapScore(content: string, currentContext?: string[]): number {
    if (!currentContext || currentContext.length === 0) return 0;
    const contentTerms = new Set(content.toLowerCase().split(/\s+/));
    let totalOverlap = 0;

    for (const ctxItem of currentContext) {
      const ctxTerms = new Set(ctxItem.toLowerCase().split(/\s+/));
      let overlap = 0;
      for (const term of contentTerms) {
        if (ctxTerms.has(term)) overlap++;
      }
      const union = new Set([...contentTerms, ...ctxTerms]);
      totalOverlap += overlap / union.size;
    }

    return totalOverlap / currentContext.length;
  }

  private generateExplanation(factors: RelevanceResult['factors'], metadataMultiplier: number): string {
    const parts: string[] = [];
    if (factors.keyword > 0.5) parts.push('high keyword relevance');
    if (factors.queryCoverage > 0.8) parts.push('strong query coverage');
    if (factors.exactPhrase > 0.8) parts.push('exact phrase match');
    if (factors.recency > 0.7) parts.push('recent');
    if (factors.priority > 0.3) parts.push('contains priority terms');
    if (factors.density > 0.6) parts.push('information-dense');
    if (factors.overlap > 0.3) parts.push('context overlap');
    if (metadataMultiplier > 1.0) parts.push(`metadata boost (${metadataMultiplier.toFixed(1)}x)`);
    return parts.length > 0 ? parts.join(', ') : 'standard relevance';
  }

  recordSelectionOutcome(result: RelevanceResult, positive: boolean = true): void {
    const direction = positive ? 1 : -1;
    const lr = this.adaptationStats.learningRate;
    const weightMap: Array<[keyof RelevanceConfig, number]> = [
      ['keywordWeight', result.factors.keyword],
      ['recencyWeight', result.factors.recency],
      ['priorityWeight', result.factors.priority],
      ['densityWeight', result.factors.density],
      ['overlapWeight', result.factors.overlap],
      ['queryCoverageWeight', result.factors.queryCoverage],
      ['exactPhraseWeight', result.factors.exactPhrase],
    ];

    for (const [key, factor] of weightMap) {
      const current = this.config[key] as number;
      const nudged = Math.max(0.01, current + direction * lr * (factor - 0.5) * 0.1);
      (this.config as any)[key] = nudged;
    }

    this.normalizeWeights();
    this.adaptationStats.updates += 1;
    this.adaptationStats.lastAdjustmentAt = Date.now();
  }

  getAdaptiveStats(): { updates: number; lastAdjustmentAt: number; learningRate: number; weights: RelevanceConfig } {
    return {
      updates: this.adaptationStats.updates,
      lastAdjustmentAt: this.adaptationStats.lastAdjustmentAt,
      learningRate: this.adaptationStats.learningRate,
      weights: this.getConfig()
    };
  }

  updateConfig(newConfig: Partial<RelevanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.normalizeWeights();
  }

  getConfig(): RelevanceConfig {
    return { ...this.config };
  }

  private normalizeWeights(): void {
    const keys: Array<keyof RelevanceConfig> = [
      'keywordWeight',
      'recencyWeight',
      'priorityWeight',
      'densityWeight',
      'overlapWeight',
      'queryCoverageWeight',
      'exactPhraseWeight'
    ];

    const total = keys.reduce((sum, key) => sum + (this.config[key] as number), 0);
    if (total <= 0) return;
    for (const key of keys) {
      (this.config as any)[key] = (this.config[key] as number) / total;
    }
  }
}

export const advancedRelevanceScorer = new AdvancedRelevanceScorer();

export function computeRelevanceScore(content: string, metadata?: Metadata, context?: ScoringContext): number {
  return advancedRelevanceScorer.computeScore(content, metadata, context).score;
}
