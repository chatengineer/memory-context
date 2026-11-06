# Memory Context Plugin

**An advanced context preservation system for OpenClaw.**

JIT hierarchical assembly, tiered storage, typed anchors, and shift-immunity safeguards for production-grade context management.

**Version: 1.5.0**

---

## Overview & Philosophy

The `memory-context` plugin represents a radical departure from traditional context management systems. Instead of incrementally updating and compacting context windows like conventional approaches, **memory-context rebuilds context from scratch on every single call** using Just-In-Time (JIT) assembly techniques.

### Core Philosophy

1. **Rebuild Instead of Drift** - Context is rebuilt on demand rather than incrementally mutated until it becomes stale.
2. **Shift-Immunity Safeguards** - Anchors and lifecycle hooks help preserve continuity across model switches, session boundaries, and system events.
3. **Hierarchical Organization** - Five distinct layers (L0-L4) provide clear separation of concerns.
4. **High Utilization with Safety Margin** - The default configuration targets strong token utilization without running the window at a dangerous 100%.
5. **Bounded Production Memory** - Tiered storage prevents unbounded growth while preserving useful history.

### Key Differentiator

Traditional systems:
- Accumulate context incrementally
- Compact when windows fill up
- Lose information during compaction
- Shift context during model changes

**Memory Context:**
- Rebuilds fresh every call
- Never compacts
- Preserves all history via tiered storage
- Maintains continuity via quantum anchors

### What It Does
`memory-context` is a deterministic context-preservation engine for [OpenClaw](https://github.com/openclaw) agents. Instead of progressively degrading context quality through lossy summarization or sliding-window compaction, it reconstructs prompt context Just-In-Time (JIT) on every turn from multi-tiered persistence (LRU memory, SQLite, and cold archive). It injects typed "quantum anchors" so essential decisions, user directives, and architectural constraints never drift across session boundaries or model switches.

### Who It's For
- **Agent Developers & Power Users**: Anyone running long-horizon autonomous tasks in OpenClaw who needs deterministic context without losing early instructions or architectural decisions.
- **Multi-Model Workflows**: Teams switching dynamically between LLMs (e.g. Gemini, Claude, GPT) where token budgets and context behavior differ, requiring zero-shift continuity.
- **Enterprise & Open-Source Maintainers**: Developers who require local, observable (Prometheus-compatible), crash-safe memory without external vector database server dependencies.

### What It's Built With
- **Language**: TypeScript 5 (Node.js >= 20)
- **Local Persistence**: Pure-JS SQLite (`sql.js`) with zero native C++ binding dependencies, plus in-memory `lru-cache`
- **Search & Ranking**: Lexical BM25 index with Porter stemming and multi-factor heuristic scoring
- **Token Accuracy**: Byte-pair encoding tokenization powered by `gpt-tokenizer`
- **Validation & Reliability**: Zod v4 schemas, circuit-breaker fault tolerance, and Prometheus metrics registry
- **Testing & Automation**: Cross-platform Jest test suite and GitHub Actions CI matrix

---

## Quick Start & How to Run It

### Prerequisites
- Node.js `>= 20.0.0`
- npm `>= 10.0.0`

### Installation & Build

```bash
# 1. Clone the repository
git clone https://github.com/chatengineer/memory-context.git
cd memory-context

# 2. Install dependencies
npm ci

# 3. Verify plugin metadata and compile TypeScript
npm run verify:metadata
npm run build
```

### Running Tests

```bash
# Run all unit and integration tests (cross-platform on Windows, macOS, Linux)
npm test

# Run tests with complete coverage reporting
npm run test:coverage
```

### Enabling in OpenClaw

Add `memory-context` to your OpenClaw configuration file (`openclaw.json` or plugin config):

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-context"
    },
    "entries": {
      "memory-context": {
        "enabled": true,
        "config": {
          "mode": "jit",
          "hierarchyLevels": 5,
          "targetUtilization": 0.95,
          "enableShiftImmunity": true,
          "enableQuantumAnchors": true
        }
      }
    }
  }
}
```

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY CONTEXT v1.5.0                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   JIT Engine │  │   Quantum    │  │   Budget     │       │
│  │   (Rebuild)  │  │   Anchors    │  │   Manager    │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           HIERARCHICAL CONTEXT (L0-L4)               │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ L4: Infinite    │ Global, immutable anchors         │   │
│  │ L3: Core        │ Plugin directives, identity       │   │
│  │ L2: Persistent  │ Long-term knowledge               │   │
│  │ L1: Session     │ Conversation session              │   │
│  │ L0: Working     │ Ephemeral per-turn context        │   │
│  └─────────┬────────────────────────────────────────────┘   │
│            │                                                 │
│            ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              TIERED STORAGE (NEW in v1.2.0)           │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ L0 (Hot): LRU Cache   │ ~50K tokens, instant access  │   │
│  │ L1 (Warm): SQLite     │ ~500K tokens, searchable     │   │
│  │ L2 (Cold): Archive    │ ~2M tokens, long-term        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. JIT Engine (`src/core/jit-engine.ts`)

The heart of the system. Rebuilds context from complete source on every call.

**Key Features:**
- Gathers all hierarchical layers (L0-L4)
- Retrieves full conversation history
- Computes relevance scores
- Applies token budget
- Injects quantum anchors

### 2. Memory Context Factory (`src/core/factory.ts`) - NEW in v1.2.0

Async factory pattern for proper initialization.

**Key Features:**
- Thread-safe singleton pattern
- Async initialization (no constructor race conditions)
- Dependency injection for all components
- Lazy loading support

```typescript
import { createMemoryContext, MemoryContextFactory } from 'memory-context';

