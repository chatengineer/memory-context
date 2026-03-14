/**
 * MemoryContextFactory - Async factory for memory-context components
 * 
 * Critical Issue #3: Async Constructor Resolution
 * 
 * Problem: SQLite initialization and other async operations cannot happen
 * in constructors, leading to race conditions.
 * 
 * Solution: Factory pattern with proper async initialization and dependency injection.
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
  tieredStorageConfig?: {
    l0MaxTokens?: number;
    l1MaxTokens?: number;
    l2MaxTokens?: number;
  };
}

const DEFAULT_CONFIG: MemoryContextConfig = {
  maxContextTokens: 128000,      // Default to large context
  targetUtilization: 0.95,       // 95% utilization with 5% safety margin
  zeroShiftEnabled: true,
  quantumAnchorsEnabled: true,
  persistenceEnabled: true
};

/**
 * MemoryContextFactory - Creates fully initialized memory-context instances
 * 
 * Usage:
 * ```typescript
 * const factory = new MemoryContextFactory(config);
 * const context = await factory.create();
 * // Now context is fully initialized and ready to use
 * ```
 */
export class MemoryContextFactory {
  private config: MemoryContextConfig;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  
  // Singleton instances (created once, reused)
  private static sharedInstance: MemoryContextFactory | null = null;
  
  // Components
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

  /**
   * Get singleton factory instance
   */
  static getInstance(config?: Partial<MemoryContextConfig>): MemoryContextFactory {
    if (!MemoryContextFactory.sharedInstance) {
      MemoryContextFactory.sharedInstance = new MemoryContextFactory(config);
    }
    return MemoryContextFactory.sharedInstance;
  }

  /**
   * Initialize all components (idempotent, thread-safe)
   */
  async initialize(): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    // Already initialized
    if (this.initialized) {
      return;
    }
    
    // Start initialization
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
    
    // 1. Initialize tiered storage (async)
    if (this.config.persistenceEnabled) {
      this._storage = tieredStorage;
      await this._storage.initialize();
    }
    
    // 2. Initialize history (depends on storage)
    this._history = fullHistory;
    await this._history.initialize();
    
    // 3. Initialize synchronous components
    this._hierarchy = new HierarchicalContext();
    this._immunity = new ShiftImmunity();
    this._budget = new BudgetManager(
      this.config.targetUtilization,
      this.config.maxContextTokens
    );
    
    // 4. Initialize JIT engine (depends on all above)
    this._engine = new JITEngine(
      this._hierarchy,
      this._immunity,
      this._budget,
      this._history,
      computeRelevanceScore
    );
    
    // 5. Enable zero-shift mode if configured
    if (this.config.zeroShiftEnabled) {
      this._engine.enableZeroShiftMode();
    }
    
    defaultLogger.info('Initialization complete', { component: 'MemoryContextFactory' });
  }

  /**
   * Create a fully initialized JITEngine
   */
  async createEngine(): Promise<JITEngine> {
    await this.initialize();
    if (!this._engine) {
      throw new Error('[MemoryContextFactory] Engine initialization failed');
    }
    return this._engine;
  }

  /**
   * Get component instances (throws if not initialized)
   */
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

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get configuration
   */
  getConfig(): MemoryContextConfig {
    return { ...this.config };
  }

  /**
   * Reset the factory (for testing)
   */
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
      throw new Error(
        '[MemoryContextFactory] Not initialized. Call initialize() first.'
      );
    }
  }
}

// Export convenience function
export async function createMemoryContext(
  config?: Partial<MemoryContextConfig>
): Promise<JITEngine> {
  const factory = MemoryContextFactory.getInstance(config);
  return factory.createEngine();
}

// Export singleton factory
export const memoryContextFactory = MemoryContextFactory.getInstance();
