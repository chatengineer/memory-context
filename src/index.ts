// src/index.ts
// Main plugin entry point for the memory-context OpenClaw plugin
// Implements OpenClaw lifecycle hooks using the Factory pattern for async init

import { 
  MemoryContextFactory, 
  MemoryContextConfig,
  memoryContextFactory 
} from "./core/factory";
import { JITEngine, MemorySearchResult } from "./core/jit-engine";
import { HierarchicalContext, Layer } from "./core/hierarchical-context";
import { FullHistory } from "./persistence/full-history";
import { pluginStateStore, PluginStateStore } from "./persistence/plugin-state";
import { StorageSearchOptions, StorageSearchResult } from "./persistence/tiered-storage";
import { defaultLogger } from "./observability/metrics";
import { validateMessage, sanitizeMessage } from "./validation/schemas";

/**
 * MemoryContextPlugin – registers with OpenClaw and manages context lifecycle.
 * Uses the Factory pattern for proper async initialization.
 */
type GatewayMethodHandler = (params?: Record<string, any>) => Promise<any>;
type ToolHandler = (args?: Record<string, any>) => Promise<any>;

export class MemoryContextPlugin {
  private factory: MemoryContextFactory;
  private stateStore: PluginStateStore;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(config?: Partial<MemoryContextConfig>) {
    this.factory = config 
      ? new MemoryContextFactory(config)
      : memoryContextFactory;
    this.stateStore = config?.statePath
      ? new PluginStateStore({ statePath: config.statePath })
      : pluginStateStore;
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
    await this.restoreState();
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
    await this.persistState();
    await this.stateStore.close();
    await this.factory.reset();
    this.initialized = false;
  }

  /** Called on each incoming message (or turn) */
  async onMessage(message: any): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const validation = validateMessage(message);
    if (!validation.success || !validation.data) {
      defaultLogger.warn("Rejected invalid message", {
        component: "memory-context",
        errors: validation.errors
      });
      return;
    }

    const sanitized = sanitizeMessage(validation.data);
    const history = this.factory.getHistory();
    const hierarchy = this.factory.getHierarchy();
    const immunity = this.factory.getImmunity();
    const engine = this.factory.getEngine();

    const storedMessageId = await history.addMessage(sanitized);
    engine.analyzeMessage(storedMessageId, sanitized.content);

    const targetLayer = sanitized.role === 'system'
      ? Layer.L4
      : sanitized.role === 'assistant'
        ? Layer.L1
        : Layer.L0;
    hierarchy.addContent(targetLayer, sanitized.content);
    await engine.recordMessage(storedMessageId, sanitized.content, {
      ...sanitized,
      timestamp: sanitized.timestamp || Date.now(),
      role: sanitized.role
    }, targetLayer);

    if (sanitized.role === 'system') {
      immunity.addDecisionAnchor(
        sanitized.content.slice(0, 200),
        'System message captured as a shift-immune directive',
        { impact: 'high', metadata: { source: 'system-message' } }
      );
    }

    await engine.buildContext(sanitized);
    await this.persistState();

    defaultLogger.info("Rebuilt context for next model call", {
      component: "memory-context",
      layer: targetLayer,
      role: sanitized.role || 'unknown'
    });
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