// Simple usage
const engine = await createMemoryContext();

// Advanced usage with config
const factory = new MemoryContextFactory({
  maxContextTokens: 128000,
  targetUtilization: 0.95
});
await factory.initialize();
```

### 3. Hierarchical Context (`src/core/hierarchical-context.ts`)

Five layers providing clear separation:

| Layer | Name | Purpose | Retention |
|-------|------|---------|-----------|
| L0 | Working | Ephemeral per-turn context | Turn-by-turn |
| L1 | Session | Current conversation session | Session duration |
| L2 | Persistent | Long-term knowledge | Cross-session |
| L3 | Core | Plugin directives, identity | Permanent |
| L4 | Infinite | Global immutable anchors | Immutable |

### 4. Tiered Storage (`src/persistence/tiered-storage.ts`) - NEW in v1.2.0

Bounded memory with automatic tier management.

| Tier | Storage | Capacity | Access Time |
|------|---------|----------|-------------|
| L0 (Hot) | LRU Cache | ~50K tokens | Instant |
| L1 (Warm) | SQLite | ~500K tokens | Fast |
| L2 (Cold) | Archive | ~2M tokens | Slower |

**Features:**
- Automatic promotion/demotion between tiers
- Configurable size limits
- Eviction policies (LRU, LFU, FIFO)
- Token-aware sizing

### 5. SQLite Persistence (`src/persistence/sqlite-persistence.ts`) - NEW in v1.2.0

File-based persistence with recovery support.

**Features:**
- Pure-JS SQLite via sql.js (no native dependencies)
- WAL-like auto-save with configurable intervals
- Automatic backup and recovery
- Schema migrations
- Quantum anchors table for shift-immune content

### 6. BM25 Search Index (`src/search/bm25-index.ts`) - NEW in v1.3.0

Full-text search with probabilistic ranking.

**Features:**
- Term frequency normalization (no length bias)
- Inverse document frequency weighting
- Configurable k1 and b parameters
- Stop word filtering
- Simplified Porter stemmer
- Export/import for persistence

```typescript
import { BM25Index } from 'memory-context';

const index = new BM25Index();
index.addDocument({ id: 'msg1', content: 'Important decision made today' });
const results = index.search('decision', 10);
```

### 7. Advanced Relevance Scoring (`src/heuristics/advanced-relevance.ts`) - NEW in v1.3.0

Multi-factor relevance scoring.

**Factors:**
- **Keyword (35%)**: BM25-based keyword matching
- **Recency (25%)**: Time decay with configurable half-life
- **Priority (20%)**: Boost for priority keywords
- **Density (10%)**: Semantic information density
- **Overlap (10%)**: Context window overlap

### 8. Observability (`src/observability/metrics.ts`) - NEW in v1.4.0

Comprehensive monitoring and metrics.

**Features:**
- Prometheus-compatible metrics export
- Counter, gauge, histogram types
- Performance histograms with configurable buckets
- Health check registration and execution
- Structured logging with JSON output
- Memory and resource usage tracking

```typescript
import { memoryContextMetrics, metricsRegistry } from 'memory-context';

// Record operations
memoryContextMetrics.recordContextBuild(150, 5000, true);
memoryContextMetrics.recordSearch(25, 10, 50);

// Export Prometheus metrics
const prometheus = metricsRegistry.exportPrometheus();
```

### 9. Input Validation (`src/validation/schemas.ts`) - NEW in v1.4.0

Type-safe validation with Zod.

**Schemas:**
- Message, StoredMessage
- TieredStorageConfig, MemoryContextConfig
- RelevanceConfig, BM25Config
- SearchQuery, QuantumAnchor

```typescript
import { validateMessage, isValidMessage } from 'memory-context';

