/**
 * Integration tests for the retrieval-quality pipeline:
 * adaptive recency, MMR diversity, and provenance evidence.
 */

import { AdvancedRelevanceScorer } from '../../src/heuristics/advanced-relevance';
import { MemoryContextFactory } from '../../src/core/factory';

const DAY = 24 * 60 * 60 * 1000;

describe('Retrieval quality', () => {
  describe('adaptive recency', () => {
    const scorer = new AdvancedRelevanceScorer();
    const now = Date.now();
    const old = now - 120 * DAY;

    it('expires evidence beyond the fixed seven-day horizon', () => {
      const result = scorer.computeScore(
        'critical redis bug fix',
        { timestamp: old },
        { referenceTime: now }
      );

      expect(result.factors.recency).toBe(0);
    });

    it('retains long-range evidence when the horizon adapts to the corpus', () => {
      const result = scorer.computeScore(
        'critical redis bug fix',
        { timestamp: old },
        {
          referenceTime: now,
          adaptiveRecency: { halfLife: 30 * DAY, maxAge: 180 * DAY }
        }
      );

      expect(result.factors.recency).toBeGreaterThan(0);
    });
  });

  describe('provenance evidence', () => {
    it('annotates memories and tolerates non-finite timestamps', async () => {
      const factory = new MemoryContextFactory({
        maxContextTokens: 4000,
        targetUtilization: 0.9,
        persistenceEnabled: false
      });
      await factory.initialize();
      const engine = factory.getEngine() as any;

      const formatted = engine.formatWithEvidence({
        id: 'history:1',
        content: 'Redis cache key fix',
        source: 'history',
        metadata: { timestamp: Number.NaN }
      });

      expect(formatted).toContain('[memory-evidence source=history id=history:1]');
      expect(formatted).not.toContain('NaN');
      expect(formatted).toContain('Redis cache key fix');
    });
  });

  describe('MMR diversity', () => {
    it('keeps the strongest hit first, then prefers diverse evidence', async () => {
      const factory = new MemoryContextFactory({
        maxContextTokens: 4000,
        targetUtilization: 0.9,
        persistenceEnabled: false
      });
      await factory.initialize();
      const engine = factory.getEngine() as any;

      const ordered = engine.applyMMRDiversity([
        { candidate: { id: 'a', content: 'redis cache key fix deployment', source: 'history' }, score: 1.0 },
        { candidate: { id: 'b', content: 'redis cache key fix deployment', source: 'history' }, score: 0.99 },
        { candidate: { id: 'c', content: 'quarterly newsletter planning notes', source: 'history' }, score: 0.98 }
      ]);

      expect(ordered.map((item: any) => item.candidate.id)).toEqual(['a', 'c', 'b']);
    });

    it('does not drop candidates outside the MMR window', async () => {
      const factory = new MemoryContextFactory({
        maxContextTokens: 4000,
        targetUtilization: 0.9,
        persistenceEnabled: false
      });
      await factory.initialize();
      const engine = factory.getEngine() as any;

      const scored = Array.from({ length: 70 }, (_, index) => ({
        candidate: {
          id: `c${index}`,
          content: `unique topic ${index} alpha beta gamma`,
          source: 'history'
        },
        score: 1 - index / 1000
      }));

      const ordered = engine.applyMMRDiversity(scored);

      expect(ordered).toHaveLength(70);
      expect(new Set(ordered.map((item: any) => item.candidate.id)).size).toBe(70);
    });
  });

  describe('JIT context assembly', () => {
    it('includes evidence headers for retrieved memories', async () => {
      const factory = new MemoryContextFactory({
        maxContextTokens: 4000,
        targetUtilization: 0.9,
        persistenceEnabled: false
      });
      await factory.initialize();
      const history = factory.getHistory();
      const engine = factory.getEngine();

      await history.addMessage({
        content: 'Critical Redis bug fix deployed to production',
        role: 'assistant',
        timestamp: Date.now() - 90 * DAY
      });
      await history.addMessage({
        content: 'Lunch plans for Friday',
        role: 'user',
        timestamp: Date.now()
      });

      const context = await engine.buildContext({ content: 'What was the Redis bug fix?' });

      expect(context).toContain('[memory-evidence');
      expect(context).toContain('Critical Redis bug fix deployed to production');
    });
  });
});
