import { AdvancedRelevanceScorer } from '../../src/heuristics/advanced-relevance';

describe('AdvancedRelevanceScorer adaptive tuning', () => {
  it('should update weights after positive selection outcomes', () => {
    const scorer = new AdvancedRelevanceScorer();
    const before = scorer.getAdaptiveStats();

    const result = scorer.computeScore(
      'Redis failover runbook for production',
      { timestamp: Date.now() },
      { query: 'redis failover runbook', referenceTime: Date.now() }
    );

    scorer.recordSelectionOutcome(result, true);
    const after = scorer.getAdaptiveStats();

    expect(after.updates).toBeGreaterThan(before.updates);
    expect(after.lastAdjustmentAt).toBeGreaterThan(0);
    expect(after.weights.queryCoverageWeight).not.toBe(before.weights.queryCoverageWeight);
  });
});
