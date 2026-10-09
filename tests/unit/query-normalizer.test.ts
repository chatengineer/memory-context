/**
 * Unit tests for the query normalizer used by long-horizon retrieval.
 */

import { QueryNormalizer } from '../../src/search/query-normalizer';

describe('QueryNormalizer', () => {
  const normalizer = new QueryNormalizer();

  it('normalizes casing, camelCase, punctuation, and possessives', () => {
    const result = normalizer.normalize('  ChatEngineer’s REDIS-cache “bug”!!  ');

    expect(result.original).toBe('  ChatEngineer’s REDIS-cache “bug”!!  ');
    expect(result.normalized).toBe('chat engineers redis-cache bug');
  });

  it('expands month abbreviations to names and numbers', () => {
    const result = normalizer.normalize('What happened in Mar?');

    expect(result.expansions).toEqual(expect.arrayContaining(['march', '03', '3']));
    expect(result.expanded).toContain('march');
  });

  it('expands participant aliases', () => {
    const result = normalizer.normalize('I prefer concise answers');

    expect(result.expansions).toEqual(expect.arrayContaining(['me', 'my', 'user', 'human']));
  });

  it('expands ISO dates to common formats', () => {
    const result = normalizer.normalize('Deploy on 2026-04-01');

    expect(result.expansions).toEqual(expect.arrayContaining(['4/1/2026', '2026/04/01']));
  });

  it('expands year-month dates to month names', () => {
    const result = normalizer.normalize('Project update 2026-03');

    expect(result.expansions).toEqual(expect.arrayContaining(['march', 'march 2026', '3/2026']));
  });

  it('expands capitalized entities using retrieved sources', () => {
    const result = normalizer.normalize('Who renamed Fennec?', [
      {
        id: 'turn-1',
        content: 'Bruno asked to rename Project Fennec to Fennec Leap in March 2026.',
        metadata: { speaker: 'Bruno' }
      }
    ]);

    expect(result.expansions).toEqual(expect.arrayContaining(['project fennec', 'fennec leap']));
  });

  it('caps the number of generated expansions', () => {
    const result = normalizer.normalize(
      'i me my you mar april september december jan feb oct nov assistant agent'
    );

    expect(result.expansions.length).toBeLessThanOrEqual(24);
  });

  it('returns an empty expansion list for a blank query', () => {
    const result = normalizer.normalize('   ');

    expect(result.normalized).toBe('');
    expect(result.expansions).toEqual([]);
  });
});
