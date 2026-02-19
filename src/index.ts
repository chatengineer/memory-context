// src/index.ts
// Main plugin entry point for the memory-context OpenClaw plugin
// Implements OpenClaw lifecycle hooks using the Factory pattern for async init

import { 
  MemoryContextFactory, 
  MemoryContextConfig,
  memoryContextFactory 
} from "./core/factory";
import { JITEngine } from "./core/jit-engine";
import { HierarchicalContext, Layer } from "./core/hierarchical-context";
import { ShiftImmunity } from "./core/shift-immunity";
import { BudgetManager } from "./core/budget-manager";
import { computeRelevanceScore } from "./heuristics/relevance";
import { FullHistory } from "./persistence/full-history";
import { defaultLogger } from "./observability/metrics";

/**
 * MemoryContextPlugin – registers with OpenClaw and manages context lifecycle.
 * Uses the Factory pattern for proper async initialization.
 */
export class MemoryContextPlugin {
  private factory: MemoryContextFactory;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(config?: Partial<MemoryContextConfig>) {
    this.factory = config 
      ? new MemoryContextFactory(config)
      : memoryContextFactory;
  }

  /** 
   * Initialize the plugin (async, idempotent)
   * Called by OpenClaw onLoad or manually
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.initPromise = null;
  }

  private async doInitialize(): Promise<void> {
    defaultLogger.info("Initializing plugin...", { component: "memory-context" });
    await this.factory.initialize();
    this.initialized = true;
    defaultLogger.info("Plugin initialized successfully", { component: "memory-context" });
  }

  /** Called when the plugin is loaded by OpenClaw */
  async onLoad(): Promise<void> {
    await this.initialize();
    const engine = this.factory.getEngine();
    // No compaction – ensure JIT always rebuilds from full source
    engine.enableZeroShiftMode();
    defaultLogger.info("Plugin loaded – zero-shift mode enabled", { component: "memory-context" });
  }

  /** Called when the plugin is unloaded */
  async onUnload(): Promise<void> {
    defaultLogger.info("Plugin unloaded – cleaning up", { component: "memory-context" });
    await this.factory.reset();
    this.initialized = false;
  }

  /** Called on each incoming message (or turn) */
  async onMessage(message: any): Promise<void> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    const history = this.factory.getHistory();
    const hierarchy = this.factory.getHierarchy();
    const engine = this.factory.getEngine();

    // Persist the raw message for full-history JIT
    await history.addMessage(message);
    
    // Optionally update hierarchical layers based on message metadata
    hierarchy.addContent(Layer.L0, message.content);
    
    // Rebuild context for the next model call
    await engine.buildContext(message);
    
    defaultLogger.info("Rebuilt context for next model call", { component: "memory-context" });
  }

  /** Called when the underlying model switches (e.g., Gemini to Claude) */
  async onModelSwitch(oldModel: string, newModel: string): Promise<void> {
    defaultLogger.info(`Model switch from ${oldModel} → ${newModel}`, { component: "memory-context" });
    
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Preserve shift-immune anchors across the switch
    const immunity = this.factory.getImmunity();
    immunity.preserveAnchors();
  }

  /** Get the JIT engine (throws if not initialized) */
  getEngine(): JITEngine {
    return this.factory.getEngine();
  }

  /** Get history instance */
  getHistory(): FullHistory {
    return this.factory.getHistory();
  }

  /** Get hierarchy instance */
  getHierarchy(): HierarchicalContext {
    return this.factory.getHierarchy();
  }

  /** Check if initialized */
  isInitialized(): boolean {
    return this.initialized;
  }
}

declare function registerPlugin(plugin: any): void;

// Register the plugin with OpenClaw (global registration function provided by the host)
// This is a placeholder – the real API may differ.
if (typeof registerPlugin === "function") {
  registerPlugin(new MemoryContextPlugin());
}
