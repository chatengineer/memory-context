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
  source: 'history' | 'hierarchy' | 'predicted';
  layer?: number;
}

export interface MemorySearchResult {
  id: string;
  score: number;
  content: string;
  metadata?: Metadata;
  source: JITCandidate['source'];
}

/**
 * JITEngine – Just‑In‑Time context assembler
 *
 * - No compaction: always rebuilds from the complete source (full history + hierarchy).
 * - Zero‑shift mode: each call starts from a clean slate, but shift‑immune anchors are re‑injected.
 * - Query-aware scoring: uses BM25 + advanced relevance factors when a trigger message is available.
 * - Predictive assembly: learns topic transitions and pre-ranks likely future contexts.
 */
export class JITEngine {
  private hierarchy: HierarchicalContext;
  private immunity: ShiftImmunity;
  private budget: BudgetManager;
  private history: FullHistory;
  private relevanceFn: (content: string, metadata?: Metadata, context?: ScoringContext) => number;
  private advancedScorer: AdvancedRelevanceScorer;
  private predictor: PredictiveAssembler;
  private zeroShift: boolean = false;
  private lastContext: string = '';
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

  async buildContext(triggerMessage: any): Promise<string> {
    const anchors = this.immunity.getAnchors();
    const query = this.extractTriggerContent(triggerMessage);
    const fullHistory = await this.history.getAllMessages();
    const candidates = this.collectCandidates(fullHistory);

    this.refreshRetrievalIndex(candidates);

    const rankedContents = this.rankCandidates(candidates, query, anchors);
    const budgeted = this.budget.applyBudget(rankedContents);
    const finalContext = [...anchors, ...budgeted.selected].join('\n\n');

    this.lastContext = finalContext;
    this.cachePredictedContexts(candidates);
    return finalContext;
  }

  search(query: string, limit: number = 10): MemorySearchResult[] {
    if (!query.trim()) return [];

    const results = this.retrievalIndex.search(query, limit);
    return results.map(result => {
      const candidate = this.retrievalCandidates.get(result.id);
      return {
        id: result.id,
        score: result.score,
        content: candidate?.content || '',
        metadata: candidate?.metadata,
        source: candidate?.source || 'history'
      };
    }).filter(result => result.content);
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

  importState(data: Partial<ReturnType<JITEngine['exportState']>>): void {
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
          source: (doc.metadata?.source as JITCandidate['source']) || 'history',
          layer: typeof doc.metadata?.layer === 'number' ? doc.metadata.layer : undefined
        });
      }
    }

    if (data.predictor) {
      this.predictor.import(data.predictor);
    }
  }

  private extractTriggerContent(triggerMessage: any): string {
    if (typeof triggerMessage === 'string') return triggerMessage;
    if (triggerMessage && typeof triggerMessage.content === 'string') return triggerMessage.content;
    return '';
  }

  private collectCandidates(historyMessages: Array<{ id?: string; content: string; timestamp?: number; [key: string]: any }>): JITCandidate[] {
    const candidates: JITCandidate[] = [];
    const seenContent = new Set<string>();

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
          metadata: { layer: layerIndex, timestamp: Date.now(), source: 'hierarchy' },
          source: 'hierarchy',
          layer: layerIndex
        });
      }
    }

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
          role: message.role,
          source: 'history'
        },
        source: 'history'
      });
    }

    const predictedContexts = this.predictor.predictNextContexts();
    for (const prediction of predictedContexts) {
      for (const result of this.recall(prediction.contextIds)) {
        if (seenContent.has(result.content)) continue;
        seenContent.add(result.content);
        candidates.push({
          id: `predicted:${result.id}:${prediction.topic}`,
          content: result.content,
          metadata: {
            ...(result.metadata || {}),
            predictedTopic: prediction.topic,
            predictedProbability: prediction.probability,
            source: 'predicted'
          },
          source: 'predicted'
        });
      }
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
        const sourceBoost = candidate.source === 'history' ? 0.02 : candidate.source === 'predicted' ? 0.08 : 0;
        const predictedBoost = predictedIds.get(candidate.id) || 0;

        return {
          content: candidate.content,
          score: baseScore + layerBoost + sourceBoost + predictedBoost
        };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.content);
  }

  private refreshRetrievalIndex(candidates: JITCandidate[]): void {
    this.retrievalIndex.clear();
    this.retrievalCandidates.clear();

    for (const candidate of candidates) {
      this.retrievalCandidates.set(candidate.id, candidate);
      this.retrievalIndex.addDocument({
        id: candidate.id,
        content: candidate.content,
        metadata: candidate.metadata
      });
    }
  }

  private cachePredictedContexts(candidates: JITCandidate[]): void {
    const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]));
    for (const prediction of this.predictor.predictNextContexts()) {
      this.predictor.preAssembleContext(prediction.topic, () => {
        return prediction.contextIds
          .map(id => candidateMap.get(id)?.content)
          .filter((content): content is string => Boolean(content))
          .join('\n\n');
      });
    }
  }
}
