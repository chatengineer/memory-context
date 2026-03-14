// src/index.ts
// Main plugin entry point for the memory-context OpenClaw plugin
// Implements OpenClaw lifecycle hooks using the Factory pattern for async init

import { 
  MemoryContextFactory, 
  MemoryContextConfig,
  memoryContextFactory 
} from "./core/factory";
import { JITEngine, MemoryRecallOptions, MemorySearchOptions, MemorySearchResult } from "./core/jit-engine";
import { Type } from "@sinclair/typebox";
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

    const predictorBefore = engine.getPredictor().export();
    const previousPrimaryTopic = predictorBefore.topicHistory[predictorBefore.topicHistory.length - 1];

    const storedMessageId = await history.addMessage(sanitized);
    const extractedTopics = engine.analyzeMessage(storedMessageId, sanitized.content);

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
      await this.persistAnchors();
    }

    await this.persistMessageMutation(
      storedMessageId,
      sanitized.content,
      targetLayer,
      {
        ...sanitized,
        timestamp: sanitized.timestamp || Date.now(),
        role: sanitized.role
      },
      extractedTopics,
      previousPrimaryTopic
    );

    await engine.buildContext(sanitized);
    await this.persistVolatileState();

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

  async searchMemory(query: string, options: number | MemorySearchOptions = 10): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const resolvedOptions: MemorySearchOptions = typeof options === 'number' ? { limit: options } : options;
    const sqlRows = await this.stateStore.searchRetrievalCandidates(query, resolvedOptions);
    if (sqlRows.length > 0) {
      return sqlRows.map(row => ({
        id: row.id,
        score: 1,
        content: row.content,
        metadata: row.metadata,
        source: row.source,
        timestamp: row.timestamp,
        explanation: row.explanation,
        matchedTerms: query ? [query.toLowerCase()] : []
      }));
    }

    return this.factory.getEngine().search(query, options);
  }

  async searchStorage(query: string, options: StorageSearchOptions = {}): Promise<StorageSearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.factory.getStorage().search(query, options);
  }

  async recallMemory(idsOrOptions: string[] | MemoryRecallOptions): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const resolvedOptions: MemoryRecallOptions = Array.isArray(idsOrOptions) ? { ids: idsOrOptions } : idsOrOptions;
    const sqlRows = await this.stateStore.recallRetrievalCandidates(resolvedOptions);
    if (sqlRows.length > 0) {
      return sqlRows.map(row => ({
        id: row.id,
        score: 1,
        content: row.content,
        metadata: row.metadata,
        source: row.source,
        timestamp: row.timestamp,
        explanation: row.explanation
      }));
    }

    return this.factory.getEngine().recall(idsOrOptions);
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
        if (params?.storage) {
          return this.searchStorage(query, params);
        }
        return this.searchMemory(query, {
          limit: params?.limit || 10,
          source: params?.source || 'all',
          role: params?.role,
          since: params?.since,
          until: params?.until,
          minScore: params?.minScore,
          includeExplanation: params?.includeExplanation
        });
      },
      'memory_context.anchor': async (params) => {
        const immunity = this.factory.getImmunity();
        const action = params?.action || 'list';
        if (action === 'list') return immunity.exportAnchors();
        if (action === 'remove') {
          const removed = immunity.removeAnchor(params?.id || params?.anchor);
          if (removed) await this.persistAnchors();
          return { removed };
        }
        if (action === 'add') {
          const type = params?.type || 'raw';
          let result: any;
          if (type === 'decision') result = immunity.addDecisionAnchor(params?.decision || params?.content, params?.rationale || 'manual anchor');
          else if (type === 'state') result = immunity.addStateAnchor(params?.key, params?.value, params?.previousValue);
          else if (type === 'reference') result = immunity.addReferenceAnchor(params?.referenceType || 'document', params?.reference, params?.title);
          else if (type === 'custom') result = immunity.addCustomAnchor(params?.customType || 'custom', params?.data || {}, params?.content);
          else {
            immunity.addAnchor(params?.content || params?.anchor || '');
            result = { ok: true };
          }
          await this.persistAnchors();
          return result;
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
      memory_context_recall: async (args) => this.recallMemory(args?.ids ? args.ids : args || {}),
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
    const engine = this.factory.getEngine();

    const hierarchyEntries = hierarchy.exportState().layers.flatMap((entries, layer) =>
      entries.map((content, index) => ({
        id: `restore:${layer}:${index}:${content.slice(0, 16)}`,
        layer,
        content,
        metadata: { restored: true }
      }))
    );

    await this.stateStore.replaceHierarchy(hierarchyEntries);
    await this.persistAnchors();
    await this.stateStore.replaceRetrievalCandidates(engine.getRetrievalCandidates());
    await this.stateStore.savePredictiveState(engine.getPredictor().export());
    await this.persistVolatileState();
  }

  private async persistVolatileState(): Promise<void> {
    const engine = this.factory.getEngine();
    await this.stateStore.setMeta('version', '1.6.0');
    await this.stateStore.setMeta('savedAt', Date.now());
    await this.stateStore.setMeta('lastContext', engine.getLastContext());
  }

  private async persistAnchors(): Promise<void> {
    const anchors = this.factory.getImmunity().exportAnchors();
    await this.stateStore.saveRawAnchors(anchors.raw);
    await this.stateStore.saveTypedAnchors(anchors.typed);
  }

  private async persistMessageMutation(
    messageId: string,
    content: string,
    layer: number,
    metadata: Record<string, any>,
    extractedTopics: string[] = [],
    previousPrimaryTopic?: string
  ): Promise<void> {
    await this.stateStore.upsertHierarchyEntry({
      id: `hierarchy:${layer}:${messageId}`,
      layer,
      content,
      metadata
    });

    await this.stateStore.upsertRetrievalCandidate({
      id: messageId,
      content,
      source: 'history',
      metadata
    });

    await this.stateStore.upsertRetrievalCandidate({
      id: `hierarchy:${layer}:${messageId}`,
      content,
      source: 'hierarchy',
      layer,
      metadata: { ...metadata, layer }
    });

    if (extractedTopics.length > 0) {
      await this.stateStore.upsertMessageTopics(messageId, extractedTopics);
      await this.stateStore.appendTopicHistory(extractedTopics[0]);
      if (previousPrimaryTopic && previousPrimaryTopic !== extractedTopics[0]) {
        await this.stateStore.incrementTransition(previousPrimaryTopic, extractedTopics[0]);
      }
    }
  }

  private async restoreState(): Promise<void> {
    const state = await this.stateStore.loadState();
    if (!state) return;

    const hierarchy = this.factory.getHierarchy();
    const immunity = this.factory.getImmunity();
    const engine = this.factory.getEngine();

    const layers = [[], [], [], [], []] as string[][];
    for (const entry of state.hierarchyEntries) {
      if (!layers[entry.layer]) layers[entry.layer] = [];
      layers[entry.layer].push(entry.content);
    }
    hierarchy.importState({ layers });

    immunity.importAnchors({ raw: state.rawAnchors, typed: state.typedAnchors });

    await engine.clearRuntimeState();
    engine.importState({
      lastContext: state.lastContext,
      predictor: state.predictive || undefined
    });

    for (const candidate of state.retrievalCandidates) {
      engine.seedCandidate({
        id: candidate.id,
        content: candidate.content,
        metadata: { ...(candidate.metadata || {}), source: candidate.source, layer: candidate.layer },
        source: candidate.source,
        layer: candidate.layer
      });
    }
  }
}

