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
  keywordWeight: number;      // BM25 score weight
  recencyWeight: number;      // Time decay weight
  priorityWeight: number;     // Keyword boost weight
  densityWeight: number;      // Semantic density weight
  overlapWeight: number;      // Context overlap weight

  // Time decay settings
  halfLife: number;           // Half-life in milliseconds (default: 24 hours)
  maxAge: number;             // Maximum age before zero relevance (default: 7 days)

  // Priority keywords (always boosted)
  priorityKeywords: Set<string>;

  // Metadata weight multipliers
  metadataWeights: Record<string, number>;
}

const DEFAULT_CONFIG: RelevanceConfig = {
  keywordWeight: 0.35,
  recencyWeight: 0.25,
  priorityWeight: 0.20,
  densityWeight: 0.10,
  overlapWeight: 0.10,

  halfLife: 24 * 60 * 60 * 1000, // 24 hours
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days

  priorityKeywords: new Set([
    'decision', 'important', 'critical', 'urgent', 'priority',
    'knowledge', 'state', 'anchor', 'context', 'preserve',
    'shift', 'error', 'fix', 'bug', 'issue', 'task', 'goal',
    'remember', 'note', 'key', 'essential', 'required'
  ]),

  metadataWeights: {
    'pinned': 2.0,
    'bookmarked': 1.5,
    'referenced': 1.3,
    'edited': 1.2
  }
};

export interface ScoringContext {
  query?: string;
  currentContext?: string[];
  referenceTime?: number;
  bm25Index?: BM25Index;
}

export interface RelevanceResult {
  score: number;
  factors: {
    keyword: number;
    recency: number;
    priority: number;
    density: number;
    overlap: number;
  };
  explanation: string;
}

/**
 * AdvancedRelevanceScorer - Multi-factor relevance scoring
 */
export class AdvancedRelevanceScorer {
  private config: RelevanceConfig;
  private bm25Index: BM25Index;

  constructor(config?: Partial<RelevanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bm25Index = new BM25Index();
  }

  /**
   * Compute comprehensive relevance score
   */
  computeScore(
    content: string,
    metadata?: Metadata,
    context?: ScoringContext
  ): RelevanceResult {
    const factors = {
      keyword: this.computeKeywordScore(content, context),
      recency: this.computeRecencyScore(metadata?.timestamp, context?.referenceTime),
      priority: this.computePriorityScore(content),
      density: this.computeDensityScore(content),
      overlap: this.computeOverlapScore(content, context?.currentContext)
    };

    // Apply metadata multipliers
    let metadataMultiplier = 1.0;
    if (metadata) {
      for (const [key, weight] of Object.entries(this.config.metadataWeights)) {
        if (metadata[key]) {
          metadataMultiplier *= weight;
        }
      }
    }

    // Combine factors with weights
    const weightedScore = 
      factors.keyword * this.config.keywordWeight +
      factors.recency * this.config.recencyWeight +
      factors.priority * this.config.priorityWeight +
      factors.density * this.config.densityWeight +
      factors.overlap * this.config.overlapWeight;

    const finalScore = weightedScore * metadataMultiplier;

    return {
      score: finalScore,
      factors,
      explanation: this.generateExplanation(factors, metadataMultiplier)
    };
  }

  /**
   * Compute BM25 keyword relevance score
   */
  private computeKeywordScore(content: string, context?: ScoringContext): number {
    if (!context?.query) {
      // No query - use term frequency as proxy
      const terms = content.toLowerCase().split(/\s+/);
      const uniqueTerms = new Set(terms);
      return Math.min(uniqueTerms.size / 100, 1.0);
    }

    // Use BM25 for keyword matching
    const docId = `temp_${Date.now()}`;
    this.bm25Index.addDocument({ id: docId, content });
    const results = this.bm25Index.search(context.query, 1);
    this.bm25Index.removeDocument(docId);

    if (results.length === 0) return 0;

    // Normalize BM25 score (typically 0-30)
    return Math.min(results[0].score / 10, 1.0);
  }

  /**
   * Compute time-based recency score
   */
  private computeRecencyScore(timestamp?: number, referenceTime?: number): number {
    if (!timestamp) return 0.5; // Neutral score for missing timestamp

    const now = referenceTime || Date.now();
    const age = now - timestamp;

    // Beyond max age = zero relevance
    if (age > this.config.maxAge) return 0;

    // Exponential decay: score = 0.5^(age / halfLife)
    const decayFactor = Math.pow(0.5, age / this.config.halfLife);
    return decayFactor;
  }

  /**
   * Compute priority keyword boost score
   */
  private computePriorityScore(content: string): number {
    if (!content) return 0;

    const lower = content.toLowerCase();
    let matches = 0;
    let totalWeight = 0;

    for (const keyword of this.config.priorityKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const keywordMatches = (lower.match(regex) || []).length;
      if (keywordMatches > 0) {
        matches += keywordMatches;
        totalWeight += keywordMatches;
      }
    }

    // Normalize: each keyword match adds 0.1, capped at 1.0
    return Math.min(matches * 0.1, 1.0);
  }

  /**
   * Compute semantic density score (information density)
   */
  private computeDensityScore(content: string): number {
    if (!content) return 0;

    const tokens = content.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;

    // Measure information density:
    // 1. Unique tokens ratio
    const uniqueTokens = new Set(tokens.map(t => t.toLowerCase()));
    const uniqueRatio = uniqueTokens.size / tokens.length;

    // 2. Average token length (longer = more information)
    const avgLength = tokens.reduce((sum, t) => sum + t.length, 0) / tokens.length;
    const lengthScore = Math.min(avgLength / 8, 1.0);

    // 3. Punctuation density (more structure = more information)
    const punctCount = (content.match(/[.!?,;:]/g) || []).length;
    const punctScore = Math.min(punctCount / tokens.length / 0.1, 1.0);

    // Combine
    return (uniqueRatio * 0.5 + lengthScore * 0.3 + punctScore * 0.2);
  }

  /**
   * Compute context overlap score
   */
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

      // Jaccard-like similarity
      const union = new Set([...contentTerms, ...ctxTerms]);
      totalOverlap += overlap / union.size;
    }

    return totalOverlap / currentContext.length;
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(
    factors: RelevanceResult['factors'],
    metadataMultiplier: number
  ): string {
    const parts: string[] = [];

    if (factors.keyword > 0.5) parts.push('high keyword relevance');
    if (factors.recency > 0.7) parts.push('recent');
    if (factors.priority > 0.3) parts.push('contains priority terms');
    if (factors.density > 0.6) parts.push('information-dense');
    if (factors.overlap > 0.3) parts.push('context overlap');
    if (metadataMultiplier > 1.0) parts.push(`metadata boost (${metadataMultiplier.toFixed(1)}x)`);

    return parts.length > 0 ? parts.join(', ') : 'standard relevance';
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RelevanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): RelevanceConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const advancedRelevanceScorer = new AdvancedRelevanceScorer();

// Backward-compatible function for existing code
export function computeRelevanceScore(
  content: string,
  metadata?: Metadata,
  context?: ScoringContext
): number {
  return advancedRelevanceScorer.computeScore(content, metadata, context).score;
}
