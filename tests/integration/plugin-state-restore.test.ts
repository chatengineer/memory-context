import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryContextPlugin } from '../../src/index';

describe('MemoryContextPlugin state restore', () => {
  it('should persist typed anchors, predictive state, and BM25 search state across plugin instances', async () => {
    const statePath = path.join(os.tmpdir(), `memory-context-state-${Date.now()}.json`);

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

    const restoredAnchors = pluginB.getEngine().getLastContext() || pluginB.getEngine().search('policy', 5).map(r => r.content).join('\n');
    expect(await fs.promises.readFile(statePath, 'utf8')).toContain('system-message');
    expect(pluginB.getEngine().getPredictor().getStats().historyLength).toBeGreaterThan(0);
    expect(restoredAnchors).toBeDefined();

    await pluginB.onUnload();
    await fs.promises.unlink(statePath).catch(() => undefined);
  });
});
