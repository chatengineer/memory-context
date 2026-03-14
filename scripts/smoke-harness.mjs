import pluginModule from '../dist/index.js';

const pluginObj = pluginModule?.default ?? pluginModule;
const PluginClass = pluginModule?.MemoryContextPlugin;

async function main() {
  if (!PluginClass) {
    throw new Error('MemoryContextPlugin export not found in dist/index.js');
  }

  const plugin = new PluginClass({
    statePath: '.sandbox/harness-state.db',
    targetUtilization: 1,
    zeroShiftEnabled: true,
    quantumAnchorsEnabled: true,
    persistenceEnabled: true,
    predictiveAssemblyEnabled: true,
  });

  await plugin.initialize();

  const now = Date.now();
  const messages = [
    { content: 'Redis failover runbook for production', role: 'assistant', timestamp: now - 60_000 },
    { content: 'Postgres recovery checklist and WAL replay notes', role: 'assistant', timestamp: now - 50_000 },
    { content: 'Decision: keep typed anchors durable across reloads', role: 'system', timestamp: now - 40_000 },
    { content: 'Need recall for redis failover context', role: 'user', timestamp: now - 30_000 }
  ];

  for (const message of messages) {
    await plugin.onMessage(message);
  }

  const search = await plugin.searchMemory('redis failover', {
    limit: 5,
    includeExplanation: true,
    source: 'history'
  });

  const recall = await plugin.recallMemory({ since: now - 120_000, until: now, limit: 5 });
  const status = await plugin.invokeGatewayMethod('memory_context.status');
  const diff = await plugin.invokeTool('memory_context_diff');
  const cmd = await plugin.getCommandSnapshot('status');

  console.log(JSON.stringify({
    plugin: {
      id: pluginObj?.id,
      hasRegister: typeof pluginObj?.register === 'function'
    },
    searchCount: search.length,
    topSearch: search[0] || null,
    recallCount: recall.length,
    status,
    diff,
    commandSnapshot: cmd
  }, null, 2));

  await plugin.onUnload();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
