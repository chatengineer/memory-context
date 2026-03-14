import { SQLitePersistence } from './sqlite-persistence';

export interface MemoryPluginSnapshot {
  version: string;
  savedAt: number;
  hierarchy?: {
    layers: string[][];
  };
  immunity?: {
    raw: string[];
    typed: unknown[];
  };
  predictive?: unknown;
  engine?: unknown;
}

export interface PluginStateStoreConfig {
  statePath: string;
  autoSaveInterval?: number;
}

const DEFAULT_CONFIG: PluginStateStoreConfig = {
  statePath: '.openclaw/memory-context/plugin-state.db',
  autoSaveInterval: 30000
};

export class PluginStateStore {
  private config: PluginStateStoreConfig;
  private persistence: SQLitePersistence;
  private initialized = false;

  constructor(config?: Partial<PluginStateStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistence = new SQLitePersistence({
      dbPath: this.config.statePath,
      autoSaveInterval: this.config.autoSaveInterval
    });
  }

  getPath(): string {
    return this.config.statePath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.persistence.initialize();
    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS plugin_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.initialized = true;
  }

  async load(): Promise<MemoryPluginSnapshot | null> {
    await this.initialize();
    const rows = this.persistence.query('SELECT value FROM plugin_state WHERE key = ?', ['snapshot']);
    if (!rows.length || typeof rows[0].value !== 'string') {
      return null;
    }

    try {
      return JSON.parse(rows[0].value as string) as MemoryPluginSnapshot;
    } catch {
      return null;
    }
  }

  async save(snapshot: MemoryPluginSnapshot): Promise<void> {
    await this.initialize();
    this.persistence.run(
      `INSERT OR REPLACE INTO plugin_state (key, value, updated_at) VALUES (?, ?, ?)`,
      ['snapshot', JSON.stringify(snapshot), Date.now()]
    );
    await this.persistence.save();
  }

  async clear(): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM plugin_state');
    await this.persistence.save();
  }

  async close(): Promise<void> {
    await this.persistence.close();
    this.initialized = false;
  }
}

export const pluginStateStore = new PluginStateStore();