  async searchMemory(query: string, limit: number = 10): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.factory.getEngine().search(query, limit);
  }

  async searchStorage(query: string, options: StorageSearchOptions = {}): Promise<StorageSearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.factory.getStorage().search(query, options);
  }

  async recallMemory(ids: string[]): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.factory.getEngine().recall(ids);
  }

  async snapshot(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    await this.persistState();
  }

  async restore(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
      return;
    }
    await this.restoreState();
  }

  async invokeGatewayMethod(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    const handlers = this.getGatewayMethods();
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unsupported gateway method: ${method}`);
    }
    return handler(params);
  }

  async invokeTool(name: string, args: Record<string, any> = {}): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    const handlers = this.getToolHandlers();
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unsupported tool: ${name}`);
    }
    return handler(args);
  }

  getGatewayMethods(): Record<string, GatewayMethodHandler> {
    return {
      'memory_context.status': async () => {
        if (!this.initialized) await this.initialize();
        return {
          initialized: this.initialized,
          storage: this.factory.getStorage().getTierStats(),
          history: this.factory.getHistory().getStats(),
          engine: this.factory.getEngine().getRuntimeStats(),
          statePath: this.stateStore.getPath()
        };
      },
      'memory_context.build': async (params) => this.factory.getEngine().buildContext(params?.message || params?.triggerMessage || params?.content || ''),
      'memory_context.jit_build': async (params) => this.factory.getEngine().buildContext(params?.message || params?.triggerMessage || params?.content || ''),
      'memory_context.jit_stats': async () => this.factory.getEngine().getRuntimeStats(),
      'memory_context.jit_clear': async () => {
        await this.factory.getHistory().clear();
        for (const layer of [Layer.L0, Layer.L1, Layer.L2, Layer.L3, Layer.L4]) {
          this.factory.getHierarchy().clearLayer(layer);
        }
        this.factory.getImmunity().clearTypedAnchors();
        await this.factory.getEngine().clearRuntimeState();
        await this.stateStore.clear();
        return { ok: true };
      },
      'memory_context.shift_detect': async () => ({
        anchors: this.factory.getImmunity().exportAnchors(),
        hasContext: Boolean(this.factory.getEngine().getLastContext())
      }),
      'memory_context.validate': async (params) => validateMessage(params?.message || params),
      'memory_context.history': async (params) => {
        const messages = await this.factory.getHistory().getAllMessages();
        const limit = typeof params?.limit === 'number' ? params.limit : messages.length;
        return messages.slice(-limit);
      },
      'memory_context.search': async (params) => {
        const query = params?.query || params?.text || '';
        const limit = params?.limit || 10;
        if (params?.storage) {
          return this.searchStorage(query, params);
        }
        return this.searchMemory(query, limit);
      },
      'memory_context.anchor': async (params) => {
        const immunity = this.factory.getImmunity();
        const action = params?.action || 'list';
        if (action === 'list') return immunity.exportAnchors();
        if (action === 'remove') return { removed: immunity.removeAnchor(params?.id || params?.anchor) };
        if (action === 'add') {
          const type = params?.type || 'raw';
          if (type === 'decision') return immunity.addDecisionAnchor(params?.decision || params?.content, params?.rationale || 'manual anchor');
          if (type === 'state') return immunity.addStateAnchor(params?.key, params?.value, params?.previousValue);
          if (type === 'reference') return immunity.addReferenceAnchor(params?.referenceType || 'document', params?.reference, params?.title);
          if (type === 'custom') return immunity.addCustomAnchor(params?.customType || 'custom', params?.data || {}, params?.content);
          immunity.addAnchor(params?.content || params?.anchor || '');
          return { ok: true };
        }
        throw new Error(`Unsupported anchor action: ${action}`);
      }
    };
  }

  getToolHandlers(): Record<string, ToolHandler> {
    return {
      memory_context_build: async (args) => this.invokeGatewayMethod('memory_context.build', args),
      memory_context_stats: async () => this.invokeGatewayMethod('memory_context.status'),
      memory_context_search: async (args) => this.invokeGatewayMethod('memory_context.search', args),
      memory_context_anchor: async (args) => this.invokeGatewayMethod('memory_context.anchor', args),
      memory_context_jit_build: async (args) => this.invokeGatewayMethod('memory_context.jit_build', args),
      memory_context_jit_clear: async () => this.invokeGatewayMethod('memory_context.jit_clear'),
      memory_context_shift_check: async () => this.invokeGatewayMethod('memory_context.shift_detect'),
      memory_context_diff: async () => ({ lastContext: this.factory.getEngine().getLastContext() }),
      memory_context_history: async (args) => this.invokeGatewayMethod('memory_context.history', args),
      memory_context_recall: async (args) => this.recallMemory(args?.ids || []),
      memory_context_profile: async () => this.factory.getEngine().getPredictor().getPatterns(),
      memory_context_validate: async (args) => this.invokeGatewayMethod('memory_context.validate', args),
      memory_context_snapshot: async () => { await this.snapshot(); return { ok: true, path: this.stateStore.getPath() }; },
      memory_context_restore: async () => { await this.restore(); return { ok: true, path: this.stateStore.getPath() }; },
      memory_context_optimize: async () => ({ predictor: this.factory.getEngine().getPredictor().getStats(), storage: this.factory.getStorage().getTierStats() })
    };
  }

  /** Check if initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  private async persistState(): Promise<void> {
    const hierarchy = this.factory.getHierarchy();
    const immunity = this.factory.getImmunity();
    const engine = this.factory.getEngine();

    await this.stateStore.save({
      version: '1.5.0',
      savedAt: Date.now(),
      hierarchy: hierarchy.exportState(),
      immunity: immunity.exportAnchors(),
      predictive: engine.getPredictor().export(),
      engine: engine.exportState()
    });
  }

  private async restoreState(): Promise<void> {
    const snapshot = await this.stateStore.load();
    if (!snapshot) return;

    const hierarchy = this.factory.getHierarchy();
    const immunity = this.factory.getImmunity();
    const engine = this.factory.getEngine();

    if (snapshot.hierarchy) {
      hierarchy.importState(snapshot.hierarchy);
    }
    if (snapshot.immunity) {
      immunity.importAnchors(snapshot.immunity);
    }
    if (snapshot.predictive || snapshot.engine) {
      engine.importState({
        predictor: snapshot.predictive as any,
        ...(snapshot.engine as any || {})
      });
    }
  }
}

declare function registerPlugin(plugin: any): void;

// Register the plugin with OpenClaw (global registration function provided by the host)
// This is a placeholder – the real API may differ.
if (typeof registerPlugin === "function") {
  registerPlugin(new MemoryContextPlugin());
}
