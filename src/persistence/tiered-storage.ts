/**
 * Tiered Storage System - Implements bounded memory with eviction
 *
 * Architecture:
 * - L0 (Hot): In-memory LRU cache for frequently accessed items
 * - L1 (Warm): SQLite (sql.js) for searchable persisted data
 * - L2 (Cold): Compressed archive for long-term storage
 *
 * Each tier has configurable size limits and automatic promotion/demotion.
 */

import { LRUCache } from 'lru-cache';
import { TokenCounter, defaultTokenCounter } from '../utils/token-counter';
import { CircuitBreaker, storageBreaker } from '../utils/circuit-breaker';
import { generateSecureId } from '../utils/security';
import { CompressionManager, compressionManager, CompressionAlgorithm } from '../utils/compression';
import { defaultLogger } from '../observability/metrics';
import type { Database, SqlJsStatic } from 'sql.js';

// Queue item for async demotion processing
interface DemotionQueueItem {
  message: StoredMessage;
  resolve: () => void;
  reject: (error: any) => void;
}

// Simple async mutex for sequential operations
class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// Initialize sql.js lazily
let SQL: SqlJsStatic | null = null;
async function getSqlJs(): Promise<SqlJsStatic> {
  if (!SQL) {
    const sqlJs = await import('sql.js');
    SQL = await (sqlJs.default as any)();
  }
  return SQL!;
}

export interface StorageTier {
  name: string;
  maxTokens: number;
  currentTokens: number;
  itemCount: number;
  hitRate: number;
}

export interface TieredStorageConfig {
  l0MaxTokens: number;      // L0 (hot) - LRU cache limit
  l1MaxTokens: number;      // L1 (warm) - SQLite limit
  l2MaxTokens: number;      // L2 (cold) - Archive limit
  l2Compress: boolean;      // Whether to compress L2 data
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
  persistPath?: string;     // Path to persist SQLite database
}

export interface StoredMessage {
  id: string;
  content: string;
  tokenCount: number;
  tier: 'L0' | 'L1' | 'L2';
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  metadata?: Record<string, any>;
  compression?: {
    algorithm: CompressionAlgorithm;
    originalSize: number;
  };
}

const DEFAULT_CONFIG: TieredStorageConfig = {
  l0MaxTokens: 50000,      // ~50k tokens in L0 (hot cache)
  l1MaxTokens: 500000,     // ~500k tokens in L1 (SQLite)
  l2MaxTokens: 2000000,    // ~2M tokens in L2 (archive)
  l2Compress: true,
  evictionPolicy: 'lru'
};

/**
 * TieredStorage - Bounded memory storage with automatic tier management
 */
export class TieredStorage {
  // L0: Hot tier - LRU cache for immediate access
  private l0Cache: LRUCache<string, StoredMessage>;

  // L1: Warm tier - SQLite for searchable persistence
  private l1Db: Database | null = null;
  private l1Tokens: number = 0;

  // L2: Cold tier - Compressed archive (in-memory for now, can be file-based)
  private l2Archive: Map<string, StoredMessage> = new Map();
  private l2Tokens: number = 0;

  private config: TieredStorageConfig;
  private tokenCounter: TokenCounter;
  private compression: CompressionManager;
  private initialized: boolean = false;

  // Async demotion queue - items evicted from L0 that need to be demoted to L1
  private demotionMutex = new AsyncMutex();
  private demotionQueue: { message: StoredMessage; resolve: () => void; reject: (err: any) => void }[] = [];

  // Statistics
  private stats = {
    l0Hits: 0,
    l0Misses: 0,
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    evictions: 0,
    promotions: 0,
    demotions: 0
  };

  constructor(config?: Partial<TieredStorageConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenCounter = defaultTokenCounter;
    this.compression = compressionManager;

    // Initialize L0 LRU cache
    this.l0Cache = new LRUCache<string, StoredMessage>({
      maxSize: this.config.l0MaxTokens,
      sizeCalculation: (value: StoredMessage) => value.tokenCount,
      ttl: 1000 * 60 * 60, // 1 hour TTL
      updateAgeOnGet: true,
      dispose: (value: StoredMessage, key: string, reason: string) => {
        if (reason === 'evict') {
          // Buffer evicted items to prevent data loss
          // Async demotion happens synchronously in store() before accepting new items
          this.bufferEvictedForDemotion(value);
        }
      }
    });
  }

