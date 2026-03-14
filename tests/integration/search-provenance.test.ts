import { MemoryContextPlugin } from '../../src/index';

describe('memory-context search provenance', () => {
  it('should return provenance-rich search results', async () => {
    const plugin = new MemoryContextPlugin();
    await plugin.onMessage({ content: 'Redis failover procedure for production', role: 'assistant', timestamp: Date.now() });

    const results = await plugin.searchMemory('redis failover', { includeExplanation: true, source: 'history', limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedTerms?.length).toBeGreaterThan(0);
    expect(results[0].explanation).toContain('sqlite-native retrieval');
    expect((results[0].metadata as any)?.provenance).toMatchObject({
      backend: 'sqlite',
      ranking: 'recency-filtered-like-match',
      scoreBreakdown: {
        bm25: expect.any(Number),
        heuristic: expect.any(Number),
        filter: expect.any(Number),
        final: expect.any(Number)
      }
    });

    await plugin.onUnload();
  });
});
