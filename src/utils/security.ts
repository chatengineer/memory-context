/**
 * Security Utilities
 *
 * Low Priority Issue #18: Security Hardening
 *
 * Provides security measures:
 * - Input sanitization
 * - SQL injection prevention
 * - Path traversal protection
 * - Audit logging
 */

import * as crypto from 'crypto';

// ============================================================================
// Input Sanitization
// ============================================================================

export interface SanitizationOptions {
  maxStringLength: number;
  allowedTags: string[];
  stripNullBytes: boolean;
  escapeHtml: boolean;
}

const DEFAULT_SANITIZATION_OPTIONS: SanitizationOptions = {
  maxStringLength: 100000,
  allowedTags: [],
  stripNullBytes: true,
  escapeHtml: false
};

/**
 * Sanitize user input
 */
export function sanitizeInput(
  input: string,
  options: Partial<SanitizationOptions> = {}
): string {
  const opts = { ...DEFAULT_SANITIZATION_OPTIONS, ...options };

  let sanitized = input;

  // Strip null bytes
  if (opts.stripNullBytes) {
    sanitized = sanitized.replace(/\0/g, '');
  }

  // Limit length
  if (sanitized.length > opts.maxStringLength) {
    sanitized = sanitized.substring(0, opts.maxStringLength);
  }

  // Recursively remove dangerous patterns to prevent bypasses (e.g., javajavascript:script:)
  let lastSanitized: string;
  let iterations = 0;
  const maxIterations = 10; // Safety limit

  do {
    lastSanitized = sanitized;
    sanitized = sanitized
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
    iterations++;
  } while (sanitized !== lastSanitized && iterations < maxIterations);

  // Escape HTML if requested
  if (opts.escapeHtml) {
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  return sanitized;
}

/**
 * Sanitize object recursively
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  options: Partial<SanitizationOptions> = {}
): T {
  const result: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeInput(key, options);

    if (typeof value === 'string') {
      result[sanitizedKey] = sanitizeInput(value, options);
    } else if (typeof value === 'object' && value !== null) {
      result[sanitizedKey] = sanitizeObject(value, options);
    } else {
      result[sanitizedKey] = value;
    }
  }

  return result;
}

// ============================================================================
// SQL Injection Prevention
// ============================================================================

const SQL_INJECTION_PATTERNS = [
  /(--|\#|\/\*|\*\/)/,  // Comments
  /;\s*(DROP|DELETE|UPDATE|INSERT|EXEC|ALTER|CREATE|TRUNCATE)/i,
  /UNION\s+SELECT/i,
  /'\s*OR\s+'/i,
  /'\s*AND\s+'/i,
  /WAITFOR\s+DELAY/i,
  /BENCHMARK\s*\(/i,
  /SLEEP\s*\(/i,
  /LOAD_FILE\s*\(/i,
  /INTO\s+OUTFILE/i,
  /INTO\s+DUMPFILE/i
];

/**
 * Check for SQL injection patterns
 */
export function detectSqlInjection(input: string): boolean {
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

/**
 * Escape SQL string (for use with parameterized queries)
 */
export function escapeSqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
}

/**
 * Validate SQL identifier (table/column names)
 */
export function isValidSqlIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

// ============================================================================
// Path Traversal Protection
// ============================================================================

const DANGEROUS_PATH_PATTERNS = [
  /\.\./,           // Directory traversal
  /~/,              // Home directory
  /\0/,             // Null byte
  /\|\|/,           // Command injection
  /&&/,             // Command injection
  /\$[({]/,         // Variable expansion
];

/**
 * Check for path traversal attempts
 * Decodes URL-encoded characters to prevent bypasses like %2e%2e%2f
 */
export function detectPathTraversal(path: string): boolean {
  // Decode URL-encoded characters to catch encoded traversal attempts
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch (e) {
    // If decoding fails, treat the path as potentially dangerous
    decoded = path;
  }

  const normalized = decoded.replace(/\\/g, '/');

  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize file path
 */
export function sanitizePath(basePath: string, relativePath: string): string | null {
  // Check for path traversal
  if (detectPathTraversal(relativePath)) {
    return null;
  }

  // Normalize paths
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRelative = relativePath.replace(/\\/g, '/').replace(/^\//, '');

  // Construct full path
  const fullPath = `${normalizedBase}/${normalizedRelative}`;

  // Resolve and verify it's within base
  const parts = fullPath.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }

  const resolvedPath = resolved.join('/');

  // Verify path is within base directory
  if (!resolvedPath.startsWith(normalizedBase)) {
    return null;
  }

  return resolvedPath;
}

/**
 * Generate safe filename
 */
export function safeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .substring(0, 255);
}

// ============================================================================
// Audit Logging
// ============================================================================

export interface AuditLogEntry {
  timestamp: number;
  action: string;
  userId?: string;
  sessionId?: string;
  resource?: string;
  result: 'success' | 'failure' | 'denied';
  details?: Record<string, any>;
  ip?: string;
}

class AuditLogger {
  private entries: AuditLogEntry[] = [];
  private maxEntries: number = 10000;
  private enabled: boolean = true;

  /**
   * Log an audit event
   */
  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    if (!this.enabled) return;

    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: Date.now()
    };

    this.entries.push(fullEntry);

    // Trim if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Log to console for visibility
    const level = entry.result === 'denied' ? 'warn' : 'log';
    console[level](`[AUDIT] ${entry.action}: ${entry.result}`, entry.details || '');
  }

  /**
   * Get recent entries
   */
  getRecent(limit: number = 100): AuditLogEntry[] {
    return this.entries.slice(-limit);
  }

  /**
   * Get entries by action
   */
  getByAction(action: string): AuditLogEntry[] {
    return this.entries.filter(e => e.action === action);
  }

  /**
   * Get failed/denied entries
   */
  getFailed(): AuditLogEntry[] {
    return this.entries.filter(e =>
      e.result === 'failure' || e.result === 'denied'
    );
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Export entries
   */
  export(): AuditLogEntry[] {
    return [...this.entries];
  }
}

export const auditLogger = new AuditLogger();

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitEntry {
  count: number;
  firstRequest: number;
  blocked: boolean;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 100, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if request is allowed
   */
  check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    let entry = this.limits.get(key);

    if (!entry || now - entry.firstRequest > this.windowMs) {
      entry = {
        count: 0,
        firstRequest: now,
        blocked: false
      };
      this.limits.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, this.maxRequests - entry.count);
    const resetIn = Math.max(0, this.windowMs - (now - entry.firstRequest));

    return {
      allowed: entry.count <= this.maxRequests,
      remaining,
      resetIn
    };
  }

  /**
   * Reset limit for key
   */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Clear all limits
   */
  clear(): void {
    this.limits.clear();
  }
}

export const rateLimiter = new RateLimiter();

// ============================================================================
// Content Security
// ============================================================================

/**
 * Generate content hash
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate secure random ID
 */
export function generateSecureId(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

/**
 * Validate content hash
 */
export function validateHash(content: string, expectedHash: string): boolean {
  const actualHash = hashContent(content);
  return crypto.timingSafeEqual(
    Buffer.from(actualHash, 'hex'),
    Buffer.from(expectedHash, 'hex')
  );
}

// ============================================================================
// Security Headers
// ============================================================================

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

/**
 * Apply security headers to response
 */
export function applySecurityHeaders(response: any): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader?.(key, value);
  }
}
