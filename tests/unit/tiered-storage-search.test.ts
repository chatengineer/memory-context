import { TieredStorage } from '../../src/persistence/tiered-storage';

describe('TieredStorage search and recall APIs', () => {
  let storage: TieredStorage;

  beforeEach(async () => {
    storage = new TieredStorage({
      l0MaxTokens: 500,
      l1MaxTokens: 5000,
      l2MaxTokens: 10000
    });
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.clear();
  });

  it('should search stored messages with metadata filters', async () => {
    const firstId = await storage.store('Redis failover playbook for production incidents', { tag: 'ops', role: 'assistant' });
    const secondId = await storage.store('Gardening notes for tomatoes and basil', { tag: 'personal', role: 'user' });

    const results = await storage.search('redis failover', {
      limit: 5,
      metadataFilters: { tag: 'ops' }
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(firstId);
    expect(results[0].content).toContain('Redis failover');

    const recalled = await storage.retrieveMany([firstId, secondId]);
    expect(recalled).toHaveLength(2);
  });
});
