# Memory Context Plugin

> Zero-shift JIT hierarchical assembly with quantum anchors for intelligent context management

## Overview

Memory Context is an OpenClaw plugin that provides sophisticated context management for AI assistants. It features:

- **Zero-Shift JIT Assembly**: Rebuilds context from full source on every request
- **Hierarchical Storage**: L0 (hot) → L1 (warm) → L2 (cold) tiers
- **Quantum Anchors**: Type-safe anchors for decisions, states, and references
- **BM25 Search**: Full-text search for context retrieval
- **Multi-Model Support**: Per-model token counting and context limits

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Memory Context Plugin                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ JIT Engine  │  │  Factory    │  │   Hierarchical Context  │  │
│  │             │  │             │  │                         │  │
│  │ • Assembly  │  │ • Async Init│  │  L0: LRU Cache (~50K)   │  │
│  │ • Quantum   │  │ • Singleton │  │  L1: SQLite (~500K)     │  │
│  │ • Shift     │  │ • Lifecycle │  │  L2: Archive (~2M)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ BM25 Index  │  │ Relevance   │  │      Observability      │  │
│  │             │  │             │  │                         │  │
│  │ • FTS       │  │ • Keyword   │  │  • Prometheus Metrics   │  │
│  │ • Ranking   │  │ • Recency   │  │  • Circuit Breakers     │  │
│  │ • Query     │  │ • Priority  │  │  • Audit Logging        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Compression │  │  Security   │  │    Multi-Model Support  │  │
│  │             │  │             │  │                         │  │
│  │ • Gzip L1   │  │ • Sanitize  │  │  • GPT-4/Claude/Gemini  │  │
│  │ • Brotli L2 │  │ • SQL Safe  │  │  • Token Counting       │  │
│  │ • Auto      │  │ • Audit Log │  │  • Context Limits       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Clone to OpenClaw extensions directory
cd ~/.openclaw/extensions
git clone https://github.com/chatengineer/memory-context.git

# Install dependencies
cd memory-context
npm install

# Build TypeScript
npm run build
```

## Quick Start

```typescript
import { createMemoryContext } from './src/core/factory';

// Initialize the memory context engine
const engine = await createMemoryContext({
  maxContextTokens: 100000,
  enablePredictiveAssembly: true
});

// Add messages to history
await engine.addMessage({
  role: 'user',
  content: 'What is the capital of France?'
});

// Build context for AI
const context = engine.buildContext();
console.log(context);
```

## Core Components

### 1. JIT Engine

The Just-In-Time engine rebuilds context from full source on every request, eliminating context drift:

```typescript
import { JITEngine } from './src/core/jit-engine';

const jit = new JITEngine({
  rebuildOnRequest: true,
  cacheQuantumAnchors: true
});

const assembly = jit.assemble(history, anchors);
```

### 2. Hierarchical Storage

Three-tier storage system for optimal performance:

```typescript
import { TieredStorage } from './src/persistence/tiered-storage';

const storage = new TieredStorage();
await storage.initialize();

// Store message
const id = await storage.store('Important message content');

// Retrieve message
const message = await storage.retrieve(id);

// Get tier statistics
const stats = storage.getTierStats();
// { L0: { count: 10, tokens: 5000 }, L1: {...}, L2: {...} }
```

### 3. Quantum Anchors

Type-safe anchors for preserving critical context:

```typescript
import { AnchorFactory, DecisionAnchor } from './src/core/typed-anchors';

// Create a decision anchor
const decision = AnchorFactory.createDecision({
  decision: 'Use PostgreSQL for primary database',
  rationale: 'Better JSON support and ACID compliance',
  alternatives: ['MongoDB', 'MySQL']
});

// Register anchor
registry.register(decision);

// Serialize for storage
const serialized = AnchorSerializer.serialize(decision);
```

### 4. BM25 Search

Full-text search with BM25 ranking:

```typescript
import { BM25Index } from './src/search/bm25-index';

const index = new BM25Index();

// Index documents
index.addDocument({ id: '1', content: 'Important decision made today' });
index.addDocument({ id: '2', content: 'Bug fix deployed successfully' });

// Search
const results = index.search('decision important', 10);
// [{ id: '1', score: 2.34, terms: ['decision', 'important'] }]
```

### 5. Multi-Model Support

Per-model token counting and context limits:

```typescript
import { MultiModelTokenCounter, detectModel } from './src/utils/multi-model';

const counter = new MultiModelTokenCounter('gpt-4o');

// Count tokens
const tokens = counter.count('Hello, world!');

// Get context limit
const limit = counter.getSafeContextLimit(); // 123500 tokens

