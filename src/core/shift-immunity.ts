// src/core/shift-immunity.ts
// Provides shift‑immune anchors that survive model switches and context rebuilds.
// Quantum anchors are unbreakable continuity markers.

import { defaultLogger } from '../observability/metrics';

/**
 * ShiftImmunity – manages a set of "quantum anchors" that are always injected
 * into the rebuilt context, guaranteeing continuity across model switches.
 */
export class ShiftImmunity {
  private anchors: Set<string>;

  constructor() {
    this.anchors = new Set<string>();
    // Initialise with a default anchor that marks the start of the plugin context
    this.anchors.add("[QUANTUM_ANCHOR_START]");
    this.anchors.add("[QUANTUM_ANCHOR_END]");
  }

  /** Add a custom anchor (e.g., a marker for a critical decision). */
  addAnchor(anchor: string): void {
    this.anchors.add(anchor);
  }

  /** Retrieve all anchors in insertion order (Set preserves insertion order). */
  getAnchors(): string[] {
    return Array.from(this.anchors);
  }

  /** Preserve anchors across a model switch – a no‑op but kept for API symmetry. */
  preserveAnchors(): void {
    // In a real implementation we might serialize/deserialize anchors.
    // Here we simply ensure the set remains unchanged.
    defaultLogger.info('Preserving anchors across model switch', { component: 'ShiftImmunity' });
  }
}