const result = validateMessage({ content: 'Hello' });
if (result.success) {
  console.log(result.data.content);
}
```

### 10. Circuit Breaker (`src/utils/circuit-breaker.ts`)

Prevents cascading failures.

**States:**
- CLOSED: Normal operation
- OPEN: Failing fast
- HALF_OPEN: Testing recovery

### 11. Token Counter (`src/utils/token-counter.ts`)

Accurate LLM tokenization.

**Features:**
- Uses gpt-tokenizer for accurate counting
- Fallback estimation with ±10% accuracy
- Truncation with binary search

---

## Configuration

### Full Configuration Schema

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-context"
    },
    "entries": {
      "memory-context": {
        "enabled": true,
        "config": {
          "mode": "jit",
          "maxContextTokens": 128000,
          "targetUtilization": 0.95,
          "zeroShiftEnabled": true,
          "quantumAnchorsEnabled": true,
          "persistenceEnabled": true,
          "tieredStorageConfig": {
            "l0MaxTokens": 50000,
            "l1MaxTokens": 500000,
            "l2MaxTokens": 2000000,
            "evictionPolicy": "lru"
          }
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxContextTokens` | number | `128000` | Maximum context tokens |
| `targetUtilization` | number | `0.95` | Target token usage (0.5-1.0) |
| `zeroShiftEnabled` | boolean | `true` | Enable zero-shift mode |
| `quantumAnchorsEnabled` | boolean | `true` | Use quantum anchors |
| `persistenceEnabled` | boolean | `true` | Enable SQLite persistence |
| `tieredStorageConfig.l0MaxTokens` | number | `50000` | L0 (hot) cache limit |
| `tieredStorageConfig.l1MaxTokens` | number | `500000` | L1 (SQLite) limit |
| `tieredStorageConfig.l2MaxTokens` | number | `2000000` | L2 (archive) limit |

---

## Usage Examples

### Basic Plugin Usage

```typescript
import { MemoryContextPlugin } from 'memory-context';

// Plugin initializes automatically with OpenClaw
// No manual setup required
```

### Using the Factory Pattern

```typescript
import { createMemoryContext, MemoryContextFactory } from 'memory-context';

// Simple: create engine directly
const engine = await createMemoryContext({
  maxContextTokens: 200000
});

// Advanced: use factory singleton
const factory = MemoryContextFactory.getInstance();
await factory.initialize();

const history = factory.getHistory();
const storage = factory.getStorage();
```

### Search with BM25

```typescript
import { BM25Index } from 'memory-context';

const index = new BM25Index({ k1: 1.5, b: 0.8 });

// Add documents
index.addDocument({ id: '1', content: 'The decision was made to use TypeScript' });
index.addDocument({ id: '2', content: 'Priority issue: fix the memory leak' });

// Search
const results = index.search('decision priority', 5);
console.log(results); // [{ id: '2', score: 1.23 }, { id: '1', score: 0.85 }]

// Get stats
console.log(index.getStats());
// { documentCount: 2, termCount: 15, vocabularySize: 12, avgDocLength: 7.5 }
```

### Observability & Metrics

```typescript
import { metricsRegistry, memoryContextMetrics } from 'memory-context';

// Time an operation
const result = await metricsRegistry.timeOperation('context_build', async () => {
  return engine.buildContext(message);
});

// Get Prometheus metrics
const prometheus = metricsRegistry.exportPrometheus();

// Get health check
await metricsRegistry.runHealthCheck('storage');
```

---

## API Reference

### Tools Exposed to Agents

| Tool | Purpose | Arguments |
|------|---------|-----------|
| `memory_context_build` | Rebuild context manually | `force?: boolean` |
| `memory_context_stats` | Get context statistics | — |
| `memory_context_search` | Search with BM25 | `query: string, limit?: number` |
| `memory_context_anchor` | Add quantum anchor | `anchor: string` |
| `memory_context_tiers` | Get tier statistics | — |

### Exported Classes

```typescript
// Core
export { JITEngine } from './src/core/jit-engine';
export { MemoryContextFactory, createMemoryContext } from './src/core/factory';
export { HierarchicalContext, Layer } from './src/core/hierarchical-context';
export { ShiftImmunity } from './src/core/shift-immunity';
export { BudgetManager } from './src/core/budget-manager';

// Persistence
export { TieredStorage } from './src/persistence/tiered-storage';
export { SQLitePersistence } from './src/persistence/sqlite-persistence';
export { FullHistory } from './src/persistence/full-history';

// Search
export { BM25Index } from './src/search/bm25-index';

// Heuristics
export { AdvancedRelevanceScorer, computeRelevanceScore } from './src/heuristics/advanced-relevance';

// Observability
export { MetricsRegistry, StructuredLogger, MemoryContextMetrics } from './src/observability/metrics';

// Validation
export { 
  validateMessage, 
  validateSearchQuery,
  isValidMessage,
  schemas 
} from './src/validation/schemas';

// Utils
export { TokenCounter } from './src/utils/token-counter';
export { CircuitBreaker, CircuitState } from './src/utils/circuit-breaker';
```

