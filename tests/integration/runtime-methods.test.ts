import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryContextPlugin } from '../../src/index';

describe('MemoryContextPlugin runtime methods', () => {
  it('should implement manifest-promised gateway methods and tool handlers', async () => {
    const statePath = path.join(os.tmpdir(), `memory-context-runtime-${Date.now()}.db`);
    const plugin = new MemoryContextPlugin({ statePath });

    await plugin.onMessage({ content: 'Redis failover runbook for production', role: 'assistant' });
    await plugin.onMessage({ content: 'Postgres connection tuning notes', role: 'user' });

    const status = await plugin.invokeGatewayMethod('memory_context.status');
    expect(status.initialized).toBe(true);
    expect(status.engine.indexedCandidates).toBeGreaterThan(0);

    const search = await plugin.invokeGatewayMethod('memory_context.search', { query: 'redis', limit: 5 });
    expect(search.length).toBeGreaterThan(0);
    expect(search[0].content.toLowerCase()).toContain('redis');

    const addedAnchor = await plugin.invokeGatewayMethod('memory_context.anchor', {
      action: 'add',
      type: 'decision',
      decision: 'Keep Redis failover docs pinned',
      rationale: 'High operational value'
    });
    expect(addedAnchor.decision).toBe('Keep Redis failover docs pinned');

    const anchorList = await plugin.invokeTool('memory_context_anchor', { action: 'list' });
    expect(anchorList.typed.length).toBeGreaterThan(0);

    const snapshot = await plugin.invokeTool('memory_context_snapshot');
    expect(snapshot.ok).toBe(true);
    expect(await fs.promises.stat(statePath)).toBeDefined();

    const history = await plugin.invokeGatewayMethod('memory_context.history', { limit: 2 });
    expect(history).toHaveLength(2);

    await plugin.invokeGatewayMethod('memory_context.jit_clear');
    const postClearStatus = await plugin.invokeGatewayMethod('memory_context.status');
    expect(postClearStatus.engine.indexedCandidates).toBe(0);

    await plugin.onUnload();
    await fs.promises.unlink(statePath).catch(() => undefined);
  });
});
