/**
 * Multi-Model Support
 * 
 * Low Priority #19: Multi-Model Support
 * 
 * Provides per-model token counting and context limits:
 * - Model-specific tokenizers
 * - Dynamic model detection
 * - Context limit profiles
 */

// ============================================================================
// Model Profiles
// ============================================================================

export interface ModelProfile {
  id: string;
  family: string;
  contextWindow: number;
  maxOutputTokens: number;
  tokenizerType: 'cl100k' | 'o200k' | 'p50k' | 'r50k';
  pricing: {
    input: number;  // per 1M tokens
    output: number; // per 1M tokens
  };
}

export const MODEL_PROFILES: Record<string, ModelProfile> = {
  // OpenAI GPT-4 Family
  'gpt-4o': {
    id: 'gpt-4o',
    family: 'gpt-4',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    tokenizerType: 'o200k',
    pricing: { input: 5.00, output: 15.00 }
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    family: 'gpt-4',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    tokenizerType: 'o200k',
    pricing: { input: 0.15, output: 0.60 }
  },
  'gpt-4-turbo': {
    id: 'gpt-4-turbo',
    family: 'gpt-4',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 10.00, output: 30.00 }
  },
  'gpt-4': {
    id: 'gpt-4',
    family: 'gpt-4',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 30.00, output: 60.00 }
  },

  // OpenAI GPT-3.5 Family
  'gpt-3.5-turbo': {
    id: 'gpt-3.5-turbo',
    family: 'gpt-3.5',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 0.50, output: 1.50 }
  },

  // Claude 3 Family (approximate token counts)
  'claude-3-opus': {
    id: 'claude-3-opus',
    family: 'claude-3',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',  // Approximate
    pricing: { input: 15.00, output: 75.00 }
  },
  'claude-3-sonnet': {
    id: 'claude-3-sonnet',
    family: 'claude-3',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 3.00, output: 15.00 }
  },
  'claude-3-haiku': {
    id: 'claude-3-haiku',
    family: 'claude-3',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 0.25, output: 1.25 }
  },

  // Gemini Family
  'gemini-pro': {
    id: 'gemini-pro',
    family: 'gemini',
    contextWindow: 32760,
    maxOutputTokens: 2048,
    tokenizerType: 'cl100k',  // Approximate
    pricing: { input: 0.50, output: 1.50 }
  },
  'gemini-1.5-pro': {
    id: 'gemini-1.5-pro',
    family: 'gemini',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    tokenizerType: 'cl100k',
    pricing: { input: 3.50, output: 10.50 }
  },

  // Llama Family
  'llama-3-70b': {
    id: 'llama-3-70b',
    family: 'llama',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 0.70, output: 0.90 }
  },
  'llama-3-8b': {
    id: 'llama-3-8b',
    family: 'llama',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 0.05, output: 0.10 }
  },

  // Mistral Family
  'mistral-large': {
    id: 'mistral-large',
    family: 'mistral',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 8.00, output: 24.00 }
  },
  'mistral-medium': {
    id: 'mistral-medium',
    family: 'mistral',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    tokenizerType: 'cl100k',
    pricing: { input: 2.70, output: 8.10 }
  }
};

// ============================================================================
// Model Detection
// ============================================================================

/**
 * Detect model from string identifier
 */
export function detectModel(modelString: string): ModelProfile | null {
  const normalized = modelString.toLowerCase().trim();
  
  // Direct match
  if (MODEL_PROFILES[normalized]) {
    return MODEL_PROFILES[normalized];
  }
  
  // Pattern matching for variants
  const patterns: Array<[RegExp, string]> = [
    [/gpt-4o-mini/, 'gpt-4o-mini'],
    [/gpt-4o/, 'gpt-4o'],
    [/gpt-4-turbo/, 'gpt-4-turbo'],
    [/gpt-4-32k/, 'gpt-4'],
    [/gpt-4/, 'gpt-4'],
    [/gpt-3.5-turbo-16k/, 'gpt-3.5-turbo'],
    [/gpt-3.5/, 'gpt-3.5-turbo'],
    [/claude-3-opus/, 'claude-3-opus'],
    [/claude-3-sonnet/, 'claude-3-sonnet'],
    [/claude-3-haiku/, 'claude-3-haiku'],
    [/claude-3/, 'claude-3-sonnet'],
    [/gemini-1.5-pro/, 'gemini-1.5-pro'],
    [/gemini-pro/, 'gemini-pro'],
    [/gemini/, 'gemini-pro'],
    [/llama-3-70b/, 'llama-3-70b'],
    [/llama-3-8b/, 'llama-3-8b'],
    [/llama-3/, 'llama-3-70b'],
    [/mistral-large/, 'mistral-large'],
    [/mistral-medium/, 'mistral-medium'],
    [/mistral/, 'mistral-medium']
  ];
  
  for (const [pattern, modelId] of patterns) {
    if (pattern.test(normalized)) {
      return MODEL_PROFILES[modelId];
    }
  }
  
  return null;
}

