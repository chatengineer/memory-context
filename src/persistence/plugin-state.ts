import { SQLitePersistence } from './sqlite-persistence';
import { TypedAnchor } from '../core/typed-anchors';
import { Metadata } from '../types';
import { PredictiveAssembler } from '../core/predictive-assembly';
import { MemoryRecallOptions, MemorySearchOptions } from '../core/jit-engine';

export interface PersistedHierarchyEntry {
  id: string;
  layer: number;
  content: string;
  metadata?: Metadata;
}

export interface PersistedRetrievalCandidate {
  id: string;
  content: string;
  source: 'history' | 'hierarchy';
  layer?: number;
  metadata?: Metadata;
}

export interface SqliteSearchRow {
  id: string;
  content: string;
  source: 'history' | 'hierarchy';
  layer?: number;
  metadata?: Metadata;
  timestamp?: number;
  explanation?: string;
  matchedTerms?: string[];
  provenance?: {
    backend: 'sqlite';
    filters: Record<string, unknown>;
    ranking: 'recency-filtered-like-match';
    scoreBreakdown?: {
      bm25: number;
      heuristic: number;
      filter: number;
      final: number;
    };
  };
}

export interface NormalizedPluginState {
  version?: string;
  savedAt?: number;
  lastContext?: string;
  hierarchyEntries: PersistedHierarchyEntry[];
  rawAnchors: string[];
  typedAnchors: TypedAnchor[];
  retrievalCandidates: PersistedRetrievalCandidate[];
  predictive?: ReturnType<PredictiveAssembler['export']> | null;
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
      CREATE TABLE IF NOT EXISTS state_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS hierarchy_entries (
        id TEXT PRIMARY KEY,
        layer INTEGER NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS raw_anchors (
        content TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS typed_anchors (
        id TEXT PRIMARY KEY,
        anchor_type TEXT NOT NULL,
        anchor_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS retrieval_candidates (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        layer INTEGER,
        metadata TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS predictor_topic_history (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS predictor_message_topics (
        message_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        topic_order INTEGER NOT NULL,
        PRIMARY KEY (message_id, topic_order)
      )
    `);

    this.persistence.run(`
      CREATE TABLE IF NOT EXISTS predictor_transitions (
        source_topic TEXT NOT NULL,
        target_topic TEXT NOT NULL,
        transition_count INTEGER NOT NULL,
        PRIMARY KEY (source_topic, target_topic)
      )
    `);

    this.persistence.run('CREATE INDEX IF NOT EXISTS idx_retrieval_source ON retrieval_candidates(source)');
    this.persistence.run('CREATE INDEX IF NOT EXISTS idx_retrieval_layer ON retrieval_candidates(layer)');
    this.persistence.run('CREATE INDEX IF NOT EXISTS idx_retrieval_updated ON retrieval_candidates(updated_at)');

    await this.persistence.save();
    this.initialized = true;
  }

  async loadState(): Promise<NormalizedPluginState | null> {
    await this.initialize();

    const metaRows = this.persistence.query('SELECT key, value FROM state_meta');
    const meta = new Map(metaRows.map(row => [String(row.key), this.parseJson(row.value)]));

    const hierarchyEntries = this.persistence.query(
      'SELECT id, layer, content, metadata FROM hierarchy_entries ORDER BY layer ASC, updated_at ASC'
    ).map(row => ({
      id: String(row.id),
      layer: Number(row.layer),
      content: String(row.content),
      metadata: this.parseJson(row.metadata)
    }));

    const rawAnchors = this.persistence.query(
      'SELECT content FROM raw_anchors ORDER BY updated_at ASC'
    ).map(row => String(row.content));

    const typedAnchors = this.persistence.query(
      'SELECT anchor_json FROM typed_anchors ORDER BY updated_at ASC'
    ).map(row => this.parseJson(row.anchor_json)).filter(Boolean) as TypedAnchor[];

    const retrievalCandidates = this.persistence.query(
      'SELECT id, content, source, layer, metadata FROM retrieval_candidates ORDER BY updated_at ASC'
    ).map(row => ({
      id: String(row.id),
      content: String(row.content),
      source: String(row.source) as 'history' | 'hierarchy',
      layer: row.layer === null || row.layer === undefined ? undefined : Number(row.layer),
      metadata: this.parseJson(row.metadata)
    }));

    const predictive = this.loadPredictiveState();
    const hasAnyState = hierarchyEntries.length || rawAnchors.length || typedAnchors.length || retrievalCandidates.length || predictive;
    if (!hasAnyState && !meta.size) return null;

    return {
      version: meta.get('version') || undefined,
      savedAt: meta.get('savedAt') || undefined,
      lastContext: meta.get('lastContext') || undefined,
      hierarchyEntries,
      rawAnchors,
      typedAnchors,
      retrievalCandidates,
      predictive
    };
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.initialize();
    this.persistence.run(
      'INSERT OR REPLACE INTO state_meta (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value === undefined ? null : JSON.stringify(value), Date.now()]
    );
    await this.persistence.save();
  }

  async upsertHierarchyEntry(entry: PersistedHierarchyEntry): Promise<void> {
    await this.initialize();
    this.persistence.run(
      'INSERT OR REPLACE INTO hierarchy_entries (id, layer, content, metadata, updated_at) VALUES (?, ?, ?, ?, ?)',
      [entry.id, entry.layer, entry.content, JSON.stringify(entry.metadata || {}), Date.now()]
    );
    await this.persistence.save();
  }

  async replaceHierarchy(entries: PersistedHierarchyEntry[]): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM hierarchy_entries');
    for (const entry of entries) {
      this.persistence.run(
        'INSERT INTO hierarchy_entries (id, layer, content, metadata, updated_at) VALUES (?, ?, ?, ?, ?)',
        [entry.id, entry.layer, entry.content, JSON.stringify(entry.metadata || {}), Date.now()]
      );
    }
    await this.persistence.save();
  }

  async saveRawAnchors(rawAnchors: string[]): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM raw_anchors');
    for (const anchor of rawAnchors) {
      this.persistence.run(
        'INSERT OR REPLACE INTO raw_anchors (content, updated_at) VALUES (?, ?)',
        [anchor, Date.now()]
      );
    }
    await this.persistence.save();
  }

  async saveTypedAnchors(typedAnchors: TypedAnchor[]): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM typed_anchors');
    for (const anchor of typedAnchors) {
      this.persistence.run(
        'INSERT OR REPLACE INTO typed_anchors (id, anchor_type, anchor_json, updated_at) VALUES (?, ?, ?, ?)',
        [anchor.id, anchor.type, JSON.stringify(anchor), Date.now()]
      );
    }
    await this.persistence.save();
  }

  async removeAnchor(anchorIdOrContent: string): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM typed_anchors WHERE id = ?', [anchorIdOrContent]);
    this.persistence.run('DELETE FROM raw_anchors WHERE content = ?', [anchorIdOrContent]);
    await this.persistence.save();
  }

  async upsertRetrievalCandidate(candidate: PersistedRetrievalCandidate): Promise<void> {
    await this.initialize();
    this.persistence.run(
      'INSERT OR REPLACE INTO retrieval_candidates (id, content, source, layer, metadata, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [candidate.id, candidate.content, candidate.source, candidate.layer ?? null, JSON.stringify(candidate.metadata || {}), Date.now()]
    );
    await this.persistence.save();
  }

  async replaceRetrievalCandidates(candidates: PersistedRetrievalCandidate[]): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM retrieval_candidates');
    for (const candidate of candidates) {
      this.persistence.run(
        'INSERT INTO retrieval_candidates (id, content, source, layer, metadata, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [candidate.id, candidate.content, candidate.source, candidate.layer ?? null, JSON.stringify(candidate.metadata || {}), Date.now()]
      );
    }
    await this.persistence.save();
  }

  async appendTopicHistory(topic: string): Promise<void> {
    await this.initialize();
    this.persistence.run('INSERT INTO predictor_topic_history (topic) VALUES (?)', [topic]);
    await this.persistence.save();
  }

  async upsertMessageTopics(messageId: string, topics: string[]): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM predictor_message_topics WHERE message_id = ?', [messageId]);
    topics.forEach((topic, index) => {
      this.persistence.run(
        'INSERT INTO predictor_message_topics (message_id, topic, topic_order) VALUES (?, ?, ?)',
        [messageId, topic, index]
      );
    });
    await this.persistence.save();
  }

  async incrementTransition(sourceTopic: string, targetTopic: string): Promise<void> {
    await this.initialize();
    this.persistence.run(
      `INSERT INTO predictor_transitions (source_topic, target_topic, transition_count)
       VALUES (?, ?, 1)
       ON CONFLICT(source_topic, target_topic)
       DO UPDATE SET transition_count = transition_count + 1`,
      [sourceTopic, targetTopic]
    );
    await this.persistence.save();
  }

  async savePredictiveState(state: ReturnType<PredictiveAssembler['export']>): Promise<void> {
    await this.initialize();
    this.persistence.run('DELETE FROM predictor_topic_history');
    this.persistence.run('DELETE FROM predictor_message_topics');
    this.persistence.run('DELETE FROM predictor_transitions');

    for (const topic of state.topicHistory) {
      this.persistence.run('INSERT INTO predictor_topic_history (topic) VALUES (?)', [topic]);
    }

    state.messageTopics.forEach(([messageId, topics]) => {
      topics.forEach((topic, index) => {
        this.persistence.run(
          'INSERT INTO predictor_message_topics (message_id, topic, topic_order) VALUES (?, ?, ?)',
          [messageId, topic, index]
        );
      });
    });

    state.markovChain.nodes.forEach(([sourceTopic, node]) => {
      node.transitions.forEach(([targetTopic, count]) => {
        this.persistence.run(
          'INSERT INTO predictor_transitions (source_topic, target_topic, transition_count) VALUES (?, ?, ?)',
          [sourceTopic, targetTopic, count]
        );
      });
    });

    await this.persistence.save();
  }

  async searchRetrievalCandidates(query: string, options: MemorySearchOptions = {}): Promise<SqliteSearchRow[]> {
    await this.initialize();
    const clauses: string[] = ['1=1'];
    const params: any[] = [];

    if (query.trim()) {
      clauses.push('LOWER(content) LIKE ?');
      params.push(`%${query.toLowerCase()}%`);
    }
    if (options.source && options.source !== 'all') {
      clauses.push('source = ?');
      params.push(options.source);
    }
    if (options.role) {
      clauses.push("json_extract(metadata, '$.role') = ?");
      params.push(options.role);
    }
    if (options.since !== undefined) {
      clauses.push("CAST(json_extract(metadata, '$.timestamp') AS INTEGER) >= ?");
      params.push(options.since);
    }
    if (options.until !== undefined) {
      clauses.push("CAST(json_extract(metadata, '$.timestamp') AS INTEGER) <= ?");
      params.push(options.until);
    }

    const rows = this.persistence.query(
      `SELECT id, content, source, layer, metadata
       FROM retrieval_candidates
       WHERE ${clauses.join(' AND ')}
       ORDER BY CAST(COALESCE(json_extract(metadata, '$.timestamp'), 0) AS INTEGER) DESC, updated_at DESC
       LIMIT ?`,
      [...params, options.limit || 10]
    );

    return rows.map(row => {
      const metadata = this.parseJson(row.metadata) || {};
      const loweredContent = String(row.content).toLowerCase();
      const loweredQuery = query.toLowerCase().trim();
      const matchedTerms = loweredQuery
        ? loweredQuery.split(/\s+/).filter(Boolean).filter(term => loweredContent.includes(term))
        : [];
      const bm25Component = matchedTerms.length / Math.max(1, loweredQuery.split(/\s+/).filter(Boolean).length || 1);
      const recencyComponent = typeof metadata.timestamp === 'number' && metadata.timestamp > 0
        ? 1
        : 0.5;
      const filterComponent = 1;
      const heuristicComponent = Number(((bm25Component * 0.65) + (recencyComponent * 0.35)).toFixed(4));
      const finalComponent = Number((heuristicComponent * filterComponent).toFixed(4));
      return {
        id: String(row.id),
        content: String(row.content),
        source: String(row.source) as 'history' | 'hierarchy',
        layer: row.layer === null || row.layer === undefined ? undefined : Number(row.layer),
        metadata,
        timestamp: typeof metadata.timestamp === 'number' ? metadata.timestamp : 0,
        explanation: [
          'sqlite-native retrieval',
          query ? `content like "${query}"` : 'no-text-filter',
          options.source ? `source=${options.source}` : null,
          options.role ? `role=${options.role}` : null,
          options.since !== undefined || options.until !== undefined ? 'time-window-match' : null,
          `bm25=${bm25Component.toFixed(4)}`,
          `heuristic=${heuristicComponent.toFixed(4)}`,
          `filter=${filterComponent.toFixed(4)}`
        ].filter(Boolean).join(', '),
        matchedTerms,
        provenance: {
          backend: 'sqlite',
          filters: {
            query,
            source: options.source || 'all',
            role: options.role ?? null,
            since: options.since ?? null,
            until: options.until ?? null,
            limit: options.limit || 10
          },
          ranking: 'recency-filtered-like-match',
          scoreBreakdown: {
            bm25: Number(bm25Component.toFixed(4)),
            heuristic: heuristicComponent,
            filter: filterComponent,
            final: finalComponent
          }
        }
      };
    });
  }

  async recallRetrievalCandidates(options: MemoryRecallOptions = {}): Promise<SqliteSearchRow[]> {
    await this.initialize();
    const clauses: string[] = ['1=1'];
    const params: any[] = [];

    if (options.ids?.length) {
      clauses.push(`id IN (${options.ids.map(() => '?').join(',')})`);
      params.push(...options.ids);
    }
    if (options.source && options.source !== 'all') {
      clauses.push('source = ?');
      params.push(options.source);
    }
    if (options.role) {
      clauses.push("json_extract(metadata, '$.role') = ?");
      params.push(options.role);
    }
    if (options.since !== undefined) {
      clauses.push("CAST(json_extract(metadata, '$.timestamp') AS INTEGER) >= ?");
      params.push(options.since);
    }
    if (options.until !== undefined) {
      clauses.push("CAST(json_extract(metadata, '$.timestamp') AS INTEGER) <= ?");
      params.push(options.until);
    }

    const rows = this.persistence.query(
      `SELECT id, content, source, layer, metadata
       FROM retrieval_candidates
       WHERE ${clauses.join(' AND ')}
       ORDER BY CAST(COALESCE(json_extract(metadata, '$.timestamp'), 0) AS INTEGER) DESC, updated_at DESC
       LIMIT ?`,
      [...params, options.limit || 50]
    );

    return rows.map(row => {
      const metadata = this.parseJson(row.metadata) || {};
      return {
        id: String(row.id),
        content: String(row.content),
        source: String(row.source) as 'history' | 'hierarchy',
        layer: row.layer === null || row.layer === undefined ? undefined : Number(row.layer),
        metadata,
        timestamp: typeof metadata.timestamp === 'number' ? metadata.timestamp : 0,
        explanation: [
          'sqlite-native recall',
          options.source ? `source=${options.source}` : null,
          options.role ? `role=${options.role}` : null,
          options.since !== undefined || options.until !== undefined ? 'time-window-match' : null,
          'bm25=0.0000',
          'heuristic=1.0000',
          'filter=1.0000'
        ].filter(Boolean).join(', '),
        matchedTerms: [],
        provenance: {
          backend: 'sqlite',
          filters: {
            ids: options.ids ?? null,
            source: options.source || 'all',
            role: options.role ?? null,
            since: options.since ?? null,
            until: options.until ?? null,
            limit: options.limit || 50
          },
          ranking: 'recency-filtered-like-match',
          scoreBreakdown: {
            bm25: 0,
            heuristic: 1,
            filter: 1,
            final: 1
          }
        }
      };
    });
  }

  async clear(): Promise<void> {
    await this.initialize();
    for (const table of ['state_meta', 'hierarchy_entries', 'raw_anchors', 'typed_anchors', 'retrieval_candidates', 'predictor_topic_history', 'predictor_message_topics', 'predictor_transitions']) {
      this.persistence.run(`DELETE FROM ${table}`);
    }
    await this.persistence.save();
  }

  async close(): Promise<void> {
    await this.persistence.close();
    this.initialized = false;
  }

  private loadPredictiveState(): ReturnType<PredictiveAssembler['export']> | null {
    const historyColumns = this.persistence.query("PRAGMA table_info('predictor_topic_history')");
    const orderColumn = historyColumns.some(col => String(col.name) === 'seq') ? 'seq' : 'position';
    const topicHistory = this.persistence.query(
      `SELECT topic FROM predictor_topic_history ORDER BY ${orderColumn} ASC`
    ).map(row => String(row.topic));

    const groupedMessageTopics = new Map<string, string[]>();
    const messageTopicRows = this.persistence.query(
      'SELECT message_id, topic, topic_order FROM predictor_message_topics ORDER BY message_id ASC, topic_order ASC'
    );
    for (const row of messageTopicRows) {
      const messageId = String(row.message_id);
      if (!groupedMessageTopics.has(messageId)) groupedMessageTopics.set(messageId, []);
      groupedMessageTopics.get(messageId)!.push(String(row.topic));
    }

    const groupedNodes = new Map<string, { topic: string; count: number; transitions: Array<[string, number]> }>();
    const transitionRows = this.persistence.query(
      'SELECT source_topic, target_topic, transition_count FROM predictor_transitions ORDER BY source_topic ASC, target_topic ASC'
    );
    for (const row of transitionRows) {
      const sourceTopic = String(row.source_topic);
      if (!groupedNodes.has(sourceTopic)) {
        groupedNodes.set(sourceTopic, { topic: sourceTopic, count: 0, transitions: [] });
      }
      const node = groupedNodes.get(sourceTopic)!;
      const count = Number(row.transition_count);
      node.transitions.push([String(row.target_topic), count]);
      node.count += count;
    }

    if (!topicHistory.length && !groupedMessageTopics.size && !groupedNodes.size) {
      return null;
    }

    return {
      topicHistory,
      messageTopics: Array.from(groupedMessageTopics.entries()),
      markovChain: { nodes: Array.from(groupedNodes.entries()) }
    };
  }

  private parseJson(value: unknown): any {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}

export const pluginStateStore = new PluginStateStore();
