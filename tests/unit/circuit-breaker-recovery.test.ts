import { CircuitBreaker, CircuitState } from '../../src/utils/circuit-breaker';

describe('CircuitBreaker Recovery', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker', {
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 100, // 100ms
      halfOpenRequests: 1
    });
  });

  it('should recover from OPEN to HALF_OPEN and then CLOSED', async () => {
    // 1. Trigger OPEN state
    const failingFn = async () => { throw new Error('fail'); };
    await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
    await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
    
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // 2. Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    // 3. First call should transition to HALF_OPEN and succeed
    const successFn = async () => 'success';
    const result = await breaker.execute(successFn);
    
    expect(result).toBe('success');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should respect halfOpenRequests limit in HALF_OPEN state', async () => {
    breaker = new CircuitBreaker('limit-test', {
      failureThreshold: 1,
      timeout: 10,
      halfOpenRequests: 1
    });

    // OPEN it
    await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait
    await new Promise(resolve => setTimeout(resolve, 20));

    // First request enters HALF_OPEN
    // Use a slow function to stay in HALF_OPEN
    let resolveFirst: any;
    const firstRequest = breaker.execute(() => new Promise(resolve => { resolveFirst = resolve; }));

    // Second request should be rejected because halfOpenCount is 1 and limit is 1
    await expect(breaker.execute(async () => 'second')).rejects.toThrow('request limit reached');

    resolveFirst('done');
    await firstRequest;
  });
});
