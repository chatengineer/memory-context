/**
 * Integration Tests for Memory Context
 */

import { MemoryContextFactory, createMemoryContext } from '../../src/core/factory';
import { TieredStorage } from '../../src/persistence/tiered-storage';
import { BM25Index } from '../../src/search/bm25-index';

describe('MemoryContext Integration', () => {
  describe('Factory', () => {
    it('should create engine with default config', async () => {
      const engine = await createMemoryContext();
      expect(engine).toBeDefined();
    });

    it('should initialize all components', async () => {
      const factory = new MemoryContextFactory({
        maxContextTokens: 100000
      });
      
      await factory.initialize();
      
      expect(factory.isInitialized()).toBe(true);
      expect(factory.getEngine()).toBeDefined();
      expect(factory.getHistory()).toBeDefined();
      expect(factory.getHierarchy()).toBeDefined();
    });

    it('should be idempotent', async () => {
      const factory = MemoryContextFactory.getInstance();
      await factory.initialize();
      await factory.initialize(); // Second call
      
      expect(factory.isInitialized()).toBe(true);
    });
  });

  describe('TieredStorage', () => {
    let storage: TieredStorage;

    beforeEach(async () => {
      storage = new TieredStorage();
      await storage.initialize();
    });

    afterEach(async () => {
      await storage.clear();
    });

    it('should store and retrieve messages', async () => {
      const id = await storage.store('Test message');
      const message = await storage.retrieve(id);
      
      expect(message).toBeDefined();
      expect(message?.content).toBe('Test message');
    });

    it('should track token counts', async () => {
      await storage.store('First message');
      await storage.store('Second message');
      
      const tokens = storage.getTotalTokens();
      expect(tokens).toBeGreaterThan(0);
    });

    it('should get tier statistics', async () => {
      await storage.store('Test content');
      const stats = storage.getTierStats();
      
      expect(stats.L0).toBeDefined();
      expect(stats.L1).toBeDefined();
      expect(stats.L2).toBeDefined();
    });

    it('should handle multiple messages', async () => {
      const ids: string[] = [];
      
      for (let i = 0; i < 10; i++) {
        const id = await storage.store(`Message ${i}`);
        ids.push(id);
      }
      
      const messages = await storage.getAllMessages();
      expect(messages.length).toBe(10);
    });
  });

  describe('BM25 + TieredStorage Integration', () => {
    let storage: TieredStorage;
    let index: BM25Index;

    beforeEach(async () => {
      storage = new TieredStorage();
      await storage.initialize();
      index = new BM25Index();
    });

    afterEach(async () => {
      await storage.clear();
      index.clear();
    });

    it('should index stored messages', async () => {
      const id1 = await storage.store('Important decision made today');
      const id2 = await storage.store('Bug fix deployed successfully');
      
      const messages = await storage.getAllMessages();
      for (const msg of messages) {
        index.addDocument({ id: msg.id, content: msg.content });
      }
      
      const results = index.search('decision');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Context Building', () => {
    it('should build context from history', async () => {
      const factory = MemoryContextFactory.getInstance();
      await factory.initialize();
      
      const history = factory.getHistory();
      await history.addMessage({ content: 'User question about AI' });
      await history.addMessage({ content: 'Assistant response about ML' });
      
      const messages = await history.getAllMessages();
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });
});