  /**
   * Initialize the storage system (async setup for SQLite)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await storageBreaker.execute(async () => {
        const SQL = await getSqlJs();
        this.l1Db = new SQL.Database();

        // Create tables for L1 storage
        this.l1Db.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            token_count INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            access_count INTEGER DEFAULT 0,
            last_access INTEGER NOT NULL,
            metadata TEXT
          )
        `);

        // Create indices for efficient queries
        this.l1Db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp)`);
        this.l1Db.run(`CREATE INDEX IF NOT EXISTS idx_access ON messages(last_access)`);
        this.l1Db.run(`CREATE INDEX IF NOT EXISTS idx_tokens ON messages(token_count)`);

        this.initialized = true;
      });
    } catch (error) {
      defaultLogger.error('Failed to initialize SQLite', error, { component: 'TieredStorage' });
      // Continue with L0-only mode
      this.initialized = true;
    }
  }

  /**
   * Store a message with automatic tier placement
   * 
   * CRITICAL: Handles explicit demotion BEFORE calling l0Cache.set()
   * to prevent race conditions with LRUCache's sync dispose callback.
   */
  async store(content: string, metadata?: Record<string, any>): Promise<string> {
    const id = this.generateId();
    const tokenCount = this.tokenCounter.count(content);

    const message: StoredMessage = {
      id,
      content,
      tokenCount,
      tier: 'L0',
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
      metadata
    };

    // STEP 1: Check if we need to manually demote items to make room
    // This prevents the LRU dispose callback from racing with our operations
    const l0CurrentSize = this.getL0TokenCount();
    if (l0CurrentSize + tokenCount > this.config.l0MaxTokens) {
      // Calculate how much space we need
      const spaceNeeded = (l0CurrentSize + tokenCount) - this.config.l0MaxTokens;
      await this.proactivelyDemoteFromL0(spaceNeeded);
    }

    // STEP 2: Process any buffered evictions from previous operations (e.g. from internal LRU TTL)
    await this.processBufferedDemotions();

    // STEP 3: Store in L0 (hot tier)
    if (tokenCount <= this.config.l0MaxTokens) {
      this.l0Cache.set(id, message);
    } else {
      // Message is oversized for L0 - demote directly to L1
      await this.demoteToL1(message);
    }

    // STEP 4: Process any immediate evictions if the message was oversized for L0
    await this.processBufferedDemotions();

    return id;
  }

  /**
   * Retrieve a message by ID (checks all tiers)
   */
  async retrieve(id: string): Promise<StoredMessage | null> {
    // Check L0 first (hot)
    const l0Message = this.l0Cache.get(id);
    if (l0Message) {
      this.stats.l0Hits++;
      l0Message.accessCount++;
      l0Message.lastAccess = Date.now();
      return l0Message;
    }
    this.stats.l0Misses++;

    // Check L1 (warm)
    if (this.l1Db) {
      const result = await this.queryL1(id);
      if (result) {
        this.stats.l1Hits++;
        // Promote to L0
        await this.promoteToL0(result);
        return result;
      }
    }
    this.stats.l1Misses++;

    // Check L2 (cold)
    const l2Message = this.l2Archive.get(id);
    if (l2Message) {
      this.stats.l2Hits++;
      // Decompress if needed
      await this.ensureDecompressed(l2Message);
      // Promote to L0
      await this.promoteToL0(l2Message);
      return l2Message;
    }
    this.stats.l2Misses++;

    return null;
  }

  /**
   * Helper to decompress message content if stored in compressed form
   */
  private async ensureDecompressed(message: StoredMessage): Promise<void> {
    if (message.compression && message.compression.algorithm !== 'none') {
      try {
        const compressedData = Buffer.from(message.content, 'base64');
        message.content = await this.compression.decompress(
          compressedData, 
          message.compression.algorithm
        );
        // Clear compression metadata after decompression
        message.compression = undefined;
      } catch (error) {
        defaultLogger.error(`Failed to decompress message ${message.id}`, error, { component: 'TieredStorage' });
      }
    }
  }

  /**
   * Get all messages across all tiers (for JIT rebuilding)
   */
  async getAllMessages(): Promise<StoredMessage[]> {
    const messages: StoredMessage[] = [];

    // Collect from L0
    for (const message of this.l0Cache.values()) {
      messages.push(message);
    }

    // Collect from L1
    if (this.l1Db) {
      try {
        const results = this.l1Db.exec('SELECT * FROM messages ORDER BY timestamp DESC');
        if (results.length > 0 && results[0].values) {
          for (const row of results[0].values) {
            messages.push(this.rowToMessage(row));
          }
        }
      } catch (error) {
        console.warn('[TieredStorage] Error querying L1:', error);
      }
    }

    // Collect from L2
    for (const message of this.l2Archive.values()) {
      // Ensure decompressed for consumer
      await this.ensureDecompressed(message);
      messages.push(message);
    }

    // Sort by timestamp (oldest first for context building)
    messages.sort((a, b) => a.timestamp - b.timestamp);

    return messages;
  }

