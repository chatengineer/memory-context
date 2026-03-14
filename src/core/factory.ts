/**
 * MemoryContextFactory - Async factory for memory-context components
 */

import { JITEngine } from './jit-engine';
import { HierarchicalContext } from './hierarchical-context';
import { ShiftImmunity } from './shift-immunity';
import { BudgetManager } from './budget-manager';
import { FullHistory, fullHistory } from '../persistence/full-history';
import { TieredStorage, tieredStorage } from '../persistence/tiered-storage';
import { computeRelevanceScore } from '../heuristics/relevance';
import { MemoryContextConfigSchema } from '../validation/schemas';
import { defaultLogger } from '../observability/metrics';

export interface MemoryContextConfig {
  maxContextTokens: number;
  targetUtilization: number;
  zeroShiftEnabled: boolean;
  quantumAnchorsEnabled: boolean;
  persistenceEnabled: boolean;
  predictiveAssemblyEnabled?: boolean;
  adaptiveTuningEnabled?: boolean;
  adaptiveLearningRate?: number;
  minRebuildIntervalMs?: number;
  statePath?: string;
  tieredStorageConfig?: {
    l0MaxTokens?: number;
    l1MaxTokens?: number;
    l2MaxTokens?: number;
  };
}

const DEFAULT_CONFIG: MemoryContextConfig = {
  maxContextTokens: 128000,
  targetUtilization: 0.95,
  zeroShiftEnabled: true,
  quantumAnchorsEnabled: true,
  persistenceEnabled: true,
  predictiveAssemblyEnabled: true,
  adaptiveTuningEnabled: true,
  adaptiveLearningRate: 0.01,
  minRebuildIntervalMs: 0,
  statePath: '.openclaw/memory-context/plugin-state.db'
};

export class MemoryContextFactory {
  private config: MemoryContextConfig;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private static sharedInstance: MemoryContextFactory | null = null;

  private _hierarchy: HierarchicalContext | null = null;
  private _immunity: ShiftImmunity | null = null;
  private _budget: BudgetManager | null = null;
  private _history: FullHistory | null = null;
  private _storage: TieredStorage | null = null;
  private _engine: JITEngine | null = null;

  constructor(config?: Partial<MemoryContextConfig>) {
    const parsed = MemoryContextConfigSchema.parse({ ...DEFAULT_CONFIG, ...config });
    this.config = parsed;
  }

  static getInstance(config?: Partial<MemoryContextConfig>): MemoryContextFactory {
    if (!MemoryContextFactory.sharedInstance) {
      MemoryContextFactory.sharedInstance = new MemoryContextFactory(config);
    }
    return MemoryContextFactory.sharedInstance;
  }

  async initialize(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;
    if (this.initialized) return;

    this.initializationPromise = this.doInitialize();
    try {
      await this.initializationPromise;
      this.initialized = true;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    defaultLogger.info('Initializing components...', { component: 'MemoryContextFactory' });

    if (this.config.persistenceEnabled) {
      this._storage = tieredStorage;
      await this._storage.initialize();
    }

    this._history = fullHistory;
    await this._history.initialize();

    this._hierarchy = new HierarchicalContext();
    this._immunity = new ShiftImmunity();
    this._budget = new BudgetManager(
      this.config.targetUtilization,
      this.config.maxContextTokens
    );

    this._engine = new JITEngine(
      this._hierarchy,
      this._immunity,
      this._budget,
      this._history,
      computeRelevanceScore
    );

    if (this.config.zeroShiftEnabled) {
      this._engine.enableZeroShiftMode();
    }

    defaultLogger.info('Initialization complete', { component: 'MemoryContextFactory' });
  }

  async createEngine(): Promise<JITEngine> {
    await this.initialize();
    if (!this._engine) throw new Error('[MemoryContextFactory] Engine initialization failed');
    return this._engine;
  }

  getEngine(): JITEngine {
    this.ensureInitialized();
    return this._engine!;
  }

  getHierarchy(): HierarchicalContext {
    this.ensureInitialized();
    return this._hierarchy!;
  }

  getImmunity(): ShiftImmunity {
    this.ensureInitialized();
    return this._immunity!;
  }

  getBudget(): BudgetManager {
    this.ensureInitialized();
    return this._budget!;
  }

  getHistory(): FullHistory {
    this.ensureInitialized();
    return this._history!;
  }

  getStorage(): TieredStorage {
    this.ensureInitialized();
    return this._storage!;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConfig(): MemoryContextConfig {
    return { ...this.config };
  }

  async reset(): Promise<void> {
    if (this._history) {
      await this._history.clear();
    }
    this._hierarchy = null;
    this._immunity = null;
    this._budget = null;
    this._history = null;
    this._storage = null;
    this._engine = null;
    this.initialized = false;
    this.initializationPromise = null;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[MemoryContextFactory] Not initialized. Call initialize() first.');
    }
  }
}

export async function createMemoryContext(
  config?: Partial<MemoryContextConfig>
): Promise<JITEngine> {
  const factory = MemoryContextFactory.getInstance(config);
  return factory.createEngine();
}

export const memoryContextFactory = MemoryContextFactory.getInstance();
