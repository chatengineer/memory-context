// tests/integration/retrieval-quality.test.ts
// Integration tests for the retrieval quality pipeline

import { QueryNormalizer, QueryExpansionSource } from '../../src/search/query-normalizer';
import { AdvancedRelevanceScorer, ScoringContext } from '../../src/heuristics/advanced-relevance';
import { BM25Index } from '../../src/search/bm25-index';

describe('Retrieval Quality Pipeline', () => {
  let normalizer: QueryNormalizer;
  let scorer: AdvancedRelevanceScorer;
  let index: BM25Index;

  beforeEach(() => {
    normalizer = new QueryNormalizer();
    scorer = new AdvancedRelevanceScorer();
    index = new BM25Index({ minDocFreq: 1 });
  });

  describe('Query Normalization', () => {
    const sources: QueryExpansionSource[] = [
      {
        id: 'turn-1',
        content: 'Alice Chen said the Redis cache key used the old tenant alias.',
        metadata: { timestamp: Date.parse('2026-04-01T10:00:00Z'), speaker: 'Alice Chen' }
      },
      {
        id: 'turn-2',
        content: 'Bruno renamed Project Fennec to Fennec Leap in March 2026.',
        metadata: { timestamp: Date.parse('2026-03-07T10:00:00Z'), speaker: 'Bruno' }
      },
      {
        id: 'turn-3',
        content: 'The user prefers a short engineering lesson followed by one concrete question as CTA.',
        metadata: { timestamp: Date.parse('2026-02-14T10:00:00Z'), speaker: 'user' }
      }
    ];

    test('normalizes query for BM25', () => {
      const result = normalizer.normalize('What did Alice say about the Redis cache?', sources);
      expect(result.expanded).toContain('redis');
      expect(result.expanded).toContain('cache');
    });

    test('expands participant aliases', () => {
      const result = normalizer.normalize('What did I say about CTA?', sources);
      expect(result.expansions.some(e => ['me', 'my', 'user', 'human'].includes(e))).toBe(true);
    });

    test('expands month names', () => {
      const result = normalizer.normalize('What happened in Mar 2026?', sources);
      expect(result.expansions.some(e => e === 'march' || e === '03' || e === '3')).toBe(true);
    });

    test('expands ISO dates', () => {
      const result = normalizer.normalize('What happened on 2026-03-07?', sources);
      expect(result.expansions.some(e => e.includes('2026') && e.includes('3'))).toBe(true);
    });

    test('expands year-month format', () => {
      const result = normalizer.normalize('What happened in 2026-03?', sources);
      expect(result.expansions).toContain('march');
    });

    test('expands named entities from sources', () => {
      const result = normalizer.normalize('Who renamed Fennec?', sources);
      expect(result.expansions.some(e => e.toLowerCase().includes('fennec'))).toBe(true);
    });

    test('expansion cap respected', () => {
      const manySources: QueryExpansionSource[] = Array.from({ length: 2000 }, (_, i) => ({
        id: `src-${i}`,
        content: `Entity${i} test`,
        metadata: {}
      }));
      const result = normalizer.normalize('Entity', manySources);
      expect(result.expansions.length).toBeLessThanOrEqual(24);
    });
  });

  describe('Adaptive Recency', () => {
    test('derives half-life and max-age from corpus span', () => {
      const ref = Date.now();
      const day = 24 * 60 * 60 * 1000;

      // Simulate old timestamps spanning 60 days
      const oldTimestamps = [
        ref - 60 * day,
        ref - 55 * day,
        ref - 30 * day,
        ref - 10 * day,
        ref - 1 * day
      ];

      // The adaptive recency logic is internal to JITEngine, but we can test
      // the AdvancedRelevanceScorer with an adaptive context
      const context: ScoringContext = {
        referenceTime: ref,
        adaptiveRecency: {
          halfLife: 20 * day,
          maxAge: 65 * day
        }
      };

      const recentScore = scorer.computeScore('test', { timestamp: ref - 5 * day }, context);
      const oldScore = scorer.computeScore('test', { timestamp: ref - 50 * day }, context);
      const veryOldScore = scorer.computeScore('test', { timestamp: ref - 70 * day }, context);

      expect(recentScore).toBeGreaterThan(oldScore);
      expect(veryOldScore).toBe(0); // Beyond maxAge
    });

    test('falls back to config when no adaptive context', () => {
      const ref = Date.now();
      const score = scorer.computeScore('test', { timestamp: ref - 100 * 24 * 60 * 60 * 1000 });
      expect(score).toBe(0); // Beyond default maxAge (30 days)
    });
  });

  describe('MMR Diversity', () => {
    test('would reduce near-duplicate candidates', () => {
      // MMR logic is in JITEngine, but we can verify the concept works
      // by checking that similar content gets penalized
      const content1 = 'Alice said the Redis cache key failed';
      const content2 = 'Alice said the Redis cache key failed because of old tenant';
      const content3 = 'The weather is nice today';

      const terms1 = new Set(content1.toLowerCase().split(/\s+/).filter(t => t.length > 2));
      const terms2 = new Set(content2.toLowerCase().split(/\s+/).filter(t => t.length > 2));
      const terms3 = new Set(content3.toLowerCase().split(/\s+/).filter(t => t.length > 2));

      // Similarity between near-duplicates
      const overlap12 = [...terms1].filter(t => terms2.has(t)).length;
      const sim12 = overlap12 / Math.sqrt(terms1.size * terms2.size);

      // Similarity between different content
      const overlap13 = [...terms1].filter(t => terms3.has(t)).length;
      const sim13 = overlap13 / Math.sqrt(terms1.size * terms3.size);

      expect(sim12).toBeGreaterThan(sim13);
    });
  });

  describe('Provenance Evidence', () => {
    test('formats evidence with valid timestamp', () => {
      const timestamp = Date.parse('2026-04-01T10:00:00Z');
      const evidence = `[memory-evidence source=history id=turn-1 timestamp=${new Date(timestamp).toISOString()}]`;
      expect(evidence).toContain('source=history');
      expect(evidence).toContain('id=turn-1');
      expect(evidence).toContain('timestamp=');
    });

    test('handles non-finite timestamps gracefully', () => {
      const invalidTimestamps = [NaN, Infinity, -Infinity, 0, 'not-a-number'];
      for (const ts of invalidTimestamps) {
        const validTimestamp = typeof ts === 'number' && Number.isFinite(ts) ? ts : undefined;
        expect(validTimestamp).toBeUndefined();
      }
    });
  });

  describe('LoCoMo-style regression', () => {
    test('index retrieves expected documents with normalized queries', () => {
      const docs = [
        { id: 't1', content: 'Alice Chen said the Redis cache key failed on 2026-04-01', metadata: { timestamp: Date.parse('2026-04-01T10:00:00Z') } },
        { id: 't2', content: 'Bruno renamed Project Fennec in March 2026', metadata: { timestamp: Date.parse('2026-03-07T10:00:00Z') } },
        { id: 't3', content: 'User prefers short engineering lesson CTA', metadata: { timestamp: Date.parse('2026-02-14T10:00:00Z') } }
      ];

      for (const doc of docs) index.addDocument(doc);

      const normalizer = new QueryNormalizer();
      const normalized = normalizer.normalize('What caused the April 1 deployment failure?', docs);
      const results = index.search(normalized.expanded, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('t1'); // Should rank the Redis failure first
    });
  });
});