// src/heuristics/relevance.ts
// Backward-compatible exports from advanced-relevance.ts
// Use computeRelevanceScore for simple usage, AdvancedRelevanceScorer for full control

export {
  computeRelevanceScore,
  AdvancedRelevanceScorer,
  advancedRelevanceScorer
} from './advanced-relevance';
export type {
  RelevanceConfig,
  ScoringContext,
  RelevanceResult
} from './advanced-relevance';