// Calculate cost
const cost = counter.calculateCost(1000, 500); // $0.01
```

## API Reference

### Factory

```typescript
interface MemoryContextConfig {
  maxContextTokens?: number;      // Default: 100000
  enablePredictiveAssembly?: boolean;
  enableCompression?: boolean;
  persistPath?: string;
}

function createMemoryContext(config?: MemoryContextConfig): Promise<MemoryContextEngine>;
```

### Tiered Storage

```typescript
class TieredStorage {
  initialize(): Promise<void>;
  store(content: string, metadata?: object): Promise<string>;
  retrieve(id: string): Promise<Message | null>;
  getAllMessages(): Promise<Message[]>;
  getTotalTokens(): number;
  getTierStats(): TierStats;
  clear(): Promise<void>;
}
```

### BM25 Index

```typescript
class BM25Index {
  addDocument(doc: { id: string; content: string }): void;
  removeDocument(id: string): boolean;
  search(query: string, limit?: number): SearchResult[];
  getStats(): IndexStats;
  clear(): void;
}
```

### Token Counter

```typescript
class TokenCounter {
  count(text: string): number;
  truncate(text: string, maxTokens: number): TruncateResult;
  encode(text: string): number[];
  decode(tokens: number[]): string;
}
```

## Configuration

### Environment Variables

```bash
MEMORY_CONTEXT_MAX_TOKENS=100000
MEMORY_CONTEXT_PERSIST_PATH=/path/to/storage
MEMORY_CONTEXT_ENABLE_COMPRESSION=true
MEMORY_CONTEXT_LOG_LEVEL=info
```

### Plugin Configuration

```json
{
  "maxContextTokens": 100000,
  "tiers": {
    "L0": { "maxTokens": 50000, "type": "lru" },
    "L1": { "maxTokens": 500000, "type": "sqlite" },
    "L2": { "maxTokens": 2000000, "type": "archive" }
  },
  "search": {
    "algorithm": "bm25",
    "k1": 1.2,
    "b": 0.75
  },
  "compression": {
    "L1": "gzip",
    "L2": "brotli"
  }
}
```

## Performance

### Benchmarks

| Operation | Avg Time | Notes |
|-----------|----------|-------|
| Token count (short) | 0.05ms | ~14 chars |
| Token count (medium) | 0.08ms | ~80 chars |
| Token count (long) | 1.2ms | ~6000 chars |
| BM25 index | 0.3ms | per document |
| BM25 search | 0.5ms | 1000 docs |

### Memory Usage

- L0 Cache: ~10MB for 50K tokens
- SQLite DB: ~50MB for 500K tokens
- Archive: ~100MB for 2M tokens

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration

# Run benchmarks
npm run benchmark
```

## Troubleshooting

### Common Issues

**Q: Context not building correctly**

Check that JIT mode is enabled and history is properly initialized:
```typescript
const engine = await createMemoryContext({ enableJIT: true });
```

**Q: High memory usage**

Reduce tier sizes or enable compression:
```typescript
const storage = new TieredStorage({
  L0MaxTokens: 30000,
  compressionEnabled: true
});
```

**Q: Search not finding results**

Ensure documents are indexed before searching:
```typescript
index.addDocument({ id: '1', content: 'Your content' });
// Wait for indexing
await new Promise(r => setTimeout(r, 100));
const results = index.search('content');
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -am 'Add my feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Submit a Pull Request

## Changelog

### v1.4.0 (2026-02-14)
- Added Compression (gzip/brotli) for L2 tier
- Added Fallback Mechanisms with graceful degradation
- Added Comprehensive Test Suite (Jest)
- Added Security Hardening utilities
- Added Multi-Model Support (GPT-4, Claude, Gemini, Llama, Mistral)

### v1.3.0 (2026-02-13)
- Added BM25 Full-Text Search Index
- Added Advanced Relevance Scoring
- Added Typed Quantum Anchors (Zod validation)
- Added Predictive Assembly (Markov chains)

### v1.2.0 (2026-02-12)
- Added SQLite Persistence Layer
- Added Tiered Storage (L0/L1/L2)
- Added Memory Context Factory
- Added Observability & Metrics

### v1.1.0 (2026-02-11)
- Fixed Token Counting accuracy
- Added Circuit Breaker pattern
- Added Memory Bounds management

### v1.0.0 (2026-02-10)
- Initial release
- Zero-shift JIT assembly
- Hierarchical context management
- Quantum anchor system

## License

MIT License - See [LICENSE](LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/chatengineer/memory-context/issues)
- **Discussions**: [GitHub Discussions](https://github.com/chatengineer/memory-context/discussions)
