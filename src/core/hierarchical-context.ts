// src/core/hierarchical-context.ts
// Implements a 5‑layer hierarchical context (L0‑L4) with shift‑immune anchors.

/**
 * Layer – enumeration of hierarchy levels.
 * L0: working (ephemeral, per‑turn)
 * L1: session (conversation session)
 * L2: persistent (long‑term knowledge)
 * L3: core (plugin core directives)
 * L4: infinite (global, immutable anchors)
 */
export enum Layer {
  L0 = 0,
  L1 = 1,
  L2 = 2,
  L3 = 3,
  L4 = 4,
}

/**
 * HierarchicalContext – stores content per layer and provides retrieval helpers.
 * No compaction is performed; content is accumulated for JIT rebuilding.
 */
export class HierarchicalContext {
  private layers: Map<Layer, string[]>;

  constructor() {
    this.layers = new Map();
    // Initialise empty arrays for each layer
    Object.values(Layer)
      .filter(v => typeof v === "number")
      .forEach((layer) => this.layers.set(layer as Layer, []));
  }

  /** Add content to a specific layer. */
  addContent(layer: Layer, content: string): void {
    const bucket = this.layers.get(layer);
    if (bucket) {
      bucket.push(content);
    }
  }

  /** Retrieve all layers as an array of string arrays, ordered L0 → L4. */
  getAllLayers(): string[][] {
    const result: string[][] = [];
    for (let i = Layer.L0; i <= Layer.L4; i++) {
      const bucket = this.layers.get(i as Layer) ?? [];
      result.push(bucket);
    }
    return result;
  }

  /** Clear a specific layer – used rarely, not part of normal workflow. */
  clearLayer(layer: Layer): void {
    this.layers.set(layer, []);
  }
}
