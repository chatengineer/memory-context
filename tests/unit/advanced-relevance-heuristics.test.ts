import { AdvancedRelevanceScorer } from '../../src/heuristics/advanced-relevance';

describe('Advanced relevance heuristic upgrades', () => {
  it('should reward stronger query coverage and exact phrase matches', () => {
    const scorer = new AdvancedRelevanceScorer();
    const query = 'redis failover runbook';

    const strong = scorer.computeScore('Redis failover runbook for production recovery', { timestamp: Date.now() }, { query, referenceTime: Date.now() });
    const weak = scorer.computeScore('Redis notes and random recovery ideas', { timestamp: Date.now() }, { query, referenceTime: Date.now() });

    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.factors.queryCoverage).toBeGreaterThan(weak.factors.queryCoverage);
    expect(strong.factors.exactPhrase).toBeGreaterThanOrEqual(weak.factors.exactPhrase);
  });
});