function createPluginRuntime(config?: Partial<MemoryContextConfig>) {
  const plugin = new MemoryContextPlugin(config);
  return plugin;
}

const memoryContextPlugin = {
  id: "memory-context",
  name: "Memory Context - Zero-Shift Context Engine",
  kind: "memory",
  register(api: any) {
    const plugin = createPluginRuntime(api?.config);
    const gatewayMethods = plugin.getGatewayMethods();
    for (const [method, handler] of Object.entries(gatewayMethods)) {
      api.registerGatewayMethod(method, async ({ params, respond }: any) => {
        const result = await handler(params || {});
        if (typeof respond === 'function') {
          respond(true, result);
          return;
        }
        return result;
      });
    }

    const toolHandlers = plugin.getToolHandlers();
    for (const [name, handler] of Object.entries(toolHandlers)) {
      api.registerTool({
        name,
        description: `memory-context runtime tool: ${name}`,
        parameters: Type.Object({}, { additionalProperties: true }),
        async execute(_id: string, params: Record<string, any>) {
          const result = await handler(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
      }, { optional: true });
    }

    if (api.registerCli && api.runtime?.tools?.registerMemoryCli) {
      api.registerCli(({ program }: any) => {
        api.runtime.tools.registerMemoryCli(program);
      }, { commands: ["memory"] });
    }
  }
};

export default memoryContextPlugin;