/**
 * Get default model profile
 */
export function getDefaultModel(): ModelProfile {
  return MODEL_PROFILES['gpt-4o'];
}

// ============================================================================
// Multi-Model Token Counter
// ============================================================================

import { TokenCounter } from './token-counter';

export class MultiModelTokenCounter {
  private counters: Map<string, TokenCounter> = new Map();
  private currentModel: ModelProfile;

  constructor(initialModel: string = 'gpt-4o') {
    const model = detectModel(initialModel) || getDefaultModel();
    this.currentModel = model;
  }

  /**
   * Set the current model
   */
  setModel(modelId: string): void {
    const model = detectModel(modelId);
    if (model) {
      this.currentModel = model;
    }
  }

  /**
   * Get the current model profile
   */
  getCurrentModel(): ModelProfile {
    return this.currentModel;
  }

  /**
   * Get token counter for a model
   */
  getCounter(modelId?: string): TokenCounter {
    const targetModel = modelId 
      ? (detectModel(modelId) || this.currentModel)
      : this.currentModel;
    
    if (!this.counters.has(targetModel.id)) {
      this.counters.set(targetModel.id, new TokenCounter(targetModel.id));
    }
    
    return this.counters.get(targetModel.id)!;
  }

  /**
   * Count tokens for current model
   */
  count(text: string): number {
    return this.getCounter().count(text);
  }

  /**
   * Count tokens for specific model
   */
  countForModel(text: string, modelId: string): number {
    return this.getCounter(modelId).count(text);
  }

  /**
   * Get context limit for current model
   */
  getContextLimit(): number {
    return this.currentModel.contextWindow;
  }

  /**
   * Get safe context limit (reserves space for output)
   */
  getSafeContextLimit(): number {
    return this.currentModel.contextWindow - this.currentModel.maxOutputTokens - 500;
  }

  /**
   * Check if tokens fit within context
   */
  fitsInContext(tokenCount: number, modelId?: string): boolean {
    const model = modelId 
      ? (detectModel(modelId) || this.currentModel)
      : this.currentModel;
    return tokenCount <= this.getSafeContextLimit();
  }

  /**
   * Calculate cost for tokens
   */
  calculateCost(inputTokens: number, outputTokens: number = 0): number {
    const inputCost = (inputTokens / 1000000) * this.currentModel.pricing.input;
    const outputCost = (outputTokens / 1000000) * this.currentModel.pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Get model statistics
   */
  getModelStats(): {
    model: ModelProfile;
    safeContextLimit: number;
    countersLoaded: number;
  } {
    return {
      model: this.currentModel,
      safeContextLimit: this.getSafeContextLimit(),
      countersLoaded: this.counters.size
    };
  }
}

// ============================================================================
// Model Switcher
// ============================================================================

export class ModelSwitcher {
  private currentModelId: string;
  private history: Array<{ from: string; to: string; timestamp: number }> = [];

  constructor(initialModel: string = 'gpt-4o') {
    this.currentModelId = initialModel;
  }

  /**
   * Switch to a new model
   */
  switch(newModelId: string): ModelProfile | null {
    const model = detectModel(newModelId);
    if (!model) return null;

    this.history.push({
      from: this.currentModelId,
      to: newModelId,
      timestamp: Date.now()
    });

    this.currentModelId = newModelId;
    return model;
  }

  /**
   * Get current model
   */
  getCurrentModel(): string {
    return this.currentModelId;
  }

  /**
   * Get current model profile
   */
  getCurrentProfile(): ModelProfile | null {
    return detectModel(this.currentModelId);
  }

  /**
   * Get switch history
   */
  getHistory(): Array<{ from: string; to: string; timestamp: number }> {
    return [...this.history];
  }
}

// ============================================================================
// Exports
// ============================================================================

export const multiModelCounter = new MultiModelTokenCounter();
export const modelSwitcher = new ModelSwitcher();
