/**
 * Unit Tests for Circuit Breaker
 */

import { CircuitBreaker, CircuitState } from '../src/utils/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      halfOpenRequests: 2
    });
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero failures initially', () => {
      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
    });
  });

  describe('execute()', () => {
    it('should execute successful operation', async () => {
      const result = await breaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should track failures', async () => {
      const failingFn = () => Promise.reject(new Error('test error'));
      
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failingFn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should fail fast when OPEN', async () => {
      // Force open
      breaker.forceOpen();
      
      await expect(
        breaker.execute(() => Promise.resolve('should not run'))
      ).rejects.toThrow('Circuit OPEN');
    });
  });

  describe('state transitions', () => {
    it('should transition to OPEN after threshold', async () => {
      const failingFn = () => Promise.reject(new Error('fail'));
      
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failingFn); } catch {}
      }
      
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      breaker.forceOpen();
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Next check should transition
      try {
        await breaker.execute(() => Promise.resolve('ok'));
      } catch {}
      
      // Should be in HALF_OPEN or CLOSED depending on success
      const state = breaker.getState();
      expect([CircuitState.HALF_OPEN, CircuitState.CLOSED]).toContain(state);
    });
  });

  describe('force operations', () => {
    it('should force open', () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should force close', () => {
      breaker.forceOpen();
      breaker.forceClose();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('wrap()', () => {
    it('should wrap function with circuit breaker', async () => {
      const wrapped = breaker.wrap(async (x: number) => x * 2);
      const result = await wrapped(5);
      expect(result).toBe(10);
    });
  });
});
