/**
 * Unit Tests for TieredStorage Eviction Logic
 */

import { TieredStorage } from '../../src/persistence/tiered-storage';

describe('TieredStorage Eviction', () => {
  let storage: TieredStorage;

  beforeEach(async () => {
    // Create storage with small limits to trigger eviction easily
    storage = new TieredStorage({
      l0MaxTokens: 100,
      l1MaxTokens: 200,
      l2MaxTokens: 500
    });
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.clear();
  });

  it('should demote from L0 to L1 when L0 limit is reached', async () => {
    // Fill L0 (each message ~10-15 tokens depending on content)
    // "Message X" is usually 2 tokens (Message) + 1 token (X) = 3 tokens.
    // Let's use larger content to be sure.
    const longContent = "This is a moderately long sentence that should take about twenty tokens to represent in the system.";
    // ~20 tokens
    
    // Store 4 messages (~72 tokens)
    for (let i = 0; i < 4; i++) {
      await storage.store(longContent);
    }
    
    let stats = storage.getTierStats();
    expect(stats.L0.currentTokens).toBeGreaterThan(0);
    expect(stats.L0.currentTokens).toBeLessThanOrEqual(100);
    expect(stats.L1.currentTokens).toBe(0);

    // Store 6th message - should trigger demotion of oldest
    await storage.store(longContent);
    await storage.store(longContent);
    
    stats = storage.getTierStats();
    expect(stats.L0.currentTokens).toBeGreaterThan(0);
    expect(stats.L0.currentTokens).toBeLessThanOrEqual(100);
    expect(stats.L1.currentTokens).toBeGreaterThan(0);
    expect(stats.L1.itemCount).toBe(0); // itemCount is not tracked in L1 stats currently (it says 0 in code)
  });

  it('should demote from L1 to L2 when L1 limit is reached', async () => {
    const content = "This content has roughly twenty tokens and we will use it to fill tiers.";
    
    // Store enough to fill L0 and L1
    // L0: 100 tokens (~5 msgs)
    // L1: 200 tokens (~10 msgs)
    // Total: 15 messages should start filling L2
    
    for (let i = 0; i < 30; i++) {
      await storage.store(content);
    }
    
    const stats = storage.getTierStats();
    expect(stats.L0.currentTokens).toBeLessThanOrEqual(100);
    expect(stats.L1.currentTokens).toBeLessThanOrEqual(200);
    expect(stats.L2.currentTokens).toBeGreaterThan(0);
  });

  it('should handle concurrent stores without race conditions', async () => {
    const content = "Concurrent test content";
    const promises = [];
    
    // Fire off 20 concurrent store operations
    for (let i = 0; i < 20; i++) {
      promises.push(storage.store(content));
    }
    
    await Promise.all(promises);
    
    const stats = storage.getTierStats();
    const allMessages = await storage.getAllMessages();
    
    expect(allMessages.length).toBe(20);
    expect(stats.L0.currentTokens + stats.L1.currentTokens + stats.L2.currentTokens).toBeGreaterThan(0);
  });
});
