// tests/unit/query-normalizer.test.ts
// Unit tests for QueryNormalizer

import { QueryNormalizer, QueryExpansionSource } from '../../src/search/query-normalizer';

describe('QueryNormalizer', () => {
  let normalizer: QueryNormalizer;

  beforeEach(() => {
    normalizer = new QueryNormalizer();
  });

  test('basic normalization', () => {
    const result = normalizer.normalize('Hello World');
    expect(result.normalized).toBe('hello world');
    expect(result.original).toBe('Hello World');
  });

  test('NFKC folding and punctuation cleanup', () => {
    const result = normalizer.normalize("Hello\u2019s World\u201D");
    expect(result.normalized).toContain("hello's");
    expect(result.normalized).toContain('world');
  });

  test('camelCase splitting', () => {
    const result = normalizer.normalize('camelCaseTest');
    expect(result.normalized).toBe('camel case test');
  });

  test('month alias expansion', () => {
    const result = normalizer.normalize('jan');
    expect(result.expansions).toContain('january');
    expect(result.expansions).toContain('01');
    expect(result.expansions).toContain('1');
  });

  test('participant alias expansion', () => {
    const result = normalizer.normalize('i');
    expect(result.expansions).toContain('me');
    expect(result.expansions).toContain('user');
    expect(result.expansions).toContain('human');
  });

  test('ISO date expansion', () => {
    const result = normalizer.normalize('2026-04-01');
    expect(result.expansions.some(e => e.includes('4/1/2026') || e.includes('2026/04/01'))).toBe(true);
  });

  test('year-month date expansion', () => {
    const result = normalizer.normalize('2026-04');
    expect(result.expansions).toContain('april');
    expect(result.expansions).toContain('2026-04');
  });

  test('expansion cap at 24', () => {
    const sources: QueryExpansionSource[] = Array.from({ length: 100 }, (_, i) => ({
      id: `src-${i}`,
      content: `Entity ${i} test content`,
      metadata: {}
    }));
    const result = normalizer.normalize('Entity', sources);
    expect(result.expansions.length).toBeLessThanOrEqual(24);
  });

  test('empty query', () => {
    const result = normalizer.normalize('');
    expect(result.normalized).toBe('');
    expect(result.expanded).toBe('');
  });

  test('expansions do not duplicate normalized terms', () => {
    const result = normalizer.normalize('january');
    expect(result.expansions).not.toContain('january');
  });
});