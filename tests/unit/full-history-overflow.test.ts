/**
 * Unit Tests for FullHistory Buffer Overflow and Metrics
 */

import { FullHistory } from '../../src/persistence/full-history';
import { TieredStorage } from '../../src/persistence/tiered-storage';
import { metricsRegistry } from '../../src/observability/metrics';

describe('FullHistory Bounded Buffer', () => {
  let storage: TieredStorage;
  let history: FullHistory;

  beforeEach(async () => {
    storage = new TieredStorage();
    history = new FullHistory(storage);
    // Note: NOT calling history.initialize() to test pending buffer
  });

  it('should limit pending messages and drop oldest', async () => {
    // MAX_PENDING_MESSAGES is 1000.
    // Let's add 1010 messages.
    for (let i = 0; i < 1010; i++) {
      await history.addMessage({ content: `Msg ${i}` });
    }
    
    const messages = await history.getAllMessages();
    expect(messages.length).toBe(1000);
    // Oldest should be Msg 10
    expect(messages[0].content).toBe('Msg 10');
    // Newest should be Msg 1009
    expect(messages[999].content).toBe('Msg 1009');
  });

  it('should report healthy when buffer is empty', async () => {
    await history.initialize();
    const health = await metricsRegistry.runHealthCheck('full_history_pending_buffer');
    expect(health.status).toBe('healthy');
  });

  it('should correctly execute health checks (Issue #49 fix)', async () => {
    let checkCalled = false;
    metricsRegistry.registerHealthCheck('test_check', async () => {
      checkCalled = true;
      return {
        name: 'test_check',
        status: 'healthy',
        message: 'OK',
        lastCheck: Date.now()
      };
    });

    const result = await metricsRegistry.runHealthCheck('test_check');
    expect(checkCalled).toBe(true);
    expect(result.status).toBe('healthy');
  });
});
