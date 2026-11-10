import { Metadata } from '../types';
import { BM25Index } from '../search/bm25-index';

export interface ScoringContext {
  referenceTime?: number;
  query?: string;
  bm25Index?: BM25Index;
  adaptiveRecency?: {
    halfLife: number;
    maxAge: number;
  };
}

export interface AdvancedRelevanceConfig {
  weights: {
    recency: number;
    frequency: number;
    semantic: number;
    density: number;
    overlap: number;
  };
  halfLife: number;
  maxAge: number;
}

const DEFAULT_CONFIG: AdvancedRelevanceConfig = {
  weights: {
    recency: 0.35,
    frequency: 0.25,
    semantic: 0.25,
    density: 0.10,
    overlap: 0.05,
  },
  halfLife: 7 * 24 * 60 * 60 * 1000,
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export class AdvancedRelevanceScorer {
  private config: AdvancedRelevanceConfig;

  constructor(config: Partial<AdvancedRelevanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  computeScore(
    content: string,
    metadata?: Metadata,
    context?: ScoringContext
  ): number {
    const w = this.config.weights;
    const recency = this.computeRecencyScore(metadata?.timestamp, context?.referenceTime, context?.adaptiveRecency);
    const frequency = this.computeFrequencyScore(content, metadata);
    const semantic = this.computeSemanticScore(content, context?.query, context?.bm25Index);
    const density = this.computeDensityScore(content);
    const overlap = this.computeOverlapScore(content, context?.query);

    return (
      w.recency * recency +
      w.frequency * frequency +
      w.semantic * semantic +
      w.density * density +
      w.overlap * overlap
    );
  }

  private computeRecencyScore(
    timestamp?: number,
    referenceTime?: number,
    adaptive?: ScoringContext['adaptiveRecency']
  ): number {
    if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return 0;
    const ref = referenceTime ?? Date.now();
    const age = ref - timestamp;
    if (age < 0) return 1;

    const halfLife = adaptive?.halfLife ?? this.config.halfLife;
    const maxAge = adaptive?.maxAge ?? this.config.maxAge;

    if (age > maxAge) return 0;

    const decayFactor = Math.pow(0.5, age / halfLife);
    return decayFactor;
  }

  private computeFrequencyScore(content: string, metadata?: Metadata): number {
    const count = metadata?.accessCount ?? 1;
    return Math.min(1, Math.log10(count + 1));
  }

  private computeSemanticScore(
    content: string,
    query?: string,
    bm25Index?: BM25Index
  ): number {
    if (!query || !bm25Index) return 0.5;
    const scores = bm25Index.search(query, 1);
    return scores.length > 0 ? Math.min(1, scores[0].score / 20) : 0;
  }

  private computeDensityScore(content: string): number {
    const tokens = content.split(/\s+/).filter(Boolean);
    const unique = new Set(tokens.map(t => t.toLowerCase())).size;
    return tokens.length > 0 ? unique / tokens.length : 0;
  }

  private computeOverlapScore(content: string, query?: string): number {
    if (!query) return 0;
    const contentTerms = new Set(content.toLowerCase().split(/\s+/).filter(Boolean));
    const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    if (queryTerms.size === 0) return 0;
    let overlap = 0;
    for (const term of queryTerms) {
      if (contentTerms.has(term)) overlap++;
    }
    return overlap / queryTerms.size;
  }
}

export function computeRelevanceScore(
  content: string,
  metadata?: Metadata,
  context?: ScoringContext,
  config?: Partial<AdvancedRelevanceConfig>
): number {
  const scorer = new AdvancedRelevanceScorer(config);
  return scorer.computeScore(content, metadata, context);
}