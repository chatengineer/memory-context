// src/core/shift-immunity.ts
// Provides shift‑immune anchors that survive model switches and context rebuilds.
// Quantum anchors are unbreakable continuity markers.

import { defaultLogger } from '../observability/metrics';
import {
  AnchorFactory,
  AnchorSerializer,
  TypedAnchor,
  DecisionAnchor,
  StateAnchor,
  ReferenceAnchor,
  CustomAnchor
} from './typed-anchors';

/**
 * ShiftImmunity – manages a set of anchors that are always injected
 * into the rebuilt context, guaranteeing continuity across model switches.
 *
 * Supports both legacy raw string anchors and structured typed anchors.
 */
export class ShiftImmunity {
  private rawAnchors: Set<string>;
  private typedAnchors: Map<string, TypedAnchor>;
  private semanticIndex: Map<string, string>;

  constructor() {
    this.rawAnchors = new Set<string>();
    this.typedAnchors = new Map<string, TypedAnchor>();
    this.semanticIndex = new Map<string, string>();

    // Legacy sentinels: keep them stable for backwards compatibility.
    this.rawAnchors.add('[QUANTUM_ANCHOR_START]');
    this.rawAnchors.add('[QUANTUM_ANCHOR_END]');
  }

  /** Add a raw anchor string (legacy API). */
  addAnchor(anchor: string): void {
    if (!anchor?.trim()) return;
    this.rawAnchors.add(anchor.trim());
  }

  /** Add or replace a typed anchor, deduplicating semantically identical anchors. */
  addTypedAnchor(anchor: TypedAnchor): TypedAnchor {
    const semanticKey = this.getSemanticKey(anchor);
    const existingId = this.semanticIndex.get(semanticKey);
    if (existingId) {
      const existing = this.typedAnchors.get(existingId);
      if (existing) return existing;
    }

    this.typedAnchors.set(anchor.id, anchor);
    this.semanticIndex.set(semanticKey, anchor.id);
    return anchor;
  }

  addDecisionAnchor(
    decision: string,
    rationale: string,
    options?: {
      alternatives?: string[];
      impact?: 'high' | 'medium' | 'low';
      metadata?: Record<string, unknown>;
    }
  ): DecisionAnchor {
    const anchor = AnchorFactory.createDecision(decision, rationale, options);
    return this.addTypedAnchor(anchor) as DecisionAnchor;
  }

  addStateAnchor(
    key: string,
    value: unknown,
    previousValue?: unknown,
    metadata?: Record<string, unknown>
  ): StateAnchor {
    const anchor = AnchorFactory.createState(key, value, previousValue, metadata);
    return this.addTypedAnchor(anchor) as StateAnchor;
  }

  addReferenceAnchor(
    referenceType: ReferenceAnchor['referenceType'],
    reference: string,
    title?: string,
    metadata?: Record<string, unknown>
  ): ReferenceAnchor {
    const anchor = AnchorFactory.createReference(referenceType, reference, title, metadata);
    return this.addTypedAnchor(anchor) as ReferenceAnchor;
  }

  addCustomAnchor(
    customType: string,
    data: Record<string, unknown>,
    content?: string,
    metadata?: Record<string, unknown>
  ): CustomAnchor {
    const anchor = AnchorFactory.createCustom(customType, data, content, metadata);
    return this.addTypedAnchor(anchor) as CustomAnchor;
  }

  removeAnchor(anchorIdOrContent: string): boolean {
    const existing = this.typedAnchors.get(anchorIdOrContent);
    if (existing) {
      this.semanticIndex.delete(this.getSemanticKey(existing));
    }
    const removedTyped = this.typedAnchors.delete(anchorIdOrContent);
    const removedRaw = this.rawAnchors.delete(anchorIdOrContent);
    return removedTyped || removedRaw;
  }

  clearTypedAnchors(): void {
    this.typedAnchors.clear();
    this.semanticIndex.clear();
  }

  /** Retrieve typed anchors in insertion order. */
  getTypedAnchors(): TypedAnchor[] {
    return Array.from(this.typedAnchors.values());
  }

  /** Retrieve all anchors as injectable context strings. */
  getAnchors(): string[] {
    const result: string[] = [];

    for (const anchor of this.rawAnchors) {
      result.push(anchor);
    }

    for (const anchor of this.typedAnchors.values()) {
      result.push(AnchorSerializer.toContextString(anchor));
    }

    return result;
  }

  exportAnchors(): {
    raw: string[];
    typed: TypedAnchor[];
  } {
    return {
      raw: Array.from(this.rawAnchors),
      typed: this.getTypedAnchors()
    };
  }

  importAnchors(data: { raw?: string[]; typed?: unknown[] }): void {
    if (Array.isArray(data.raw)) {
      this.rawAnchors = new Set(data.raw.filter(Boolean));
    }

    this.typedAnchors.clear();
    this.semanticIndex.clear();
    if (Array.isArray(data.typed)) {
      for (const candidate of data.typed) {
        const validated = AnchorFactory.validate(candidate);
        if (validated) {
          this.addTypedAnchor(validated);
        }
      }
    }
  }

  /** Preserve anchors across a model switch. */
  preserveAnchors(): void {
    defaultLogger.info('Preserving anchors across model switch', {
      component: 'ShiftImmunity',
      rawAnchors: this.rawAnchors.size,
      typedAnchors: this.typedAnchors.size
    });
  }

  private getSemanticKey(anchor: TypedAnchor): string {
    switch (anchor.type) {
      case 'decision':
        return `decision:${this.normalize(anchor.decision)}::${this.normalize(anchor.rationale)}`;
      case 'state':
        return `state:${this.normalize(anchor.key)}::${JSON.stringify(anchor.value)}`;
      case 'reference':
        return `reference:${anchor.referenceType}:${this.normalize(anchor.reference)}::${this.normalize(anchor.title || '')}`;
      case 'custom':
        return `custom:${this.normalize(anchor.customType)}::${JSON.stringify(anchor.data)}`;
    }
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
