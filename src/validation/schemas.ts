/**
 * Input Validation System using Zod
 * 
 * High Priority Issue #10: Validation Implementation
 * 
 * Comprehensive input validation for all memory-context operations
 * with detailed error messages and type safety.
 */

import { z } from 'zod';

// ============================================================================
// Core Schemas
// ============================================================================

/**
 * Message schema - validates incoming messages
 */
export const MessageSchema = z.object({
  id: z.string().optional(),
  content: z.string().min(1, 'Message content cannot be empty'),
  role: z.enum(['user', 'assistant', 'system']).optional(),
  timestamp: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional()
}).passthrough(); // Allow additional fields

export type ValidatedMessage = z.infer<typeof MessageSchema>;

/**
 * Stored message schema - includes storage metadata
 */
export const StoredMessageSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  tokenCount: z.number().int().nonnegative(),
  tier: z.enum(['L0', 'L1', 'L2']),
  timestamp: z.number().int().positive(),
  accessCount: z.number().int().nonnegative(),
  lastAccess: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional()
});

export type ValidatedStoredMessage = z.infer<typeof StoredMessageSchema>;

/**
 * Tiered storage configuration schema
 */
export const TieredStorageConfigSchema = z.object({
  l0MaxTokens: z.number().int().positive().default(50000),
  l1MaxTokens: z.number().int().positive().default(500000),
  l2MaxTokens: z.number().int().positive().default(2000000),
  l2Compress: z.boolean().default(true),
  evictionPolicy: z.enum(['lru', 'lfu', 'fifo']).default('lru'),
  persistPath: z.string().optional()
});

export type ValidatedTieredStorageConfig = z.infer<typeof TieredStorageConfigSchema>;

/**
 * Memory context configuration schema
 */
export const MemoryContextConfigSchema = z.object({
  maxContextTokens: z.number().int().positive().default(128000),
  targetUtilization: z.number().min(0).max(1).default(0.95),
  zeroShiftEnabled: z.boolean().default(true),
  quantumAnchorsEnabled: z.boolean().default(true),
  persistenceEnabled: z.boolean().default(true),
  tieredStorageConfig: TieredStorageConfigSchema.optional()
});

export type ValidatedMemoryContextConfig = z.infer<typeof MemoryContextConfigSchema>;

/**
 * Relevance scoring configuration schema
 */
export const RelevanceConfigSchema = z.object({
  keywordWeight: z.number().min(0).max(1).default(0.35),
  recencyWeight: z.number().min(0).max(1).default(0.25),
  priorityWeight: z.number().min(0).max(1).default(0.20),
  densityWeight: z.number().min(0).max(1).default(0.10),
  overlapWeight: z.number().min(0).max(1).default(0.10),
  halfLife: z.number().positive().default(86400000), // 24 hours
  maxAge: z.number().positive().default(604800000), // 7 days
  priorityKeywords: z.set(z.string()).optional(),
  metadataWeights: z.record(z.number()).optional()
}).refine(
  (data) => {
    const weights = [
      data.keywordWeight,
      data.recencyWeight,
      data.priorityWeight,
      data.densityWeight,
      data.overlapWeight
    ];
    const sum = weights.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 1.0) < 0.01; // Allow small floating point errors
  },
  { message: 'Weight factors must sum to approximately 1.0' }
);

export type ValidatedRelevanceConfig = z.infer<typeof RelevanceConfigSchema>;

/**
 * BM25 configuration schema
 */
export const BM25ConfigSchema = z.object({
  k1: z.number().positive().default(1.2),
  b: z.number().min(0).max(1).default(0.75),
  avgdl: z.number().positive().optional(),
  minDocFreq: z.number().int().nonnegative().default(2),
  minTermLength: z.number().int().nonnegative().default(2),
  stopWords: z.set(z.string()).optional()
});

export type ValidatedBM25Config = z.infer<typeof BM25ConfigSchema>;

/**
 * Search query schema
 */
export const SearchQuerySchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  limit: z.number().int().positive().max(1000).optional(),
  filters: z.record(z.unknown()).optional(),
  tier: z.enum(['L0', 'L1', 'L2', 'all']).optional()
});

export type ValidatedSearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * Quantum anchor schema
 */
