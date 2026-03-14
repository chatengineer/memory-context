import { MemoryContextPlugin } from '../../src/index';

describe('memory-context command snapshots', () => {
  it('should expose command-style snapshots directly', async () => {
    const plugin = new MemoryContextPlugin();
    await plugin.initialize();

    const status = await plugin.getCommandSnapshot('status');
    const help = await plugin.getCommandSnapshot('help');

    expect(status).toContain('Memory Context status:');
    expect(help).toContain('/memorycontext status');

    await plugin.onUnload();
  });
});
