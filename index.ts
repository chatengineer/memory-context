/**
 * Memory Context Plugin Entry Point
 * 
 * Re-exports from src/index.ts for OpenClaw plugin discovery
 * This is the root entry point that OpenClaw looks for
 * 
 * Uses Factory pattern for async initialization (Critical Issue #3)
 */

// Activation hook for OpenClaw plugin system
// OpenClaw calls this to get a plugin instance
export function activate(context?: any): { dispose: () => void } {
  console.log('[memory-context] Activating plugin...');
  
  // Import at activation time to avoid load-time errors
  const { MemoryContextPlugin } = require('./src/index');
  
  // Create plugin instance
  const plugin = new MemoryContextPlugin();
  
  // Initialize asynchronously (don't block activation)
  plugin.onLoad().catch((err: any) => {
    console.error('[memory-context] Activation error:', err);
  });
  
  // Return OpenClaw-compatible interface
  return {
    dispose: () => {
      console.log('[memory-context] Disposing plugin...');
      plugin.onUnload().catch(console.error);
    }
  };
}

// Legacy register function
export function register(): { dispose: () => void } {
  return activate();
}

// Default export - OpenClaw may import this
export default activate;

// Re-export types and classes for external use
export type { 
  ContextLevel,
  ContextEntry,
  JITConfig,
  JITBuildResult,
  QuantumAnchor,
  ShiftValidationResult,
  PredictiveHint,
  HeuristicWeights,
  PluginState,
  ContextBuildOptions,
  SearchQuery,
  SearchResult,
  Message
} from './src/types';

// Re-export factory and config types
export type { MemoryContextConfig } from './src/core/factory';
export { MemoryContextFactory, createMemoryContext, memoryContextFactory } from './src/core/factory';

// Lazy exports - only load when accessed
export const MemoryContextPlugin = lazyRequire('./src/index', 'MemoryContextPlugin');
export const JITEngine = lazyRequire('./src/core/jit-engine', 'JITEngine');
export const HierarchicalContext = lazyRequire('./src/core/hierarchical-context', 'HierarchicalContext');
export const ShiftImmunity = lazyRequire('./src/core/shift-immunity', 'ShiftImmunity');
export const BudgetManager = lazyRequire('./src/core/budget-manager', 'BudgetManager');
export const FullHistory = lazyRequire('./src/persistence/full-history', 'FullHistory');
export const TieredStorage = lazyRequire('./src/persistence/tiered-storage', 'TieredStorage');

function lazyRequire(modulePath: string, exportName: string) {
  return new Proxy(function() {}, {
    construct(_target: any, args: any[]) {
      const mod = require(modulePath);
      return new mod[exportName](...args);
    },
    get(_target: any, prop: string | symbol) {
      const mod = require(modulePath);
      return mod[exportName][prop];
    }
  });
}
