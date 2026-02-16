/**
 * SQLite Persistence Manager - Issue #29: Proper Error Handling
 */
import * as fs from "fs";
import * as path from "path";

let SQL: any = null;
async function getSqlJs(): Promise<any> {
  if (!SQL) {
    const sqlJs = await import("sql.js");
    SQL = await sqlJs.default();
  }
  return SQL;
}

export interface PersistenceConfig {
  dbPath: string;
  backupPath?: string;
  autoSaveInterval?: number;
  enableWAL?: boolean;
  maxBackupAge?: number;
  onSaveError?: (error: Error) => void;
}

export interface PersistenceErrorState {
  lastError: Error | null;
  lastErrorTime: number | null;
  errorCount: number;
  consecutiveErrors: number;
  isHealthy: boolean;
}

const DEFAULT_CONFIG: PersistenceConfig = {
  dbPath: ".openclaw/memory-context/history.db",
  autoSaveInterval: 30000,
  enableWAL: true,
  maxBackupAge: 7 * 24 * 60 * 60 * 1000
};

const SCHEMA_VERSION = 1;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_info(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
`;

export class SQLitePersistence {
  private db: any = null;
  private config: PersistenceConfig;
  private initialized: boolean = false;
  private dirty: boolean = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private savePromise: Promise<void> | null = null;

  private lastError: Error | null = null;
  private lastErrorTime: number | null = null;
  private errorCount: number = 0;
  private consecutiveErrors: number = 0;

  constructor(config?: Partial<PersistenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const SQL = await getSqlJs();
    const dbDir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    if (fs.existsSync(this.config.dbPath)) {
      try {
        const buffer = fs.readFileSync(this.config.dbPath);
        this.db = new SQL.Database(buffer);
      } catch (error) {
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    await this.applySchema();

    if (this.config.autoSaveInterval) {
      this.autoSaveTimer = setInterval(() => {
        this.save().catch((error: Error) => {
          this.trackError(error);
          if (this.config.onSaveError) this.config.onSaveError(error);
        });
      }, this.config.autoSaveInterval);
      this.autoSaveTimer.unref(); // Allow process to exit
    }

    this.initialized = true;
  }

  private trackError(error: Error): void {
    this.lastError = error;
    this.lastErrorTime = Date.now();
    this.errorCount++;
    this.consecutiveErrors++;
  }

  private resetErrorState(): void {
    this.consecutiveErrors = 0;
  }

  getErrorState(): PersistenceErrorState {
    const recentError = this.lastErrorTime && (Date.now() - this.lastErrorTime) < 60000;
    const isHealthy = this.consecutiveErrors < 3 && (!recentError || this.consecutiveErrors === 0);
    return { lastError: this.lastError, lastErrorTime: this.lastErrorTime, errorCount: this.errorCount, consecutiveErrors: this.consecutiveErrors, isHealthy };
  }

  private async applySchema(): Promise<void> {
    this.db.run(SCHEMA);
    const result = this.db.exec("SELECT version FROM schema_info");
    const currentVersion = result.length && result[0].values.length ? result[0].values[0][0] as number : 0;
    if (currentVersion < SCHEMA_VERSION) {
      this.db.run("INSERT INTO schema_info (version, applied_at) VALUES (?, ?)", [1, Date.now()]);
    }
    this.dirty = true;
  }

  getDb(): any { return this.db; }

  exec(sql: string, params?: any[]): any {
    this.ensureInitialized();
    this.dirty = true;
    return params ? this.db.run(sql, params) : this.db.exec(sql);
  }

  query(sql: string, params?: any[]): any[] {
    this.ensureInitialized();
    if (params) {
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      const results: any[] = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    }
    const result = this.db.exec(sql);
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row: any[]) => {
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => obj[col] = row[i]);
      return obj;
    });
  }

  run(sql: string, params?: any[]): { changes: number } {
    this.ensureInitialized();
    this.dirty = true;
    params ? this.db.run(sql, params) : this.db.run(sql);
    return { changes: this.db.getRowsModified() };
  }

  async save(): Promise<void> {
    if (!this.dirty || !this.db) return;
    if (this.savePromise) return this.savePromise;
    this.savePromise = this.doSave();
    await this.savePromise;
    this.savePromise = null;
  }

  private async doSave(): Promise<void> {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tempPath = `${this.config.dbPath}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, this.config.dbPath);
    this.dirty = false;
    this.resetErrorState();
  }

  async backup(): Promise<string> {
    if (!this.config.backupPath) this.config.backupPath = `${this.config.dbPath}.backup`;
    const backupPath = `${this.config.backupPath}.${Date.now()}`;
    const data = this.db.export();
    fs.writeFileSync(backupPath, Buffer.from(data));
    return backupPath;
  }

  async restore(backupPath?: string): Promise<boolean> {
    if (!backupPath && this.config.backupPath) {
      const backupDir = path.dirname(this.config.backupPath);
      const prefix = path.basename(this.config.backupPath);
      const backups = fs.readdirSync(backupDir).filter((f: string) => f.startsWith(prefix)).sort().reverse();
      if (backups.length === 0) return false;
      backupPath = path.join(backupDir, backups[0]);
    }
    if (!backupPath || !fs.existsSync(backupPath)) return false;
    const buffer = fs.readFileSync(backupPath);
    this.db = new (await getSqlJs()).Database(buffer);
    this.dirty = true;
    return true;
  }

  cleanOldBackups(): void {
    if (!this.config.backupPath || !this.config.maxBackupAge) return;
    const backupDir = path.dirname(this.config.backupPath);
    const prefix = path.basename(this.config.backupPath);
    const cutoff = Date.now() - this.config.maxBackupAge;
    const backups = fs.readdirSync(backupDir).filter((f: string) => f.startsWith(prefix));
    for (const backup of backups) {
      const backupPath = path.join(backupDir, backup);
      const stat = fs.statSync(backupPath);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(backupPath);
    }
  }

  async close(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.dirty) await this.save();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  getStats(): { size: number; messageCount: number } {
    this.ensureInitialized();
    let size = 0;
    if (fs.existsSync(this.config.dbPath)) size = fs.statSync(this.config.dbPath).size;
    const msgResult = this.db.exec("SELECT COUNT(*) FROM messages");
    const messageCount = msgResult.length && msgResult[0].values.length ? msgResult[0].values[0][0] as number : 0;
    return { size, messageCount };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) throw new Error("[SQLitePersistence] Database not initialized");
  }
}

export const sqlitePersistence = new SQLitePersistence();