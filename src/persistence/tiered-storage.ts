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

// Initialize sql.js lazily
let SQL: any = null;
async function getSqlJs(): Promise<any> {
  if (!SQL) {
    const sqlJs = await import('sql.js');
    SQL = await sqlJs.default();
  }
  return SQL;
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
  private l1Db: any = null;
  private l1Tokens: number = 0;
  
  // L2: Cold tier - Compressed archive (in-memory for now, can be file-based)
  private l2Archive: Map<string, StoredMessage> = new Map();
  private l2Tokens: number = 0;
  
  private config: TieredStorageConfig;
  private tokenCounter: TokenCounter;
  private initialized: boolean = false;
  private messageIdCounter: number = 0;
  
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
    
    // Initialize L0 LRU cache
    this.l0Cache = new LRUCache<string, StoredMessage>({
      max: this.config.l0MaxTokens,
      sizeCalculation: (value: StoredMessage) => value.tokenCount,
      ttl: 1000 * 60 * 60, // 1 hour TTL
      updateAgeOnGet: true,
      dispose: (value: StoredMessage, key: string, reason: string) => {
        if (reason === 'evict') {
          this.demoteToL1(value);
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
      console.error('[TieredStorage] Failed to initialize SQLite:', error);
      // Continue with L0-only mode
      this.initialized = true;
    }
  }

  /**
   * Store a message with automatic tier placement
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
    
    // Check if we need to make room in L0
    await this.ensureCapacity('L0', tokenCount);
    
    // Store in L0 (hot tier)
    this.l0Cache.set(id, message);
    
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
      // Promote to L0
      await this.promoteToL0(l2Message);
      return l2Message;
    }
    this.stats.l2Misses++;
    
    return null;
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
    return `msg_${Date.now()}_${++this.messageIdCounter}`;
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
    
    // For L2, we could compress the content
    // For now, just store as-is
    this.l2Archive.set(message.id, message);
    this.l2Tokens += message.tokenCount;
    message.tier = 'L2';
    this.stats.demotions++;
    
    // Remove from L1 if it was there
    if (this.l1Db) {
      this.l1Db.run('DELETE FROM messages WHERE id = ?', [message.id]);
    }
  }

  private async promoteToL0(message: StoredMessage): Promise<void> {
    message.tier = 'L0';
    message.accessCount++;
    message.lastAccess = Date.now();
    
    // LRU cache will handle eviction
    this.l0Cache.set(message.id, message);
    this.stats.promotions++;
    
    // Remove from lower tiers
    if (message.tier === 'L1' && this.l1Db) {
      this.l1Db.run('DELETE FROM messages WHERE id = ?', [message.id]);
      this.l1Tokens -= message.tokenCount;
    } else if (message.tier === 'L2') {
      this.l2Archive.delete(message.id);
      this.l2Tokens -= message.tokenCount;
    }
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
      
      // Delete evicted from L1
      this.l1Db.run(
        `DELETE FROM messages WHERE id IN (
          SELECT id FROM messages ORDER BY last_access ASC LIMIT ?
        )`,
        [results[0].values.length]
      );
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
