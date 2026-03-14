import { MemoryContextPlugin } from '../../src/index';

describe('MemoryContextPlugin diff/explanation surface', () => {
  it('should expose structured diff information after context rebuilds', async () => {
    const plugin = new MemoryContextPlugin();
    await plugin.onMessage({ content: 'Redis failover runbook', role: 'assistant' });
    await plugin.onMessage({ content: 'Postgres recovery checklist', role: 'assistant' });

    const diff = await plugin.invokeTool('memory_context_diff');

    expect(typeof diff.lastContext).toBe('string');
    expect(diff.explanation).toBeDefined();
    expect(typeof diff.explanation.changed).toBe('boolean');
    expect(Array.isArray(diff.explanation.addedPreview)).toBe(true);
    expect(Array.isArray(diff.explanation.removedPreview)).toBe(true);

    await plugin.onUnload();
  });
});
