import * as fs from 'fs';
import * as path from 'path';

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
}

const DEFAULT_CONFIG: PluginStateStoreConfig = {
  statePath: '.openclaw/memory-context/plugin-state.json'
};

export class PluginStateStore {
  private config: PluginStateStoreConfig;

  constructor(config?: Partial<PluginStateStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getPath(): string {
    return this.config.statePath;
  }

  async load(): Promise<MemoryPluginSnapshot | null> {
    if (!fs.existsSync(this.config.statePath)) {
      return null;
    }

    try {
      const raw = await fs.promises.readFile(this.config.statePath, 'utf8');
      return JSON.parse(raw) as MemoryPluginSnapshot;
    } catch {
      return null;
    }
  }

  async save(snapshot: MemoryPluginSnapshot): Promise<void> {
    const dir = path.dirname(this.config.statePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = `${this.config.statePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(snapshot, null, 2), 'utf8');
    await fs.promises.rename(tempPath, this.config.statePath);
  }

  async clear(): Promise<void> {
    if (fs.existsSync(this.config.statePath)) {
      await fs.promises.unlink(this.config.statePath);
    }
  }
}

export const pluginStateStore = new PluginStateStore();
