# Contributing to Memory Context

Thank you for your interest in contributing to `memory-context`! We welcome contributions that improve context preservation, test coverage, persistence, and performance.

---

## Development Setup

### Prerequisites

- **Node.js**: version `20.x` or `22.x` (LTS recommended)
- **npm**: version `10.x` or higher
- **git**: modern git client

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/chatengineer/memory-context.git
   cd memory-context
   ```

2. **Install dependencies**:
   ```bash
   npm ci
   ```

3. **Verify metadata and build**:
   ```bash
   npm run verify:metadata
   npm run build
   ```

4. **Run the test suite**:
   ```bash
   npm test
   ```

---

## Development Workflow

### Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run build` | Compiles TypeScript source to `./dist` |
| `npm run watch` | Runs the TypeScript compiler in watch mode |
| `npm test` | Runs all unit and integration tests |
| `npm run test:coverage` | Generates full LCOV and HTML coverage reports |
| `npm run test:unit` | Runs unit tests only (`tests/unit`) |
| `npm run test:integration` | Runs integration tests only (`tests/integration`) |
| `npm run verify:metadata` | Validates synchronization between `package.json` and `openclaw.plugin.json` |
| `npm run ci` | Full local CI check (metadata check + build + coverage) |

---

## Planned Work & Roadmap

All active features, enhancements, and architectural milestones are tracked in [ROADMAP.md](ROADMAP.md). If you would like to tackle an item:

1. Check the roadmap and corresponding [open GitHub Issues](https://github.com/chatengineer/memory-context/issues).
2. Comment on the issue to signal you are working on it.
3. Open a pull request against the `main` branch with your implementation and accompanying tests.

---

## Scope & Guidelines

To maintain compatibility and clear focus:
- **Lexical & Heuristic Focus**: Memory context operates via deterministic JIT reconstruction, BM25 keyword search, and tiered caching. No neural model weights or external embedding servers are bundled.
- **Privacy & Data Security**: Use mock or synthetic test fixtures only. Never commit credentials, personal data, or API keys.
- **Cross-Platform**: All tests and build scripts must pass cleanly on Windows, macOS, and Linux.

---

## License

By contributing to `memory-context`, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