export const QuantumAnchorSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(['decision', 'state', 'reference', 'custom']),
  createdAt: z.number().int().positive(),
  priority: z.number().int().min(0).max(10).default(5),
  metadata: z.record(z.unknown()).optional()
});

export type ValidatedQuantumAnchor = z.infer<typeof QuantumAnchorSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Array<{
    path: string;
    message: string;
    code: string;
  }>;
}

/**
 * Validate data against a schema
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }

  return {
    success: false,
    errors: result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code
    }))
  };
}

/**
 * Validate a message
 */
export function validateMessage(data: unknown): ValidationResult<ValidatedMessage> {
  return validate(MessageSchema, data);
}

/**
 * Validate storage configuration
 */
export function validateStorageConfig(data: unknown): ValidationResult<ValidatedTieredStorageConfig> {
  return validate(TieredStorageConfigSchema, data);
}

/**
 * Validate memory context configuration
 */
export function validateMemoryContextConfig(data: unknown): ValidationResult<ValidatedMemoryContextConfig> {
  return validate(MemoryContextConfigSchema, data);
}

/**
 * Validate search query
 */
export function validateSearchQuery(data: unknown): ValidationResult<ValidatedSearchQuery> {
  return validate(SearchQuerySchema, data);
}

/**
 * Validate a quantum anchor
 */
export function validateQuantumAnchor(data: unknown): ValidationResult<ValidatedQuantumAnchor> {
  return validate(QuantumAnchorSchema, data);
}

// ============================================================================
// Input Sanitization
// ============================================================================

/**
 * Sanitize string input - remove potentially dangerous content
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\0/g, '')               // Remove null bytes
    .trim();
}

/**
 * Sanitize message content
 */
export function sanitizeMessage(message: ValidatedMessage): ValidatedMessage {
  return {
    ...message,
    content: sanitizeString(message.content)
  };
}

/**
 * Sanitize search query
 */
export function sanitizeSearchQuery(query: string): string {
  return sanitizeString(query)
    .replace(/[<>\"'\\]/g, '') // Remove potentially dangerous characters
    .slice(0, 1000);           // Limit query length
}

// ============================================================================
// Runtime Type Guards
// ============================================================================

/**
 * Check if value is a valid message
 */
export function isValidMessage(value: unknown): value is ValidatedMessage {
  return MessageSchema.safeParse(value).success;
}

/**
 * Check if value is a valid stored message
 */
export function isValidStoredMessage(value: unknown): value is ValidatedStoredMessage {
  return StoredMessageSchema.safeParse(value).success;
}

/**
 * Check if value is valid storage config
 */
export function isValidStorageConfig(value: unknown): value is ValidatedTieredStorageConfig {
  return TieredStorageConfigSchema.safeParse(value).success;
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Format validation errors for display
 */
export function formatValidationErrors(
  errors: ValidationResult<unknown>['errors']
): string {
  if (!errors || errors.length === 0) return 'No errors';

  return errors
    .map(e => `  - ${e.path ? `${e.path}: ` : ''}${e.message} (${e.code})`)
    .join('\n');
}

/**
 * Create a user-friendly error message
 */
export function createValidationErrorMessage(
  context: string,
  errors: ValidationResult<unknown>['errors']
): string {
  return `Validation failed for ${context}:\n${formatValidationErrors(errors)}`;
}

// ============================================================================
// Schema Builder Helpers
// ============================================================================

/**
 * Create a custom schema with description
 */
export function createDescribedSchema<T>(
  schema: z.ZodSchema<T>,
  description: string
): z.ZodSchema<T> {
  return schema.describe(description);
}

/**
 * Extend a schema with additional fields
 */
export function extendSchema<T extends z.ZodRawShape, U extends z.ZodRawShape>(
  base: z.ZodObject<T>,
  extension: U
): z.ZodObject<T & U> {
  return base.extend(extension) as z.ZodObject<T & U>;
}

// Export all schemas for external use
export const schemas = {
  message: MessageSchema,
  storedMessage: StoredMessageSchema,
  tieredStorageConfig: TieredStorageConfigSchema,
  memoryContextConfig: MemoryContextConfigSchema,
  relevanceConfig: RelevanceConfigSchema,
  bm25Config: BM25ConfigSchema,
  searchQuery: SearchQuerySchema,
  quantumAnchor: QuantumAnchorSchema
};
