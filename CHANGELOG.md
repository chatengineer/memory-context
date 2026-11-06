# Changelog

All notable changes to the `memory-context` project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Planned work for upcoming milestones is tracked in [ROADMAP.md](ROADMAP.md) and active GitHub milestone issues.

---

## [1.5.0] - 2026-03-14

### Added
- GitHub Actions CI workflow for Node 20 and Node 22 matrix builds and tests.
- Release packaging automation (`release.yml`) for plugin distribution.
- Automated PR-time dependency review workflow.
- Metadata verification script (`scripts/verify-metadata.js`) to enforce consistency between `package.json` and `openclaw.plugin.json`.

### Fixed
- Fixed Jest coverage reporter configuration typo (`lcov` instead of broken `lcv`).
- Harmonized manifest properties, package file inclusions, and license SPDX identifiers.

---

## [1.4.0] - 2026-02-14

### Added
- Prometheus metrics registry (`src/observability/metrics.ts`) with counters, gauges, and latency histograms.
- Runtime input validation with Zod schemas (`src/validation/schemas.ts`).
- Structured logging (`StructuredLogger`) with structured JSON output and component contextualization.
- Health check verification system for storage and memory components.

---

## [1.3.0] - 2026-02-14

### Added
- Lexical BM25 search index (`src/search/bm25-index.ts`) with Porter stemming and configurable k1 and b parameters.
- Multi-factor advanced relevance scoring (`src/heuristics/advanced-relevance.ts`) combining keyword match, temporal recency decay, priority boost, and semantic density.

---

## [1.2.0] - 2026-02-14

### Added
- Tiered storage architecture (`src/persistence/tiered-storage.ts`): L0 (LRU cache, hot), L1 (SQLite, warm), L2 (Archive, cold).
- Asynchronous factory pattern (`MemoryContextFactory`) for thread-safe singleton initialization.
- Pure-JS SQLite persistence layer (`src/persistence/sqlite-persistence.ts`) using `sql.js` with auto-save and backup recovery.

---

## [1.1.0] - 2026-02-13

### Added
- Accurate LLM token counting using `gpt-tokenizer` byte-pair encoding.
- Circuit breaker fault-tolerance pattern (`src/utils/circuit-breaker.ts`) to prevent cascading rebuild failures.

### Fixed
- Replaced naive whitespace token splitting with accurate BPE tokenization.
- Bound memory preparation for full conversation history.

---

## [1.0.0] - 2026-02-13

### Added
- Initial release of Memory Context OpenClaw plugin.
- Just-In-Time (JIT) context rebuilding engine.
- 5-layer hierarchical context structure (L0–L4).
- Quantum anchors for cross-session continuity and shift immunity.
- Token budget manager.
