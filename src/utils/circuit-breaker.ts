/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping operations after repeated errors
 */

export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',        // Failing fast, rejecting requests
  HALF_OPEN = 'half_open'  // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Failures before opening
  successThreshold: number;      // Successes before closing
  timeout: number;               // Time before trying half-open (ms)
  halfOpenRequests: number;      // Requests in half-open state
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;
  private halfOpenCount: number = 0;
  
  private static defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30000, // 30 seconds
    halfOpenRequests: 3
  };
  
  constructor(
    private name: string,
    config?: Partial<CircuitBreakerConfig>
  ) {
    this.config = { ...CircuitBreaker.defaultConfig, ...config };
  }
  
  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();
    
    if (this.state === CircuitState.OPEN) {
      throw new Error(`[CircuitBreaker:${this.name}] Circuit OPEN - failing fast`);
    }
    
    if (this.state === CircuitState.HALF_OPEN && this.halfOpenCount >= this.config.halfOpenRequests) {
      throw new Error(`[CircuitBreaker:${this.name}] Circuit HALF_OPEN - request limit reached`);
    }
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenCount++;
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Wrap a function with circuit breaker
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return this.execute(() => fn(...args));
    };
  }
  
  private checkState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenCount = 0;
        console.log(`[CircuitBreaker:${this.name}] Transitioning to HALF_OPEN`);
      }
    }
  }
  
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.reset();
        console.log(`[CircuitBreaker:${this.name}] Circuit CLOSED (recovered)`);
      }
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.failures = this.config.failureThreshold;
      console.warn(`[CircuitBreaker:${this.name}] Transitioning to OPEN (failure in half-open)`);
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.warn(`[CircuitBreaker:${this.name}] Circuit OPEN (${this.failures} failures)`);
    }
  }
  
  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCount = 0;
    this.lastFailureTime = 0;
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  getStats(): { failures: number; state: CircuitState } {
    return { failures: this.failures, state: this.state };
  }
  
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
  }
  
  forceClose(): void {
    this.reset();
  }
}

// Create circuit breakers for different operations
export const contextBuildBreaker = new CircuitBreaker('contextBuild', {
  failureThreshold: 3,
  timeout: 10000 // 10 seconds
});

export const storageBreaker = new CircuitBreaker('storage', {
  failureThreshold: 5,
  timeout: 30000 // 30 seconds
});

export const searchBreaker = new CircuitBreaker('search', {
  failureThreshold: 10,
  timeout: 60000 // 60 seconds
});
