/**
 * SQLite Persistence Manager
 * 
 * Critical Issue #5: Persistence Layer Implementation
 * 
 * Features:
 * - File-based SQLite persistence using sql.js
 * - WAL-like behavior with periodic saves
 * - Automatic backup and recovery
 * - Schema migrations
 */

import * as fs from 'fs';
import * as path from 'path';

// Initialize sql.js lazily
let SQL: any = null;
async function getSqlJs(): Promise<any> {
  if (!SQL) {
    const sqlJs = await import('sql.js');
    SQL = await sqlJs.default();
  }
  return SQL;
}

export interface PersistenceConfig {
  dbPath: string;
  backupPath?: string;
  autoSaveInterval?: number;  // ms
  enableWAL?: boolean;
  maxBackupAge?: number;      // ms
}

const DEFAULT_CONFIG: PersistenceConfig = {
  dbPath: '.openclaw/memory-context/history.db',
  autoSaveInterval: 30000,    // 30 seconds
  enableWAL: true,
  maxBackupAge: 7 * 24 * 60 * 60 * 1000  // 7 days
};

/**
 * Schema version for migrations
 */
const SCHEMA_VERSION = 1;

/**
 * SQL schema definitions
 */
const SCHEMA = `
-- Metadata table for schema version
CREATE TABLE IF NOT EXISTS schema_info (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Messages table (L1 storage)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  last_access INTEGER NOT NULL,
  metadata TEXT,
  tier TEXT DEFAULT 'L1'
);

-- Quantum anchors table
CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  priority INTEGER DEFAULT 0,
  metadata TEXT
);

-- Indices for efficient queries
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_access ON messages(last_access);
CREATE INDEX IF NOT EXISTS idx_messages_tokens ON messages(token_count);
CREATE INDEX IF NOT EXISTS idx_anchors_type ON anchors(type);
CREATE INDEX IF NOT EXISTS idx_anchors_priority ON anchors(priority DESC);
`;

/**
 * SQLitePersistence - Manages SQLite database with file-based persistence
 */
export class SQLitePersistence {
  private db: any = null;
  private config: PersistenceConfig;
  private initialized: boolean = false;
  private dirty: boolean = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private savePromise: Promise<void> | null = null;

  constructor(config?: Partial<PersistenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the database (creates or loads from file)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const SQL = await getSqlJs();
    
    // Ensure directory exists
    const dbDir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Load existing database or create new
    if (fs.existsSync(this.config.dbPath)) {
      try {
        const buffer = fs.readFileSync(this.config.dbPath);
        this.db = new SQL.Database(buffer);
        console.log(`[SQLitePersistence] Loaded database from ${this.config.dbPath}`);
      } catch (error) {
        console.warn('[SQLitePersistence] Failed to load database, creating new:', error);
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
      console.log('[SQLitePersistence] Created new database');
    }

    // Apply schema
    await this.applySchema();

    // Start auto-save timer
    if (this.config.autoSaveInterval) {
      this.autoSaveTimer = setInterval(() => {
        this.save().catch(console.error);
      }, this.config.autoSaveInterval);
    }

    this.initialized = true;
  }

  /**
   * Apply schema and run migrations
   */
  private async applySchema(): Promise<void> {
    // Run schema creation
    this.db.run(SCHEMA);

    // Check schema version
    const versionResult = this.db.exec('SELECT version FROM schema_info ORDER BY version DESC LIMIT 1');
    const currentVersion = versionResult.length > 0 && versionResult[0].values.length > 0
      ? versionResult[0].values[0][0] as number
      : 0;

    // Run migrations if needed
    if (currentVersion < SCHEMA_VERSION) {
      await this.runMigrations(currentVersion);
    }

    this.dirty = true;
  }

  /**
   * Run database migrations
   */
  private async runMigrations(fromVersion: number): Promise<void> {
    console.log(`[SQLitePersistence] Running migrations from version ${fromVersion}`);

    // Migration 1: Initial schema
    if (fromVersion < 1) {
      // Already applied via SCHEMA constant
      this.db.run(
        'INSERT INTO schema_info (version, applied_at) VALUES (?, ?)',
        [1, Date.now()]
      );
    }

    // Future migrations would go here:
    // if (fromVersion < 2) { ... }

    this.dirty = true;
    console.log(`[SQLitePersistence] Migrations complete, now at version ${SCHEMA_VERSION}`);
  }

  /**
   * Get the underlying database instance
   */
  getDb(): any {
    return this.db;
  }

  /**
   * Execute a SQL query
   */
  exec(sql: string, params?: any[]): any {
    this.ensureInitialized();
    this.dirty = true;
    
    if (params) {
      return this.db.run(sql, params);
    }
    return this.db.exec(sql);
  }

  /**
   * Query and return results
   */
  query(sql: string, params?: any[]): any[] {
    this.ensureInitialized();
    
    if (params) {
      // sql.js doesn't support parameterized queries directly in exec
      // Use a prepared statement approach
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    }
    
    const result = this.db.exec(sql);
    if (result.length === 0) return [];
    
    // Convert to array of objects
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * Run an insert/update/delete
   */
  run(sql: string, params?: any[]): { changes: number } {
    this.ensureInitialized();
    this.dirty = true;
    
    if (params) {
      this.db.run(sql, params);
    } else {
      this.db.run(sql);
    }
    
    return { changes: this.db.getRowsModified() };
  }

  /**
   * Save database to file
   */
  async save(): Promise<void> {
    if (!this.dirty || !this.db) return;

    // Prevent concurrent saves
    if (this.savePromise) {
      return this.savePromise;
    }

    this.savePromise = this.doSave();
    await this.savePromise;
    this.savePromise = null;
  }

  private async doSave(): Promise<void> {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      
      // Write to temp file first, then rename (atomic)
      const tempPath = `${this.config.dbPath}.tmp`;
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, this.config.dbPath);
      
      this.dirty = false;
      console.log(`[SQLitePersistence] Saved database to ${this.config.dbPath}`);
    } catch (error) {
      console.error('[SQLitePersistence] Failed to save database:', error);
      throw error;
    }
  }

