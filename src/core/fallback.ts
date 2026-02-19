/**
 * Fallback System
 * 
 * Medium Priority Issue #14: Fallback Mechanisms
 * 
 * Provides graceful degradation when primary systems fail:
 * - Fallback to simple in-memory mode
 * - Degraded mode with limited features
 * - Circuit breaker integration
 * - Automatic recovery detection
 */

import { defaultLogger } from '../observability/metrics';

export enum FallbackLevel {
  FULL = 'full',         // All features available
  DEGRADED = 'degraded', // Reduced features
  MINIMAL = 'minimal',   // Basic in-memory only
  EMERGENCY = 'emergency' // Survival mode
}

export interface FallbackState {
  level: FallbackLevel;
  active: boolean;
  reason: string;
  affectedSystems: string[];
  since: number;
  failureCount: number;
}

export interface FallbackConfig {
  enabled: boolean;
  autoRecovery: boolean;
  recoveryCheckInterval: number;
  failAfter: number;
  degradeThreshold: number;
}

const DEFAULT_CONFIG: FallbackConfig = {
  enabled: true,
  autoRecovery: true,
  recoveryCheckInterval: 30000,
  failAfter: 3,
  degradeThreshold: 100
};

/**
 * SimpleContext - Basic in-memory fallback
 */
