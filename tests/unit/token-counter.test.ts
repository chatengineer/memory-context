/**
 * Unit Tests for Token Counter
 */

import { TokenCounter, defaultTokenCounter } from '../src/utils/token-counter';

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter('gpt-4o');
  });

  describe('count()', () => {
    it('should count tokens for simple text', () => {
      const text = 'Hello, world!';
      const count = counter.count(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(counter.count('')).toBe(0);
    });

    it('should handle long text', () => {
      const text = 'This is a longer piece of text that should have more tokens.';
      const count = counter.count(text);
      expect(count).toBeGreaterThan(5);
    });

    it('should handle special characters', () => {
      const text = '!@#$%^&*(){}[]|\\:";\'<>?,./~`';
      const count = counter.count(text);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('truncate()', () => {
    it('should not truncate if within budget', () => {
      const text = 'Short text';
      const result = counter.truncate(text, 100);
      expect(result.text).toBe(text);
    });

    it('should truncate if exceeds budget', () => {
      const text = 'This is a longer piece of text that needs to be truncated';
      const result = counter.truncate(text, 5);
      expect(result.text).toContain('truncated');
      expect(result.actualTokens).toBeLessThanOrEqual(10);
    });
  });

  describe('encode()', () => {
    it('should encode text to token IDs', () => {
      const text = 'Hello';
      const tokens = counter.encode(text);
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  describe('estimateTokenCount()', () => {
    it('should estimate tokens for code', () => {
      const code = 'function hello() { return "world"; }';
      const count = counter.count(code);
      expect(count).toBeGreaterThan(3);
    });

    it('should estimate tokens for JSON', () => {
      const json = '{"key": "value", "number": 123}';
      const count = counter.count(json);
      expect(count).toBeGreaterThan(3);
    });
  });
});

describe('defaultTokenCounter', () => {
  it('should be a singleton', () => {
    expect(defaultTokenCounter).toBeInstanceOf(TokenCounter);
  });

  it('should count tokens', () => {
    const count = defaultTokenCounter.count('Test message');
    expect(count).toBeGreaterThan(0);
  });
});