  /**
   * Create a backup
   */
  async backup(): Promise<string> {
    if (!this.config.backupPath) {
      this.config.backupPath = `${this.config.dbPath}.backup`;
    }

    const backupPath = `${this.config.backupPath}.${Date.now()}`;
    
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(backupPath, buffer);
    
    console.log(`[SQLitePersistence] Created backup at ${backupPath}`);
    return backupPath;
  }

  /**
   * Restore from backup
   */
  async restore(backupPath?: string): Promise<boolean> {
    if (!backupPath && this.config.backupPath) {
      // Find most recent backup
      const backupDir = path.dirname(this.config.backupPath);
      const prefix = path.basename(this.config.backupPath);
      
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(prefix))
        .sort()
        .reverse();
      
      if (backups.length === 0) {
        console.warn('[SQLitePersistence] No backups found');
        return false;
      }
      
      backupPath = path.join(backupDir, backups[0]);
    }

    if (!backupPath || !fs.existsSync(backupPath)) {
      console.warn('[SQLitePersistence] Backup file not found');
      return false;
    }

    try {
      const buffer = fs.readFileSync(backupPath);
      this.db = new (await getSqlJs()).Database(buffer);
      this.dirty = true;
      console.log(`[SQLitePersistence] Restored from ${backupPath}`);
      return true;
    } catch (error) {
      console.error('[SQLitePersistence] Failed to restore:', error);
      return false;
    }
  }

  /**
   * Clean up old backups
   */
  cleanOldBackups(): void {
    if (!this.config.backupPath || !this.config.maxBackupAge) return;

    const backupDir = path.dirname(this.config.backupPath);
    const prefix = path.basename(this.config.backupPath);
    const cutoff = Date.now() - this.config.maxBackupAge;

    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith(prefix));

    for (const backup of backups) {
      const backupPath = path.join(backupDir, backup);
      const stat = fs.statSync(backupPath);
      
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(backupPath);
        console.log(`[SQLitePersistence] Removed old backup: ${backup}`);
      }
    }
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    if (this.dirty) {
      await this.save();
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.initialized = false;
  }

  /**
   * Get database statistics
   */
  getStats(): { size: number; messageCount: number; anchorCount: number } {
    this.ensureInitialized();
    
    let size = 0;
    if (fs.existsSync(this.config.dbPath)) {
      size = fs.statSync(this.config.dbPath).size;
    }

    const messageResult = this.db.exec('SELECT COUNT(*) FROM messages');
    const messageCount = messageResult.length > 0 && messageResult[0].values.length > 0
      ? messageResult[0].values[0][0] as number
      : 0;

    const anchorResult = this.db.exec('SELECT COUNT(*) FROM anchors');
    const anchorCount = anchorResult.length > 0 && anchorResult[0].values.length > 0
      ? anchorResult[0].values[0][0] as number
      : 0;

    return { size, messageCount, anchorCount };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('[SQLitePersistence] Database not initialized');
    }
  }
}

// Export singleton instance
export const sqlitePersistence = new SQLitePersistence();