export class SimpleContext {
  private items: string[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  add(content: string): void {
    this.items.push(content);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  getAll(): string[] {
    return [...this.items];
  }

  getAsString(): string {
    return this.items.join('\n\n');
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

/**
 * DegradedContextManager - Limited functionality manager
 */
export class DegradedContextManager {
  private context = new SimpleContext(50);
  private anchors: string[] = [];
  private tokensUsed = 0;
  private maxTokens: number;

  constructor(maxTokens: number = 32000) {
    this.maxTokens = maxTokens;
  }

  addMessage(content: string): boolean {
    const estimatedTokens = content.length / 4;
    
    if (this.tokensUsed + estimatedTokens > this.maxTokens) {
      // Emergency clear if needed
      while (this.tokensUsed + estimatedTokens > this.maxTokens && this.context.size > 0) {
        this.context.clear();
        this.tokensUsed = 0;
      }
    }

    this.context.add(content);
    this.tokensUsed += estimatedTokens;
    return true;
  }

  addAnchor(anchor: string): void {
    this.anchors.push(anchor);
  }

  buildContext(): string {
    const parts: string[] = [];
    
    if (this.anchors.length > 0) {
      parts.push('[ANCHORS]');
      parts.push(...this.anchors);
    }
    
    parts.push('[CONTEXT]');
    parts.push(this.context.getAsString());
    
    return parts.join('\n\n');
  }

  clear(): void {
    this.context.clear();
    this.anchors = [];
    this.tokensUsed = 0;
  }

  getStatus(): { messages: number; anchors: number; tokens: number } {
    return {
      messages: this.context.size,
      anchors: this.anchors.length,
      tokens: this.tokensUsed
    };
  }
}

/**
 * FallbackManager - Central fallback management
 */
export class FallbackManager {
  private config: FallbackConfig;
  private state: FallbackState;
  private degradedManager = new DegradedContextManager();
  private simpleContext = new SimpleContext();
  private failureCount = 0;
  private lastFailureTime = 0;
  private recoveryTimer: NodeJS.Timeout | null = null;

  constructor(config?: Partial<FallbackConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      level: FallbackLevel.FULL,
      active: false,
      reason: '',
      affectedSystems: [],
      since: 0,
      failureCount: 0
    };
  }

  /**
   * Record a failure
   */
  recordFailure(system: string, error?: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failAfter && !this.state.active) {
      this.activateFallback(
        this.determineFallbackLevel(),
        error?.message || 'Multiple failures detected',
        [system]
      );
    }
  }

  /**
   * Record a success (helps recovery)
   */
  recordSuccess(): void {
    this.failureCount = Math.max(0, this.failureCount - 1);
  }

  /**
   * Determine appropriate fallback level
   */
  private determineFallbackLevel(): FallbackLevel {
    if (this.failureCount >= 10) return FallbackLevel.EMERGENCY;
    if (this.failureCount >= 7) return FallbackLevel.MINIMAL;
    if (this.failureCount >= 3) return FallbackLevel.DEGRADED;
    return FallbackLevel.FULL;
  }

  /**
   * Activate fallback mode
   */
  activateFallback(level: FallbackLevel, reason: string, systems: string[]): void {
    if (this.state.active && this.state.level === level) return;

    this.state = {
      level,
      active: true,
      reason,
      affectedSystems: systems,
      since: Date.now(),
      failureCount: this.failureCount
    };

    defaultLogger.warn(`Activated ${level} mode: ${reason}`, { component: 'FallbackManager' });

    if (this.config.autoRecovery) {
      this.startRecoveryTimer();
    }
  }

  /**
   * Deactivate fallback mode
   */
  deactivateFallback(): void {
    if (!this.state.active) return;

    defaultLogger.info('Returning to full mode', { component: 'FallbackManager' });

    this.state = {
      level: FallbackLevel.FULL,
      active: false,
      reason: '',
      affectedSystems: [],
      since: 0,
      failureCount: 0
    };

    this.failureCount = 0;
    this.stopRecoveryTimer();
  }

  /**
   * Start recovery timer
   */
  private startRecoveryTimer(): void {
    this.stopRecoveryTimer();
    this.recoveryTimer = setInterval(() => {
      this.checkRecovery();
    }, this.config.recoveryCheckInterval);
    this.recoveryTimer.unref(); // Allow process to exit
  }

  /**
   * Stop recovery timer
   */
  private stopRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Check if recovery is possible
   */
  private checkRecovery(): void {
    const timeSinceFailure = Date.now() - this.lastFailureTime;
    
    // Recovery if no failures for recovery interval * 2
    if (timeSinceFailure > this.config.recoveryCheckInterval * 2) {
      this.deactivateFallback();
    }
  }

  /**
   * Get context manager for current level
   */
  getContextManager(): DegradedContextManager | SimpleContext {
    switch (this.state.level) {
      case FallbackLevel.FULL:
      case FallbackLevel.DEGRADED:
        return this.degradedManager;
      case FallbackLevel.MINIMAL:
      case FallbackLevel.EMERGENCY:
        return this.simpleContext;
    }
  }

  /**
   * Add message (fallback-aware)
   */
  addMessage(content: string): boolean {
    if (this.state.level === FallbackLevel.EMERGENCY) {
      this.simpleContext.add(content);
      return true;
    }
    return this.degradedManager.addMessage(content);
  }

  /**
   * Add anchor
   */
  addAnchor(anchor: string): void {
    if (this.state.level === FallbackLevel.EMERGENCY) {
      return; // No anchors in emergency mode
    }
    this.degradedManager.addAnchor(anchor);
  }

  /**
   * Build context
   */
  buildContext(): string {
    if (this.state.level === FallbackLevel.EMERGENCY) {
      return this.simpleContext.getAsString();
    }
    return this.degradedManager.buildContext();
  }

  /**
   * Check if fallback is active
   */
  isFallbackActive(): boolean {
    return this.state.active;
  }

  /**
   * Get current state
   */
  getState(): FallbackState {
    return { ...this.state };
  }

  /**
   * Get statistics
   */
  getStats(): FallbackState & { config: FallbackConfig } {
    return {
      ...this.state,
      config: { ...this.config }
    };
  }

  /**
   * Force emergency mode
   */
  forceEmergencyMode(reason: string): void {
    this.activateFallback(FallbackLevel.EMERGENCY, reason, ['all']);
    this.degradedManager.clear();
  }

  /**
   * Reset all
   */
  reset(): void {
    this.deactivateFallback();
    this.degradedManager.clear();
    this.simpleContext.clear();
  }
}

// Export singleton
export const fallbackManager = new FallbackManager();
