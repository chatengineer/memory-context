import { ShiftImmunity } from '../../src/core/shift-immunity';

describe('ShiftImmunity semantic anchor deduplication', () => {
  it('should collapse semantically identical decision anchors', () => {
    const immunity = new ShiftImmunity();

    const first = immunity.addDecisionAnchor('Keep typed anchors durable across reloads', 'Important system directive');
    const second = immunity.addDecisionAnchor(' keep typed anchors durable across reloads ', 'important   system directive');

    expect(second.id).toBe(first.id);
    expect(immunity.getTypedAnchors()).toHaveLength(1);
  });
});
