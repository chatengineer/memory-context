/**
 * Unit Tests for TokenCounter Recovery (Issue #45)
 */

import { TokenCounter } from '../../src/utils/token-counter';

describe('TokenCounter Recovery', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter();
  });

  it('should reset error count after a successful operation', () => {
    // 1. Mock the encoder to fail
    const originalEncoder = (counter as any).encoder;
    let failCount = 0;
    
    (counter as any).encoder = (text: string) => {
      if (failCount < 2) {
        failCount++;
        throw new Error('Temporary failure');
      }
      return [1, 2, 3]; // Success
    };

    // 2. Trigger failures
    counter.count('test'); // failure 1
    counter.count('test'); // failure 2
    expect((counter as any).errorCount).toBe(2);

    // 3. Trigger success
    counter.count('test'); // success
    expect((counter as any).errorCount).toBe(0); // Should be reset
  });

  it('should stay disabled if failures reach maxErrors persistently', () => {
    // 1. Mock to always fail
    (counter as any).encoder = () => { throw new Error('Permanent failure'); };

    // 2. Trigger max failures
    counter.count('test');
    counter.count('test');
    counter.count('test');
    expect((counter as any).errorCount).toBe(3);

    // 4. Try again - should use estimation without calling encoder
    let called = false;
    (counter as any).encoder = () => { called = true; return []; };
    
    counter.count('test');
    expect(called).toBe(false);
    expect((counter as any).errorCount).toBe(3);
  });
});
