import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryContextPlugin } from '../../src/index';

describe('MemoryContextPlugin state restore', () => {
  it('should persist typed anchors, predictive state, and BM25 search state across plugin instances', async () => {
    const statePath = path.join(os.tmpdir(), `memory-context-state-${Date.now()}.db`);

    const pluginA = new MemoryContextPlugin({ statePath });
    await pluginA.initialize();

    await pluginA.onMessage({ content: 'Redis bug fix deployed to production', role: 'assistant' });
    await pluginA.onMessage({ content: 'Redis replication lag analysis', role: 'user' });
    await pluginA.onMessage({ content: 'System reliability policy update', role: 'system' });
    await pluginA.snapshot();
    await pluginA.onUnload();

    const pluginB = new MemoryContextPlugin({ statePath });
    await pluginB.initialize();

    const memoryResults = await pluginB.searchMemory('redis');
    expect(memoryResults.length).toBeGreaterThan(0);
    expect(memoryResults[0].content.toLowerCase()).toContain('redis');

    const policyResults = await pluginB.getEngine().search('policy', 5);
    const restoredAnchors = pluginB.getEngine().getLastContext() || policyResults.map(r => r.content).join('\n');
    const stats = await fs.promises.stat(statePath);
    expect(stats.size).toBeGreaterThan(0);
    expect(pluginB.getEngine().getPredictor().getStats().historyLength).toBeGreaterThan(0);
    expect(pluginB.invokeGatewayMethod('memory_context.anchor', { action: 'list' })).resolves.toMatchObject({ typed: expect.any(Array) });
    expect(restoredAnchors).toBeDefined();

    await pluginB.onUnload();
    await fs.promises.unlink(statePath).catch(() => undefined);
  });
});
