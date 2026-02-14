/**
 * Core types for Memory Context
 * Defines the type system for hierarchical context with shift immunity
 */

/** Context hierachy levels - from most active to most durable */
export enum ContextLevel {
  L0 = 0,  // Working Memory - Immediate context
  L1 = 1,  // Active Thread - Current conversation
  L2 = 2,  // Session Context - This session's history
  L3 = 3,  // Persistent Memory - Cross-session knowledge
  L4 = 4,  // Core Identity - Immutable directives
}

/** Context entry with metadata for JIT assembly */
export interface ContextEntry {
  id: string;
  content: string;
  level: ContextLevel;
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
  relevanceScore: number;
  semanticHash: string;
  quantumAnchor: string;
  dependencies: string[];
  size: number;
}

/** Context assembly configuration */
export interface JITConfig {
  targetUtilization: number;
  minReserve: number;
  maxUtilization: number;
  hierarchyLevels: number;
  enableShiftImmunity: boolean;
  enableQuantumAnchors: boolean;
  enablePredictiveAssembly: boolean;
  retentionPolicy: 'infinite' | 'bounded' | 'circular';
  semanticWeight: number;
  workingMemorySize: number;
}

/** Result of JIT context build */
export interface JITBuildResult {
  context: string;
  entries: ContextEntry[];
  totalTokens: number;
  utilization: number;
  levelDistribution: Map<ContextLevel, number>;
  anchors: QuantumAnchor[];
  shiftCheck: ShiftValidationResult;
  buildTimeMs: number;
}

/** Quantum-stability anchor for context continuity */
export interface QuantumAnchor {
  id: string;
  hash: string;
  level: ContextLevel;
  contentSignature: string;
  timestamp: number;
  checkpoint: string;
}

/** Context shift validation result */
export interface ShiftValidationResult {
  isShiftDetected: boolean;
  shiftType?: 'model_change' | 'session_switch' | 'compaction' | 'manual_override';
  recoveryAvailable: boolean;
  anchorsMatched: number;
  anchorsTotal: number;
  confidence: number;
}

/** Predictive context hint */
export interface PredictiveHint {
  probableTopics: string[];
  likelyTools: string[];
  estimatedTokenNeed: number;
  suggestedLayers: ContextLevel[];
}

/** Heuristic scoring weights */
export interface HeuristicWeights {
  recency: number;
  frequency: number;
  semanticRelevance: number;
  hierarchicalPriority: number;
  dependencyWeight: number;
}

/** Memory Context plugin state */
export interface Message {
  content: string;
  role?: string;
  timestamp?: number;
  [key: string]: any;
}

export interface PluginState {
  version: string;
  lastBuild: number;
  totalBuilds: number;
  averageBuildTime: number;
  cacheHitRate: number;
  shiftImmunityActivations: number;
  quantumAnchorsCreated: number;
  contextHistory: number;
}

export interface ContextBuildOptions {
  forceRebuild?: boolean;
  preserveAnchors?: boolean;
  predictiveHints?: PredictiveHint;
  emergencyMode?: boolean;
}

export interface SearchQuery {
  text: string;
  level?: ContextLevel;
  maxResults?: number;
  threshold?: number;
  semantic?: boolean;
}

export interface SearchResult {
  entry: ContextEntry;
  score: number;
  snippet: string;
}
