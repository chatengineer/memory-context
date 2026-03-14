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
import { PredictiveAssembler } from './predictive-assembly';

interface JITCandidate {
  id: string;
  content: string;
  metadata?: Metadata;
  source: 'history' | 'hierarchy';
  layer?: number;
}

export interface MemorySearchResult {
  id: string;
  score: number;
  content: string;
  metadata?: Metadata;
  source: 'history' | 'hierarchy';
}

export class JITEngine {
  private hierarchy: HierarchicalContext;
  private immunity: ShiftImmunity;
  private budget: BudgetManager;
  private history: FullHistory;
  private relevanceFn: (content: string, metadata?: Metadata, context?: ScoringContext) => number;
  private advancedScorer: AdvancedRelevanceScorer;
  private predictor: PredictiveAssembler;
  private zeroShift = false;
  private lastContext = '';
  private retrievalIndex: BM25Index = new BM25Index();
  private retrievalCandidates: Map<string, JITCandidate> = new Map();

  constructor(
    hierarchy: HierarchicalContext,
    immunity: ShiftImmunity,
    budget: BudgetManager,
    history: FullHistory,
    relevanceFn: (content: string, metadata?: Metadata, context?: ScoringContext) => number = computeRelevanceScore,
    predictor: PredictiveAssembler = new PredictiveAssembler()
  ) {
    this.hierarchy = hierarchy;
    this.immunity = immunity;
    this.budget = budget;
    this.history = history;
    this.relevanceFn = relevanceFn;
    this.advancedScorer = new AdvancedRelevanceScorer();
    this.predictor = predictor;
  }

  enableZeroShiftMode(): void {
    this.zeroShift = true;
  }

  getLastContext(): string {
    return this.lastContext;
  }

  getPredictor(): PredictiveAssembler {
    return this.predictor;
  }

  analyzeMessage(messageId: string, content: string): string[] {
    return this.predictor.analyzeMessage(messageId, content);
  }

  async recordMessage(
    messageId: string,
    content: string,
    metadata?: Metadata,
    layer?: number
  ): Promise<void> {
    this.upsertCandidate({
      id: messageId,
      content,
      metadata: { ...(metadata || {}), id: messageId, source: 'history' },
      source: 'history'
    });

    if (typeof layer === 'number') {
      this.upsertCandidate({
        id: `hierarchy:${layer}:${messageId}`,
        content,
        metadata: { ...(metadata || {}), id: `hierarchy:${layer}:${messageId}`, layer, source: 'hierarchy' },
        source: 'hierarchy',
        layer
      });
    }
  }

  async clearRuntimeState(): Promise<void> {
    this.lastContext = '';
    this.retrievalIndex.clear();
    this.retrievalCandidates.clear();
    this.predictor.reset();
  }

  async buildContext(triggerMessage: any): Promise<string> {
    await this.ensureSeeded();

    const anchors = this.immunity.getAnchors();
    const query = this.extractTriggerContent(triggerMessage);
    const candidates = Array.from(this.retrievalCandidates.values());
    const rankedContents = this.rankCandidates(candidates, query, anchors);
    const budgeted = this.budget.applyBudget(rankedContents);
    const finalContext = [...anchors, ...budgeted.selected].join('\n\n');

    this.lastContext = finalContext;
    this.cachePredictedContexts();
    return finalContext;
  }

  async search(query: string, limit: number = 10): Promise<MemorySearchResult[]> {
    await this.ensureSeeded();
    if (!query.trim()) return [];

    const results = this.retrievalIndex.search(query, limit);
    const mapped: MemorySearchResult[] = [];

    for (const result of results) {
      const candidate = this.retrievalCandidates.get(result.id);
      if (!candidate) continue;
      mapped.push({
        id: result.id,
        score: result.score,
        content: candidate.content,
        metadata: candidate.metadata,
        source: candidate.source
      });
    }

    return mapped;
  }

  recall(ids: string[]): MemorySearchResult[] {
    return ids
      .map(id => this.retrievalCandidates.get(id))
      .filter((candidate): candidate is JITCandidate => Boolean(candidate))
      .map(candidate => ({
        id: candidate.id,
        score: 1,
        content: candidate.content,
        metadata: candidate.metadata,
        source: candidate.source
      }));
  }