  /**
   * Get total token count across all tiers
   */
  getTotalTokens(): number {
    let total = 0;
    for (const msg of this.l0Cache.values()) {
      total += msg.tokenCount;
    }
    total += this.l1Tokens;
    total += this.l2Tokens;
    return total;
  }

  /**
   * Get tier statistics
   */
  getTierStats(): { L0: StorageTier; L1: StorageTier; L2: StorageTier } {
    const l0Tokens = Array.from(this.l0Cache.values()).reduce((sum, m) => sum + m.tokenCount, 0);

    return {
      L0: {
        name: 'L0 (Hot)',
        maxTokens: this.config.l0MaxTokens,
        currentTokens: l0Tokens,
        itemCount: this.l0Cache.size,
        hitRate: this.calculateHitRate(this.stats.l0Hits, this.stats.l0Misses)
      },
      L1: {
        name: 'L1 (Warm)',
        maxTokens: this.config.l1MaxTokens,
        currentTokens: this.l1Tokens,
        itemCount: 0, // Would need to query
        hitRate: this.calculateHitRate(this.stats.l1Hits, this.stats.l1Misses)
      },
      L2: {
        name: 'L2 (Cold)',
        maxTokens: this.config.l2MaxTokens,
        currentTokens: this.l2Tokens,
        itemCount: this.l2Archive.size,
        hitRate: this.calculateHitRate(this.stats.l2Hits, this.stats.l2Misses)
      }
    };
  }

  /**
   * Clear all tiers
   */
  async clear(): Promise<void> {
    this.l0Cache.clear();

    if (this.l1Db) {
      this.l1Db.run('DELETE FROM messages');
      this.l1Tokens = 0;
    }

    this.l2Archive.clear();
    this.l2Tokens = 0;

    // Reset stats
    this.stats = {
      l0Hits: 0, l0Misses: 0,
      l1Hits: 0, l1Misses: 0,
      l2Hits: 0, l2Misses: 0,
      evictions: 0, promotions: 0, demotions: 0
    };
  }

  // --- Private Methods ---

  private generateId(): string {
    return `msg_${generateSecureId(32)}`;
  }

  private async ensureCapacity(tier: 'L0' | 'L1' | 'L2', neededTokens: number): Promise<void> {
    // L0 capacity is handled by LRU cache automatically

    // For L1 and L2, we need to manually evict
    if (tier === 'L1' && this.l1Tokens + neededTokens > this.config.l1MaxTokens) {
      await this.evictFromL1(neededTokens);
    }

    if (tier === 'L2' && this.l2Tokens + neededTokens > this.config.l2MaxTokens) {
      await this.evictFromL2(neededTokens);
    }
  }

