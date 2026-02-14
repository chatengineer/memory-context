// src/index.ts
// Main plugin entry point for the memory-context OpenClaw plugin
// Implements OpenClaw lifecycle hooks and wires core components

import { JITEngine } from "./core/jit-engine";
import { HierarchicalContext, Layer } from "./core/hierarchical-context";
import { ShiftImmunity } from "./core/shift-immunity";
import { BudgetManager } from "./core/budget-manager";
import { computeRelevanceScore } from "./heuristics/relevance";
import { FullHistory } from "./persistence/full-history";

/**
 * MemoryContextPlugin – registers with OpenClaw and manages context lifecycle.
 * The plugin follows the OpenClaw plugin API (registerPlugin, lifecycle hooks).
 */
export class MemoryContextPlugin {
  private jitEngine: JITEngine;
  private hierarchy: HierarchicalContext;
  private shiftImmunity: ShiftImmunity;
  private budget: BudgetManager;
  private history: FullHistory;

  constructor() {
    // Initialize core components
    this.hierarchy = new HierarchicalContext();
    this.shiftImmunity = new ShiftImmunity();
    this.budget = new BudgetManager();
    this.history = new FullHistory();
    this.jitEngine = new JITEngine(
      this.hierarchy,
      this.shiftImmunity,
      this.budget,
      this.history,
      computeRelevanceScore
    );
  }

  /** Called when the plugin is loaded by OpenClaw */
  async onLoad(): Promise<void> {
    console.log("[memory-context] Plugin loaded – initializing components");
    // No compaction – ensure JIT always rebuilds from full source
    this.jitEngine.enableZeroShiftMode();
  }

  /** Called when the plugin is unloaded */
  async onUnload(): Promise<void> {
    console.log("[memory-context] Plugin unloaded – cleaning up");
    // Cleanup any resources if needed
  }

  /** Called on each incoming message (or turn) */
  async onMessage(message: any): Promise<void> {
    // Persist the raw message for full-history JIT
    this.history.addMessage(message);
    // Optionally update hierarchical layers based on message metadata
    // e.g., L0 = working context, L1 = session, etc.
    this.hierarchy.addContent(Layer.L0, message.content);
    // Rebuild context for the next model call
    const context = await this.jitEngine.buildContext(message);
    // Expose the built context to OpenClaw (pseudo‑API)
    // In real plugin you would set the context on the request object
    console.log("[memory-context] Rebuilt context for next model call");
  }

  /** Called when the underlying model switches (e.g., Gemini to Claude) */
  async onModelSwitch(oldModel: string, newModel: string): Promise<void> {
    console.log(`[memory-context] Model switch from ${oldModel} → ${newModel}`);
    // Preserve shift‑immune anchors across the switch
    this.shiftImmunity.preserveAnchors();
  }
}

// Register the plugin with OpenClaw (global registration function provided by the host)
// This is a placeholder – the real API may differ.
if (typeof registerPlugin === "function") {
  registerPlugin(new MemoryContextPlugin());
}
