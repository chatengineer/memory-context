import { performance } from 'node:perf_hooks';
import pluginModule from '../dist/index.js';

const PluginClass = pluginModule?.MemoryContextPlugin;
if (!PluginClass) throw new Error('MemoryContextPlugin export not found');

function makeMessage(i, now) {
  const corpus = [
    `Redis failover runbook iteration ${i}`,
    `Postgres WAL replay checklist iteration ${i}`,
    `Kubernetes rollout recovery note ${i}`,
    `Decision: preserve typed anchors across model switches ${i % 5}`,
    `Need recall for redis incident timeline ${i}`,
  ];
  const content = corpus[i % corpus.length];
  const role = i % 7 === 0 ? 'system' : i % 2 === 0 ? 'assistant' : 'user';
  return { content, role, timestamp: now - (1000 * (250 - i)) };
}

async function bench() {
  const plugin = new PluginClass({
    statePath: '.sandbox/benchmark-state.db',
    targetUtilization: 1,
    zeroShiftEnabled: true,
    quantumAnchorsEnabled: true,
    persistenceEnabled: true,
    predictiveAssemblyEnabled: true,
  });

  const originalLog = console.log;
  console.log = () => {};
  await plugin.initialize();
  const now = Date.now();

  const ingestStart = performance.now();
  for (let i = 0; i < 250; i++) {
    await plugin.onMessage(makeMessage(i, now));
  }
  const ingestMs = performance.now() - ingestStart;

  const searchStart = performance.now();
  const search = await plugin.searchMemory('redis failover runbook', { limit: 10, includeExplanation: true, source: 'history' });
  const searchMs = performance.now() - searchStart;

  const recallStart = performance.now();
  const recall = await plugin.recallMemory({ since: now - 500000, until: now, limit: 25 });
  const recallMs = performance.now() - recallStart;

  const status = await plugin.invokeGatewayMethod('memory_context.status');
  const adaptiveStats = plugin.getEngine()['advancedScorer']?.getAdaptiveStats?.() || null;
  await plugin.onUnload();
  console.log = originalLog;

  console.log(JSON.stringify({
    benchmark: {
      ingestedMessages: 250,
      ingestMs: Number(ingestMs.toFixed(2)),
      avgIngestMs: Number((ingestMs / 250).toFixed(4)),
      searchMs: Number(searchMs.toFixed(2)),
      recallMs: Number(recallMs.toFixed(2)),
      searchCount: search.length,
      recallCount: recall.length,
      topSearch: search[0] || null,
      adaptiveStats,
      engine: status.engine
    }
  }, null, 2));
}

bench().catch(err => {
  console.error = process.stderr.write.bind(process.stderr);
  process.stderr.write(String(err?.stack || err) + '\n');
  process.exit(1);
});
