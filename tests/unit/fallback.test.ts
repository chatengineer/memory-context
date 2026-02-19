import { DegradedContextManager, SimpleContext } from '../../src/core/fallback';

describe('Fallback System', () => {
  describe('SimpleContext', () => {
    it('should add items and respect maxSize', () => {
      const context = new SimpleContext(2);
      context.add('one');
      context.add('two');
      context.add('three');
      
      const items = context.getAll();
      expect(items).toHaveLength(2);
      expect(items[0]).toBe('two');
      expect(items[1]).toBe('three');
    });

    it('should clear items', () => {
      const context = new SimpleContext(5);
      context.add('test');
      context.clear();
      expect(context.size).toBe(0);
    });
  });

  describe('DegradedContextManager', () => {
    it('should implement sliding window eviction', () => {
      // Set a small token limit: 100 characters / 4 = 25 tokens
      // We'll use strings of length 40 (10 tokens each)
      const manager = new DegradedContextManager(25);
      
      manager.addMessage('0123456789012345678901234567890123456789'); // 10 tokens
      manager.addMessage('abcdefghijabcdefghijabcdefghijabcdefghij'); // 10 tokens
      
      let status = manager.getStatus();
      expect(status.tokens).toBe(20);
      expect(status.messages).toBe(2);
      
      // Adding a 3rd message (10 tokens) would reach 30 > 25.
      // It should evict the first message.
      manager.addMessage('klmnopqrstklmnopqrstklmnopqrstklmnopqrst'); // 10 tokens
      
      status = manager.getStatus();
      expect(status.tokens).toBe(20); // 20 - 10 (evicted) + 10 (new)
      expect(status.messages).toBe(2);
      
      const context = manager.buildContext();
      expect(context).not.toContain('0123456789');
      expect(context).toContain('abcdefghij');
      expect(context).toContain('klmnopqrst');
    });

    it('should clear everything if a single message exceeds the budget', () => {
      const manager = new DegradedContextManager(20);
      manager.addMessage('small message'); // small
      
      // Message length 100 = 25 tokens > 20
      manager.addMessage('a'.repeat(100));
      
      const status = manager.getStatus();
      expect(status.messages).toBe(1); // Only the giant message remains (or it should be rejected?)
      // Current implementation adds it anyway after clearing.
    });
  });
});
