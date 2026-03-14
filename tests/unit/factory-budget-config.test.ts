import { MemoryContextFactory } from '../../src/core/factory';

describe('MemoryContextFactory budget configuration', () => {
  it('should pass target utilization and max tokens to BudgetManager in the correct order', async () => {
    const factory = new MemoryContextFactory({
      maxContextTokens: 100000,
      targetUtilization: 0.5
    });

    await factory.initialize();

    expect(factory.getBudget().getBudgetInfo()).toEqual({
      max: 100000,
      target: 50000,
      safety: 47500
    });

    await factory.reset();
  });
});