  private async demoteToL1(message: StoredMessage): Promise<void> {
    if (!this.l1Db) return;

    try {
      await this.ensureCapacity('L1', message.tokenCount);

      this.l1Db.run(
        `INSERT OR REPLACE INTO messages (id, content, token_count, timestamp, access_count, last_access, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.content,
          message.tokenCount,
          message.timestamp,
          message.accessCount,
          message.lastAccess,
          JSON.stringify(message.metadata || {})
        ]
      );

      this.l1Tokens += message.tokenCount;
      message.tier = 'L1';
      this.stats.demotions++;

    } catch (error) {
      console.error('[TieredStorage] Error demoting to L1:', error);
      // If L1 fails, try L2
      await this.demoteToL2(message);
    }
  }

  private async demoteToL2(message: StoredMessage): Promise<void> {
    await this.ensureCapacity('L2', message.tokenCount);

    // If compression is enabled for L2, compress the content
    if (this.config.l2Compress && message.tier !== 'L2') {
      const result = await this.compression.compressForTier(message.content, 'L2');
      if (result.algorithm !== 'none') {
        // Store compressed data in the content field as a base64 string
        message.content = result.data.toString('base64');
        message.compression = {
          algorithm: result.algorithm,
          originalSize: result.originalSize
        };
      }
    }

    this.l2Archive.set(message.id, message);
    this.l2Tokens += message.tokenCount;
    
    // Decrement L1 tokens if it was previously in L1
    if (message.tier === 'L1') {
      this.l1Tokens -= message.tokenCount;
      // Remove from L1 DB
      if (this.l1Db) {
        this.l1Db.run('DELETE FROM messages WHERE id = ?', [message.id]);
      }
    }
    
    message.tier = 'L2';
    this.stats.demotions++;
  }

  private async promoteToL0(message: StoredMessage): Promise<void> {
    // Remove from lower tiers first (before changing tier)
    if (message.tier === 'L1' && this.l1Db) {
      this.l1Db.run('DELETE FROM messages WHERE id = ?', [message.id]);
      this.l1Tokens -= message.tokenCount;
    } else if (message.tier === 'L2') {
      this.l2Archive.delete(message.id);
      this.l2Tokens -= message.tokenCount;
    }

    message.tier = 'L0';
    message.accessCount++;
    message.lastAccess = Date.now();

    // Check capacity before promoting to L0
    const l0CurrentSize = this.getL0TokenCount();
    if (l0CurrentSize + message.tokenCount > this.config.l0MaxTokens) {
      const spaceNeeded = (l0CurrentSize + message.tokenCount) - this.config.l0MaxTokens;
      await this.proactivelyDemoteFromL0(spaceNeeded);
    }
    
    // Process any buffered evictions
    await this.processBufferedDemotions();

    // LRU cache will handle eviction
    this.l0Cache.set(message.id, message);
    this.stats.promotions++;
  }

  private async queryL1(id: string): Promise<StoredMessage | null> {
    if (!this.l1Db) return null;

    try {
      const results = this.l1Db.exec('SELECT * FROM messages WHERE id = ?', [id]);
      if (results.length > 0 && results[0].values && results[0].values.length > 0) {
        return this.rowToMessage(results[0].values[0]);
      }
    } catch (error) {
      console.warn('[TieredStorage] Error querying L1:', error);
    }

    return null;
  }

  private async evictFromL1(neededTokens: number): Promise<void> {
    if (!this.l1Db) return;

    // Get oldest/least accessed messages
    const results = this.l1Db.exec(
      `SELECT * FROM messages ORDER BY last_access ASC LIMIT 100`
    );

    if (results.length > 0 && results[0].values) {
      let freedTokens = 0;
      for (const row of results[0].values) {
        const message = this.rowToMessage(row);
        await this.demoteToL2(message);
        freedTokens += message.tokenCount;
        this.stats.evictions++;

        if (freedTokens >= neededTokens) break;
      }
      // Note: demoteToL2 already handles individual deletion from L1 and updating l1Tokens
    }
  }

  private async evictFromL2(neededTokens: number): Promise<void> {
    // Simple FIFO eviction for L2
    const entries = Array.from(this.l2Archive.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    let freedTokens = 0;
    for (const [id, message] of entries) {
      this.l2Archive.delete(id);
      freedTokens += message.tokenCount;
      this.stats.evictions++;

      if (freedTokens >= neededTokens) break;
    }

    this.l2Tokens -= freedTokens;
  }

  private bufferEvictedForDemotion(message: StoredMessage): void {
    // We create a promise and store its resolvers so store() can await it
    // but the sync dispose callback can return immediately
    this.demotionQueue.push({
      message,
      resolve: () => {}, // These will be handled by processBufferedDemotions
      reject: () => {}
    });
  }

  private async processBufferedDemotions(): Promise<void> {
    if (this.demotionQueue.length === 0) return;

    const release = await this.demotionMutex.acquire();
    try {
      while (this.demotionQueue.length > 0) {
        const item = this.demotionQueue.shift();
        if (item) {
          try {
            await this.demoteToL1(item.message);
            item.resolve();
          } catch (error) {
            item.reject(error);
          }
        }
      }
    } finally {
      release();
    }
  }

  private getL0TokenCount(): number {
    let count = 0;
    for (const msg of this.l0Cache.values()) {
      count += msg.tokenCount;
    }
    return count;
  }

  private async proactivelyDemoteFromL0(neededTokens: number): Promise<void> {
    // Manually evict items from L0 to make room for a specific token count
    // This is more reliable than waiting for LRUCache's internal eviction
    // because we can await the results.
    
    // Sort by last access (oldest first)
    const messages = Array.from(this.l0Cache.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.value.lastAccess - b.value.lastAccess);

    let freed = 0;
    for (const { key, value } of messages) {
      if (freed >= neededTokens) break;
      
      // Delete from LRU
      this.l0Cache.delete(key);
      // Manually buffer for demotion
      this.bufferEvictedForDemotion(value);
      freed += value.tokenCount;
    }
    
    // Now process all buffered demotions (including the ones we just triggered)
    await this.processBufferedDemotions();
  }

  private rowToMessage(row: any[]): StoredMessage {
    return {
      id: row[0] as string,
      content: row[1] as string,
      tokenCount: row[2] as number,
      tier: 'L1',
      timestamp: row[3] as number,
      accessCount: row[4] as number,
      lastAccess: row[5] as number,
      metadata: row[6] ? JSON.parse(row[6] as string) : undefined
    };
  }

  private calculateHitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total > 0 ? hits / total : 0;
  }
}

// Export singleton instance
export const tieredStorage = new TieredStorage();
