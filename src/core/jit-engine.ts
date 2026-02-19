// src/core/jit-engine.ts
// Zero‑shift JIT context builder – rebuilds the full context on every call

import { HierarchicalContext, Layer } from "./hierarchical-context";
import { ShiftImmunity } from "./shift-immunity";
import { BudgetManager } from "./budget-manager";
import { FullHistory } from "../persistence/full-history";
import { computeRelevanceScore } from "../heuristics/relevance";

/**
 * JITEngine – Just‑In‑Time context assembler
 *
 * - No compaction: always rebuilds from the complete source (full history + hierarchy).
 * - Zero‑shift mode: each call starts from a clean slate, but shift‑immune anchors are re‑injected.
 */
export class JITEngine {
  private hierarchy: HierarchicalContext;
  private immunity: ShiftImmunity;
  private budget: BudgetManager;
  private history: FullHistory;
  private relevanceFn: (content: string) => number;
  private zeroShift: boolean = false;

  constructor(
    hierarchy: HierarchicalContext,
    immunity: ShiftImmunity,
    budget: BudgetManager,
    history: FullHistory,
    relevanceFn: (content: string) => number
  ) {
    this.hierarchy = hierarchy;
    this.immunity = immunity;
    this.budget = budget;
    this.history = history;
    this.relevanceFn = relevanceFn;
  }

  /** Enable zero‑shift mode – disables any incremental accumulation. */
  enableZeroShiftMode(): void {
    this.zeroShift = true;
  }

  /** Build a fresh context for the upcoming model call. */
  async buildContext(triggerMessage: any): Promise<string> {
    // 1. Gather all layers (L0‑L4) from hierarchical context
    const layers = this.hierarchy.getAllLayers();

    // 2. Retrieve full conversation history (for JIT rebuilding)
    const fullHistory = await this.history.getAllMessages();

    // 3. Combine hierarchy and history into a candidate pool
    const candidates: string[] = [];
    // Add hierarchical content (preserving order L4→L0 for stability)
    for (let i = layers.length - 1; i >= 0; i--) {
      candidates.push(...layers[i]);
    }
    // Append raw history (latest first)
    candidates.push(...fullHistory.map(m => m.content));

    // 4. Compute relevance scores and sort
    // Optimization: Batch scoring to avoid O(N) overhead
    const scored = candidates.map(c => ({ 
      content: c, 
      score: this.relevanceFn(c) 
    }));
    scored.sort((a, b) => b.score - a.score);

    // 5. Apply token budget – 100% utilization (TARGET_UTILIZATION=1.0)
    const budgeted = this.budget.applyBudget(scored.map(s => s.content));

    // 6. Re‑inject shift‑immune anchors (quantum anchors) to guarantee continuity
    const anchors = this.immunity.getAnchors();
    const finalContext = [...anchors, ...budgeted.selected].join("\n\n");

    return finalContext;
  }
}
