/**
 * Unit Tests for BM25 Code Tokenization (Issue #43)
 */

import { BM25Index } from '../../src/search/bm25-index';

describe('BM25 Code Tokenization', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it('should preserve code symbols like C++ and C#', () => {
    index.addDocument({ id: 'doc1', content: 'Learning C++ and C# today' });
    
    const results1 = index.search('C++');
    expect(results1.length).toBe(1);
    expect(results1[0].id).toBe('doc1');

    const results2 = index.search('C#');
    expect(results2.length).toBe(1);
    expect(results2[0].id).toBe('doc1');
  });

  it('should preserve underscores in identifiers', () => {
    index.addDocument({ id: 'doc1', content: 'Using _internal_variable' });
    
    const results = index.search('_internal_variable');
    expect(results.length).toBe(1);
    expect(results[0].terms).toContain('_internal_variable');
  });

  it('should preserve dollar signs', () => {
    index.addDocument({ id: 'doc1', content: 'Variable $state is active' });
    
    const results = index.search('$state');
    expect(results.length).toBe(1);
    expect(results[0].terms).toContain('$state');
  });
});