  exportState(): {
    lastContext: string;
    retrievalIndex: ReturnType<BM25Index['export']>;
    predictor: ReturnType<PredictiveAssembler['export']>;
  } {
    return {
      lastContext: this.lastContext,
      retrievalIndex: this.retrievalIndex.export(),
      predictor: this.predictor.export()
    };
  }

  importState(data: Partial<ReturnType<JITEngine['exportState']>> & { predictor?: ReturnType<PredictiveAssembler['export']> }): void {
    if (data.lastContext) {
      this.lastContext = data.lastContext;
    }

    if (data.retrievalIndex) {
      this.retrievalIndex.import(data.retrievalIndex);
      this.retrievalCandidates.clear();
      for (const [id, doc] of data.retrievalIndex.documents) {
        this.retrievalCandidates.set(id, {
          id,
          content: doc.content,
          metadata: doc.metadata,
          source: (doc.metadata?.source as 'history' | 'hierarchy') || 'history',
          layer: typeof doc.metadata?.layer === 'number' ? doc.metadata.layer : undefined
        });
      }
    }

    if (data.predictor) {
      this.predictor.import(data.predictor);
    }
  }

  getRuntimeStats(): {
    indexedCandidates: number;
    predictor: ReturnType<PredictiveAssembler['getStats']>;
    hasContext: boolean;
  } {
    return {
      indexedCandidates: this.retrievalCandidates.size,
      predictor: this.predictor.getStats(),
      hasContext: Boolean(this.lastContext)
    };
  }

  private extractTriggerContent(triggerMessage: any): string {
    if (typeof triggerMessage === 'string') return triggerMessage;
    if (triggerMessage && typeof triggerMessage.content === 'string') return triggerMessage.content;
    return '';
  }

  private async ensureSeeded(): Promise<void> {
    if (this.retrievalCandidates.size > 0) return;

    const layers = this.hierarchy.getAllLayers();
    for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex--) {
      const bucket = layers[layerIndex] ?? [];
      for (let itemIndex = 0; itemIndex < bucket.length; itemIndex++) {
        const content = bucket[itemIndex];
        if (!content) continue;
        this.upsertCandidate({
          id: `hierarchy:${layerIndex}:seed:${itemIndex}`,
          content,
          metadata: { layer: layerIndex, timestamp: Date.now(), source: 'hierarchy' },
          source: 'hierarchy',
          layer: layerIndex
        });
      }
    }

    const fullHistory = await this.history.getAllMessages();
    for (let i = 0; i < fullHistory.length; i++) {
      const message = fullHistory[i];
      if (!message?.content) continue;
      this.upsertCandidate({
        id: message.id || `history:seed:${i}`,
        content: message.content,
        metadata: {
          ...message,
          id: message.id || `history:seed:${i}`,
          timestamp: message.timestamp || Date.now(),
          role: message.role,
          source: 'history'
        },
        source: 'history'
      });
    }
  }

  private rankCandidates(candidates: JITCandidate[], query: string, anchors: string[]): string[] {
    if (candidates.length === 0) return [];

    const predictedIds = new Map<string, number>();
    for (const prediction of this.predictor.predictNextContexts()) {
      for (const id of prediction.contextIds) {
        predictedIds.set(id, Math.max(predictedIds.get(id) || 0, prediction.probability));
      }
    }

    const scoringContext: ScoringContext = {
      query: query || undefined,
      currentContext: anchors,
      referenceTime: Date.now(),
      bm25Index: this.retrievalIndex
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
        const sourceBoost = candidate.source === 'history' ? 0.02 : 0.03;
        const predictedBoost = predictedIds.get(candidate.id) || 0;

        return {
          content: candidate.content,
          score: baseScore + layerBoost + sourceBoost + predictedBoost
        };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.content);
  }

  private cachePredictedContexts(): void {
    for (const prediction of this.predictor.predictNextContexts()) {
      this.predictor.preAssembleContext(prediction.topic, () => {
        return this.recall(prediction.contextIds)
          .map(result => result.content)
          .join('\n\n');
      });
    }
  }

  private upsertCandidate(candidate: JITCandidate): void {
    this.retrievalCandidates.set(candidate.id, candidate);
    this.retrievalIndex.addDocument({
      id: candidate.id,
      content: candidate.content,
      metadata: candidate.metadata
    });
  }
}
