import { MemoryContextFactory } from '../../src/core/factory';

describe('JIT context selection deduplication', () => {
  it('should avoid repeating identical content across history and hierarchy candidates', async () => {
    const factory = new MemoryContextFactory({ maxContextTokens: 4000, targetUtilization: 0.9 });
    await factory.initialize();

    const history = factory.getHistory();
    const hierarchy = factory.getHierarchy();
    const engine = factory.getEngine();

    const repeated = 'Redis failover runbook for production';
    await history.addMessage({ content: repeated, role: 'assistant', timestamp: Date.now() - 1000 });
    await history.addMessage({ content: repeated, role: 'assistant', timestamp: Date.now() - 900 });
    hierarchy.addContent(1 as any, repeated);
    await history.addMessage({ content: 'Postgres recovery checklist', role: 'assistant', timestamp: Date.now() - 800 });

    const context = await engine.buildContext({ content: 'redis failover' });
    const occurrences = context.split(repeated).length - 1;

    expect(occurrences).toBe(1);
    await factory.reset();
  });
});
