import { MemoryContextPlugin } from '../../src/index';

describe('MemoryContextPlugin filtered search and time-windowed recall', () => {
  it('should support search explanations, source filters, and time-windowed recall', async () => {
    const plugin = new MemoryContextPlugin();
    const now = Date.now();

    await plugin.onMessage({ content: 'Redis failover checklist for production', role: 'assistant', timestamp: now - 60_000 });
    await plugin.onMessage({ content: 'Redis incident postmortem notes', role: 'user', timestamp: now - 30_000 });
    await plugin.onMessage({ content: 'Gardening notes for tomatoes', role: 'assistant', timestamp: now - 10_000 });

    const results = await plugin.searchMemory('redis', {
      limit: 10,
      role: 'assistant',
      source: 'history',
      since: now - 120_000,
      until: now - 20_000,
      includeExplanation: true
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content.toLowerCase()).toContain('redis');
    expect(results[0].explanation).toBeDefined();
    expect(results[0].matchedTerms?.some(term => term.startsWith('red'))).toBe(true);

    const recalled = await plugin.recallMemory({
      since: now - 40_000,
      until: now,
      limit: 5,
      source: 'history'
    });

    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled.every(item => (item.timestamp || 0) >= now - 40_000)).toBe(true);
    expect(recalled[0].explanation).toContain('time-window-match');

    await plugin.onUnload();
  });
});