---

## Performance Characteristics

### Memory Usage
- **L0 Cache:** O(n) where n = hot tier capacity
- **Total:** Bounded by tier limits
- **Overhead:** ~5% for anchor storage + index

### Latency
- **L0 access:** <1ms (LRU cache)
- **L1 access:** <10ms (SQLite)
- **JIT rebuild:** <50ms for typical contexts
- **BM25 search:** O(n) with ranking

### Scaling
- **Documents:** Limited by L2 tier capacity
- **Concurrent access:** Thread-safe via factory
- **Throughput:** ~1000 ops/sec

---

## Comparison

### vs memory-chatengineer

| Feature | memory-context | memory-chatengineer |
|---------|---------------|---------------------|
| Compaction | **Never** | Optional/adaptive |
| Shift Immunity | Native | Plugin-level |
| JIT Rebuilding | **Always** | Configurable |
| Hierarchy | 5 layers | Configurable |
| Search | BM25 | Linear |
| Storage | Tiered | In-memory |

### vs memory-lancedb

| Feature | memory-context | memory-lancedb |
|---------|---------------|----------------|
| Storage | Tiered (L0/L1/L2) | Vector database |
| Search | BM25 + relevance | Semantic (LanceDB) |
| Dependencies | sql.js (pure JS) | LanceDB server |
| Setup | Zero-config | Requires DB |
| Best For | Context management | Semantic search |

---

## GitHub Workflows

This repository now includes production-oriented GitHub automation:

- **CI**: Node 20/22 build and test matrix
- **Coverage**: Jest coverage generation with LCOV + HTML artifacts
- **Release**: tag/manual release workflow that validates, builds, tests, and packages the plugin
- **Dependency Review**: PR-time dependency risk checks

### Local equivalents

```bash
npm run verify:metadata
npm run build
npm test
npm run test:coverage
npm run ci
```

## Troubleshooting

### Issue: "Cannot load plugin"

**Solution:**
1. Verify TypeScript compiled: `npm run build`
2. Check `index.ts` exists at root
3. Install dependencies: `npm install`

### Issue: SQLite initialization fails

**Solution:**
- Ensure write permissions for persistence path
- Check disk space for database
- Review auto-save interval settings

### Issue: Search returns no results

**Solution:**
- Verify documents were indexed
- Check minimum term length setting
- Review stop word configuration

---

## Changelog

See the complete release history in [CHANGELOG.md](CHANGELOG.md).

### v1.5.0 (2026-03-14)
- Added GitHub Actions workflows for CI, release packaging, and dependency review
- Fixed Jest coverage reporter output (`lcov` instead of broken `lcv`)
- Synchronized package and plugin manifest versions and metadata
- Added repository packaging/license metadata and a metadata verification script

### v1.4.0 (2026-02-14)
- Added observability with Prometheus metrics
- Added input validation with Zod schemas
- Added structured logging with JSON output
- Added health check system

### v1.3.0 (2026-02-14)
- Added BM25 search index for keyword search
- Added advanced multi-factor relevance scoring
- Improved relevance with recency decay

### v1.2.0 (2026-02-14)
- Added tiered storage (L0/L1/L2) for bounded memory
- Added factory pattern for async initialization
- Added SQLite persistence with recovery

### v1.1.0 (2026-02-13)
- Added accurate token counting with gpt-tokenizer
- Added circuit breaker pattern for fault tolerance
- Fixed memory bounds preparation

### v1.0.0 (2026-02-13)
- Initial release
- JIT engine with zero-shift mode
- Hierarchical context (L0-L4)
- Quantum anchors for shift immunity
- Budget manager with 100% utilization

---

## Roadmap

Planned work (docs, manifest/implementation parity, durable cold tier, type safety, performance, packaging) is tracked in [ROADMAP.md](ROADMAP.md).

---

## License

MIT License - See LICENSE file for details.

---

## Summary

**Memory Context v1.5.0** is the definitive solution for:
- Agents requiring perfect context continuity
- Systems where compaction is unacceptable
- Applications needing guaranteed recovery
- Users demanding 100% token utilization
- Production deployments requiring observability

**7 GitHub Issues Resolved:**
- #2: Unbounded Memory Growth (Tiered Storage)
- #3: Async Constructor (Factory Pattern)
- #5: SQLite Persistence Layer
- #6: BM25 Index
- #7: Advanced Relevance Scoring
- #8: Observability/Metrics
- #10: Input Validation

**Repository:** [github.com/chatengineer/memory-context](https://github.com/chatengineer/memory-context) (Public)
