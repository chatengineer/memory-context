import { MemoryContextFactory } from '../../src/core/factory';

describe('JITEngine advanced context assembly', () => {
  it('should prioritize query-relevant history and inject typed anchors', async () => {
    const factory = new MemoryContextFactory({
      maxContextTokens: 2000,
      targetUtilization: 0.8
    });

    await factory.initialize();

    const history = factory.getHistory();
    const immunity = factory.getImmunity();
    const engine = factory.getEngine();

    await history.addMessage({ content: 'Notes about gardening and tomatoes', role: 'assistant' });
    await history.addMessage({ content: 'Critical Redis bug fix deployed to production', role: 'assistant' });
    await history.addMessage({ content: 'Discussion about unrelated vacation planning', role: 'user' });

    immunity.addDecisionAnchor(
      'Keep production bug-fix context durable',
      'Operational incidents must survive context rebuilds',
      { impact: 'high' }
    );

    const context = await engine.buildContext({ content: 'What was the Redis bug fix?' });

    expect(context).toContain('DECISION: Keep production bug-fix context durable');
    expect(context).toContain('Critical Redis bug fix deployed to production');
  });
});
