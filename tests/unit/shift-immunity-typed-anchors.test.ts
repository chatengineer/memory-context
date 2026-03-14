import { ShiftImmunity } from '../../src/core/shift-immunity';

describe('ShiftImmunity typed anchors', () => {
  it('should inject typed decision anchors into context output', () => {
    const immunity = new ShiftImmunity();
    immunity.addDecisionAnchor('Use V8 coverage', 'Avoid Babel/minimatch instrumentation failures', {
      impact: 'high',
      alternatives: ['keep Istanbul']
    });

    const anchors = immunity.getAnchors();
    const joined = anchors.join('\n');

    expect(joined).toContain('[QUANTUM_ANCHOR_START]');
    expect(joined).toContain('DECISION: Use V8 coverage');
    expect(joined).toContain('RATIONALE: Avoid Babel/minimatch instrumentation failures');
    expect(immunity.getTypedAnchors()).toHaveLength(1);
  });

  it('should export and import typed anchors safely', () => {
    const immunity = new ShiftImmunity();
    const anchor = immunity.addStateAnchor('activeModel', 'gpt-5.4');

    const exported = immunity.exportAnchors();

    const restored = new ShiftImmunity();
    restored.importAnchors(exported);

    expect(restored.getTypedAnchors()).toHaveLength(1);
    expect(restored.getTypedAnchors()[0].id).toBe(anchor.id);
    expect(restored.getAnchors().join('\n')).toContain('STATE: activeModel = "gpt-5.4"');
  });
});
