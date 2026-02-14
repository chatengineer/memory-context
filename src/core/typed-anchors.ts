/**
 * Typed Quantum Anchors
 * 
 * Medium Priority Issue #12: Typed Quantum Anchors
 * 
 * Provides type-safe, validated quantum anchors with structure
 * and serialization support.
 * 
 * Anchor Types:
 * - DecisionAnchor: Records decisions with rationale
 * - StateAnchor: Key-value state with versioning
 * - ReferenceAnchor: External references/links
 * - CustomAnchor: User-defined anchor types
 */

import { z } from 'zod';

// ============================================================================
// Anchor Schemas
// ============================================================================

export const AnchorTypeSchema = z.enum([
  'decision',
  'state', 
  'reference',
  'custom'
]);

export const DecisionAnchorSchema = z.object({
  type: z.literal('decision'),
  id: z.string(),
  content: z.string(),
  decision: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).optional(),
  impact: z.enum(['high', 'medium', 'low']).optional(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional()
});

export const StateAnchorSchema = z.object({
  type: z.literal('state'),
  id: z.string(),
  content: z.string(),
  key: z.string(),
  value: z.unknown(),
  version: z.number(),
  previousValue: z.unknown().optional(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional()
});

export const ReferenceAnchorSchema = z.object({
  type: z.literal('reference'),
  id: z.string(),
  content: z.string(),
  referenceType: z.enum(['url', 'file', 'issue', 'commit', 'document']),
  reference: z.string(),
  title: z.string().optional(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional()
});

export const CustomAnchorSchema = z.object({
  type: z.literal('custom'),
  id: z.string(),
  content: z.string(),
  customType: z.string(),
  data: z.record(z.unknown()),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional()
});

export const TypedAnchorSchema = z.discriminatedUnion('type', [
  DecisionAnchorSchema,
  StateAnchorSchema,
  ReferenceAnchorSchema,
  CustomAnchorSchema
]);

// ============================================================================
// Type Definitions
// ============================================================================

export type AnchorType = z.infer<typeof AnchorTypeSchema>;
export type DecisionAnchor = z.infer<typeof DecisionAnchorSchema>;
export type StateAnchor = z.infer<typeof StateAnchorSchema>;
export type ReferenceAnchor = z.infer<typeof ReferenceAnchorSchema>;
export type CustomAnchor = z.infer<typeof CustomAnchorSchema>;
export type TypedAnchor = z.infer<typeof TypedAnchorSchema>;

// ============================================================================
// Anchor Factory
// ============================================================================

/**
 * AnchorFactory - Creates and validates typed anchors
 */
export class AnchorFactory {
  private static idCounter = 0;

  /**
   * Generate unique anchor ID
   */
  private static generateId(): string {
    return `anchor_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * Create a decision anchor
   */
  static createDecision(
    decision: string,
    rationale: string,
    options?: {
      alternatives?: string[];
      impact?: 'high' | 'medium' | 'low';
      metadata?: Record<string, unknown>;
    }
  ): DecisionAnchor {
    return DecisionAnchorSchema.parse({
      type: 'decision',
      id: this.generateId(),
      content: `Decision: ${decision}`,
      decision,
      rationale,
      alternatives: options?.alternatives,
      impact: options?.impact,
      timestamp: Date.now(),
      metadata: options?.metadata
    });
  }

  /**
   * Create a state anchor
   */
  static createState(
    key: string,
    value: unknown,
    previousValue?: unknown,
    metadata?: Record<string, unknown>
  ): StateAnchor {
    const existingVersion = previousValue !== undefined ? 1 : 0;
    
    return StateAnchorSchema.parse({
      type: 'state',
      id: this.generateId(),
      content: `State: ${key} = ${JSON.stringify(value)}`,
      key,
      value,
      version: existingVersion + 1,
      previousValue,
      timestamp: Date.now(),
      metadata
    });
  }

  /**
   * Create a reference anchor
   */
  static createReference(
    referenceType: ReferenceAnchor['referenceType'],
    reference: string,
    title?: string,
    metadata?: Record<string, unknown>
  ): ReferenceAnchor {
    return ReferenceAnchorSchema.parse({
      type: 'reference',
      id: this.generateId(),
      content: title ? `Reference: ${title}` : `Reference: ${reference}`,
      referenceType,
      reference,
      title,
      timestamp: Date.now(),
      metadata
    });
  }

  /**
   * Create a custom anchor
   */
  static createCustom(
    customType: string,
    data: Record<string, unknown>,
    content?: string,
    metadata?: Record<string, unknown>
  ): CustomAnchor {
    return CustomAnchorSchema.parse({
      type: 'custom',
      id: this.generateId(),
      content: content || `Custom: ${customType}`,
      customType,
      data,
      timestamp: Date.now(),
      metadata
    });
  }

  /**
   * Validate an anchor
   */
  static validate(anchor: unknown): TypedAnchor | null {
    const result = TypedAnchorSchema.safeParse(anchor);
    return result.success ? result.data : null;
  }

  /**
   * Check if anchor is valid
   */
  static isValid(anchor: unknown): boolean {
    return TypedAnchorSchema.safeParse(anchor).success;
  }
}

// ============================================================================
// Anchor Serializer
// ============================================================================

/**
 * AnchorSerializer - Serialization/deserialization for anchors
 */
export class AnchorSerializer {
  /**
   * Serialize anchor to JSON string
   */
  static serialize(anchor: TypedAnchor): string {
    return JSON.stringify(anchor);
  }

  /**
   * Serialize multiple anchors
   */
  static serializeMany(anchors: TypedAnchor[]): string {
    return JSON.stringify(anchors);
  }

  /**
   * Deserialize anchor from JSON string
   */
  static deserialize(json: string): TypedAnchor | null {
    try {
      const parsed = JSON.parse(json);
      return AnchorFactory.validate(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Deserialize multiple anchors
   */
  static deserializeMany(json: string): TypedAnchor[] {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return [];
      
      return parsed
        .map(a => AnchorFactory.validate(a))
        .filter((a): a is TypedAnchor => a !== null);
    } catch {
      return [];
    }
  }

  /**
   * Convert anchor to string format for context injection
   */
  static toContextString(anchor: TypedAnchor): string {
    const lines = [`[QUANTUM_ANCHOR:${anchor.id}]`];
    
    switch (anchor.type) {
      case 'decision':
        lines.push(`DECISION: ${anchor.decision}`);
        lines.push(`RATIONALE: ${anchor.rationale}`);
        if (anchor.alternatives?.length) {
          lines.push(`ALTERNATIVES: ${anchor.alternatives.join(', ')}`);
        }
        break;
        
      case 'state':
        lines.push(`STATE: ${anchor.key} = ${JSON.stringify(anchor.value)}`);
        lines.push(`VERSION: ${anchor.version}`);
        break;
        
      case 'reference':
        lines.push(`REFERENCE (${anchor.referenceType}): ${anchor.reference}`);
        if (anchor.title) {
          lines.push(`TITLE: ${anchor.title}`);
        }
        break;
        
      case 'custom':
        lines.push(`CUSTOM (${anchor.customType}): ${JSON.stringify(anchor.data)}`);
        break;
    }
    
    lines.push(`[END_ANCHOR:${anchor.id}]`);
    return lines.join('\n');
  }

  /**
   * Parse anchor from context string
   */
  static fromContextString(text: string): TypedAnchor | null {
    const idMatch = text.match(/\[QUANTUM_ANCHOR:([^\]]+)\]/);
    if (!idMatch) return null;

    const id = idMatch[1];
    
    // Try to extract decision anchor
    const decisionMatch = text.match(/DECISION: (.+)/);
    if (decisionMatch) {
      const rationaleMatch = text.match(/RATIONALE: (.+)/);
      return {
        type: 'decision',
        id,
        content: text,
        decision: decisionMatch[1],
        rationale: rationaleMatch?.[1] || '',
        timestamp: Date.now()
      };
    }

    // Try to extract state anchor
    const stateMatch = text.match(/STATE: ([^=]+) = (.+)/);
    if (stateMatch) {
      const versionMatch = text.match(/VERSION: (\d+)/);
      return {
        type: 'state',
        id,
        content: text,
        key: stateMatch[1].trim(),
        value: stateMatch[2],
        version: versionMatch ? parseInt(versionMatch[1]) : 1,
        timestamp: Date.now()
      };
    }

    return null;
  }
}

// ============================================================================
// Anchor Registry
// ============================================================================

/**
 * AnchorRegistry - Manages typed anchors with type-safe operations
 */
export class AnchorRegistry {
  private anchors: Map<string, TypedAnchor> = new Map();
  private byType: Map<AnchorType, Set<string>> = new Map();

  constructor() {
    // Initialize type indexes
    for (const type of ['decision', 'state', 'reference', 'custom'] as AnchorType[]) {
      this.byType.set(type, new Set());
    }
  }

  /**
   * Register an anchor
   */
  register(anchor: TypedAnchor): void {
    if (!AnchorFactory.isValid(anchor)) {
      throw new Error(`Invalid anchor: ${JSON.stringify(anchor)}`);
    }

    this.anchors.set(anchor.id, anchor);
    this.byType.get(anchor.type)!.add(anchor.id);
  }

  /**
   * Get anchor by ID
   */
  get(id: string): TypedAnchor | undefined {
    return this.anchors.get(id);
  }

  /**
   * Get all anchors of a specific type
   */
  getByType(type: AnchorType): TypedAnchor[] {
    const ids = this.byType.get(type);
    if (!ids) return [];
    
    return Array.from(ids)
      .map(id => this.anchors.get(id))
      .filter((a): a is TypedAnchor => a !== undefined);
  }

  /**
   * Get all anchors
   */
  getAll(): TypedAnchor[] {
    return Array.from(this.anchors.values());
  }

  /**
   * Remove an anchor
   */
  remove(id: string): boolean {
    const anchor = this.anchors.get(id);
    if (!anchor) return false;

    this.anchors.delete(id);
    this.byType.get(anchor.type)!.delete(id);
    return true;
  }

  /**
   * Update a state anchor (creates new version)
   */
  updateState(key: string, newValue: unknown): StateAnchor | null {
    const existing = this.getByType('state')
      .filter(a => a.key === key)
      .sort((a, b) => b.version - a.version)[0] as StateAnchor | undefined;

    const newAnchor = AnchorFactory.createState(
      key,
      newValue,
      existing?.value,
      existing?.metadata
    );

    this.register(newAnchor);
    return newAnchor;
  }

  /**
   * Find anchors by content matching
   */
  search(query: string): TypedAnchor[] {
    const lowerQuery = query.toLowerCase();
    
    return this.getAll().filter(anchor => {
      if (anchor.content.toLowerCase().includes(lowerQuery)) return true;
      
      switch (anchor.type) {
        case 'decision':
          return anchor.decision.toLowerCase().includes(lowerQuery) ||
                 anchor.rationale.toLowerCase().includes(lowerQuery);
        case 'state':
          return anchor.key.toLowerCase().includes(lowerQuery);
        case 'reference':
          return anchor.reference.toLowerCase().includes(lowerQuery) ||
                 anchor.title?.toLowerCase().includes(lowerQuery);
        case 'custom':
          return JSON.stringify(anchor.data).toLowerCase().includes(lowerQuery);
        default:
          return false;
      }
    });
  }

  /**
   * Export all anchors
   */
  export(): string {
    return AnchorSerializer.serializeMany(this.getAll());
  }

  /**
   * Import anchors
   */
  import(json: string): number {
    const anchors = AnchorSerializer.deserializeMany(json);
    for (const anchor of anchors) {
      this.register(anchor);
    }
    return anchors.length;
  }

  /**
   * Clear all anchors
   */
  clear(): void {
    this.anchors.clear();
    for (const set of this.byType.values()) {
      set.clear();
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byType: Record<AnchorType, number>;
  } {
    const stats: Record<AnchorType, number> = {
      decision: 0,
      state: 0,
      reference: 0,
      custom: 0
    };

    for (const [type, ids] of this.byType) {
      stats[type] = ids.size;
    }

    return {
      total: this.anchors.size,
      byType: stats
    };
  }
}

// Export singleton registry
export const anchorRegistry = new AnchorRegistry();
