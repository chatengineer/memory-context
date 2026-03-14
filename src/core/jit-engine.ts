// src/core/jit-engine.ts
// Zero‑shift JIT context builder – rebuilds the full context on every call

import { HierarchicalContext } from './hierarchical-context';
import { ShiftImmunity } from './shift-immunity';
import { BudgetManager } from './budget-manager';
import { FullHistory } from '../persistence/full-history';
import {
  AdvancedRelevanceScorer,
  ScoringContext,
  computeRelevanceScore
} from '../heuristics/relevance';
import { BM25Index } from '../search/bm25-index';
import { Metadata } from '../types';

interface JITCandidate {
  id: string;
  content: string;
  metadata?: Metadata;
  source: 'history' | 'hierarchy';
  layer?: number;
}

/**
 * JITEngine – Just‑In‑Time context assembler
 *
 * - No compaction: always rebuilds from the complete source (full history + hierarchy).
 * - Zero‑shift mode: each call starts from a clean slate, but shift‑immune anchors are re‑injected.
 * - Query-aware scoring: uses BM25 + advanced relevance factors when a trigger message is available.
 */
export class JITEngine {
  private hierarchy: HierarchicalContext;
  private immunity: ShiftImmunity;
  private budget: BudgetManager;
  private history: FullHistory;
  private relevanceFn: (content: string, metadata?: Metadata, context?: ScoringContext) => number;
  private advancedScorer: AdvancedRelevanceScorer;
  private zeroShift: boolean = false;
  private lastContext: string = '';

  constructor(
    hierarchy: HierarchicalContext,
    immunity: ShiftImmunity,
    budget: BudgetManager,
    history: FullHistory,
    relevanceFn: (content: string, metadata?: Metadata, context?: ScoringContext) => number = computeRelevanceScore
  ) {
    this.hierarchy = hierarchy;
    this.immunity = immunity;
    this.budget = budget;
    this.history = history;
    this.relevanceFn = relevanceFn;
    this.advancedScorer = new AdvancedRelevanceScorer();
  }

  /** Enable zero‑shift mode – disables any incremental accumulation. */
  enableZeroShiftMode(): void {
    this.zeroShift = true;
  }

  /** Get the last built context for diagnostics/tests. */
  getLastContext(): string {
    return this.lastContext;
  }

  /** Build a fresh context for the upcoming model call. */
  async buildContext(triggerMessage: any): Promise<string> {
    const anchors = this.immunity.getAnchors();
    const query = this.extractTriggerContent(triggerMessage);
    const fullHistory = await this.history.getAllMessages();
    const candidates = this.collectCandidates(fullHistory);

    const rankedContents = this.rankCandidates(candidates, query, anchors);
    const budgeted = this.budget.applyBudget(rankedContents);
    const finalContext = [...anchors, ...budgeted.selected].join('\n\n');

    this.lastContext = finalContext;
    return finalContext;
  }

  private extractTriggerContent(triggerMessage: any): string {
    if (typeof triggerMessage === 'string') return triggerMessage;
    if (triggerMessage && typeof triggerMessage.content === 'string') return triggerMessage.content;
    return '';
  }

  private collectCandidates(historyMessages: Array<{ id?: string; content: string; timestamp?: number; [key: string]: any }>): JITCandidate[] {
    const candidates: JITCandidate[] = [];
    const seenContent = new Set<string>();

    // Add hierarchical content with layer metadata (preserving durable layers as candidate sources).
    const layers = this.hierarchy.getAllLayers();
    for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
      const bucket = layers[layerIndex] ?? [];
      for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
        const content = bucket[itemIndex];
        if (!content || seenContent.has(content)) continue;
        seenContent.add(content);
        candidates.push({
          id: `hierarchy:${layerIndex}:${itemIndex}`,
          content,
          metadata: { layer: layerIndex, timestamp: Date.now() },
          source: 'hierarchy',
          layer: layerIndex
        });
      }
    }

    // Add history content with full metadata for scoring.
    for (let i = 0; i < historyMessages.length; i++) {
      const message = historyMessages[i];
      if (!message?.content || seenContent.has(message.content)) continue;
      seenContent.add(message.content);
      candidates.push({
        id: message.id || `history:${i}`,
        content: message.content,
        metadata: {
          ...message,
          id: message.id || `history:${i}`,
          timestamp: message.timestamp || Date.now(),
          role: message.role
        },
        source: 'history'
      });
    }

    return candidates;
  }

  private rankCandidates(candidates: JITCandidate[], query: string, anchors: string[]): string[] {
    if (candidates.length === 0) return [];

    const bm25Index = new BM25Index();
    for (const candidate of candidates) {
      bm25Index.addDocument({
        id: candidate.id,
        content: candidate.content,
        metadata: candidate.metadata
      });
    }

    const scoringContext: ScoringContext = {
      query: query || undefined,
      currentContext: anchors,
      referenceTime: Date.now(),
      bm25Index
    };

    const batchScores = this.advancedScorer.computeBatchScores(
      candidates.map(candidate => ({
        content: candidate.content,
        metadata: candidate.metadata
      })),
      scoringContext
    );

    return candidates
      .map((candidate, index) => {
        const baseScore = batchScores[index] ?? this.relevanceFn(candidate.content, candidate.metadata, scoringContext);
        const layerBoost = candidate.source === 'hierarchy'
          ? Math.max(0, ((candidate.layer ?? 0) + 1) * 0.03)
          : 0;
        const sourceBoost = candidate.source === 'history' ? 0.02 : 0;

        return {
          content: candidate.content,
          score: baseScore + layerBoost + sourceBoost
        };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.content);
  }
}
