// src/persistence/full-history.ts
// Full conversation history with bounded tiered storage
// Implements Critical Issue #2: Unbounded Memory Growth protection

import { TieredStorage, StoredMessage, tieredStorage } from './tiered-storage';
import { storageBreaker } from '../utils/circuit-breaker';
import { metricsRegistry } from '../observability/metrics';
import { Metadata } from '../types';

/**
 * Message format compatible with OpenClaw's message structure
 */
export interface Message {
  id?: string;
  content: string;
  role?: 'user' | 'assistant' | 'system';
  timestamp?: number;
  [key: string]: string | number | boolean | null | undefined | any;
}

const MAX_PENDING_MESSAGES = 1000;

/**
 * FullHistory – stores raw messages with bounded tiered storage
 * 
 * Architecture:
 * - L0 (Hot): In-memory LRU cache for frequently accessed items
 * - L1 (Warm): SQLite for searchable persisted data  
 * - L2 (Cold): Compressed archive for long-term storage
 * 
 * This prevents unbounded memory growth by enforcing tier limits.
 */
export class FullHistory {
  private storage: TieredStorage;
  private initialized: boolean = false;
  private pendingMessages: Message[] = []; // Buffer for messages before init

  constructor(storage?: TieredStorage) {
    this.storage = storage || tieredStorage;
  }

  /**
   * Internal helper to buffer messages with size limits
   */
  private bufferMessage(message: Message): void {
    this.pendingMessages.push(message);
    
    // Enforce limit (FIFO)
    if (this.pendingMessages.length > MAX_PENDING_MESSAGES) {
      this.pendingMessages.shift();
      console.warn(`[FullHistory] Pending message buffer overflow (> ${MAX_PENDING_MESSAGES}). Dropped oldest message.`);
    }
  }

  /**
   * Initialize the storage system (must be called before use)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await storageBreaker.execute(async () => {
      await this.storage.initialize();
      this.initialized = true;
      
      // Register health check for pending buffer
      metricsRegistry.registerHealthCheck('full_history_pending_buffer', async () => {
        const count = this.pendingMessages.length;
        return {
          name: 'full_history_pending_buffer',
          status: count > (MAX_PENDING_MESSAGES * 0.8) ? 'degraded' : 'healthy',
          message: count > 0 ? `${count} messages in pending buffer` : 'Buffer empty',
          details: { count, limit: MAX_PENDING_MESSAGES },
          lastCheck: Date.now()
        };
      });

      // Flush any pending messages
      for (const msg of this.pendingMessages) {
        await this.addMessage(msg);
      }
      this.pendingMessages = [];
    });
  }

  /** Add a new message to the history with automatic tier placement */
  async addMessage(msg: Partial<Message>): Promise<string> {
    const message: Message = {
      content: msg?.content ?? String(msg),
      role: msg?.role as any,
      timestamp: msg?.timestamp || Date.now(),
      ...msg
    };

    // If not initialized, buffer the message
    if (!this.initialized) {
      this.bufferMessage(message);
      return `pending_${Date.now()}`;
    }

    try {
      return await storageBreaker.execute(async () => {
        const id = await this.storage.store(message.content, {
          role: message.role,
          timestamp: message.timestamp,
          ...message
        });
        return id;
      });
    } catch (error) {
      console.error('[FullHistory] Error storing message:', error);
      // Fallback: store in pending buffer
      this.bufferMessage(message);
      return `fallback_${Date.now()}`;
    }
  }

  /** Retrieve all stored messages in chronological order */
  async getAllMessages(): Promise<Message[]> {
    if (!this.initialized) {
      return [...this.pendingMessages];
    }

    try {
      return await storageBreaker.execute(async () => {
        const stored = await this.storage.getAllMessages();
        return stored.map((sm: StoredMessage) => ({
          id: sm.id,
          content: sm.content,
          role: sm.metadata?.role,
          timestamp: sm.timestamp,
          ...sm.metadata
        }));
      });
    } catch (error) {
      console.error('[FullHistory] Error retrieving messages:', error);
      return [...this.pendingMessages];
    }
  }

  /** Retrieve a specific message by ID */
  async getMessage(id: string): Promise<Message | null> {
    if (!this.initialized) {
      const pending = this.pendingMessages.find(m => m.id === id);
      return pending || null;
    }

    try {
      const stored = await this.storage.retrieve(id);
      if (!stored) return null;
      
      return {
        id: stored.id,
        content: stored.content,
        role: stored.metadata?.role,
        timestamp: stored.timestamp,
        ...stored.metadata
      };
    } catch (error) {
      console.error('[FullHistory] Error retrieving message:', error);
      return null;
    }
  }

  /** Clear the history – used for testing or reset */
  async clear(): Promise<void> {
    this.pendingMessages = [];
    
    if (this.initialized) {
      await this.storage.clear();
    }
  }

  /** Get total token count across all tiers */
  getTotalTokens(): number {
    const pendingTokens = this.pendingMessages.reduce(
      (sum, m) => sum + (m.content?.length || 0) / 4, // rough estimate
      0
    );
    return this.storage.getTotalTokens() + pendingTokens;
  }

  /** Get storage statistics */
  getStats(): { totalTokens: number; tiers: ReturnType<TieredStorage['getTierStats']> } {
    return {
      totalTokens: this.getTotalTokens(),
      tiers: this.storage.getTierStats()
    };
  }
}

// Export singleton instance
export const fullHistory = new FullHistory();
