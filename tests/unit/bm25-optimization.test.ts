/**
 * Unit Tests for BM25 Optimization (Issue #42)
 */

import { BM25Index } from '../../src/search/bm25-index';

describe('BM25 Optimization', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  it('should efficiently remove documents using reverse mapping', () => {
    // 1. Add some documents
    index.addDocument({ id: 'doc1', content: 'hello world' });
    index.addDocument({ id: 'doc2', content: 'hello universe' });
    
    expect(index.getStats().documentCount).toBe(2);
    expect(index.getStats().vocabularySize).toBe(3); // hello, world, universe

    // 2. Remove a document
    index.removeDocument('doc1');
    
    expect(index.getStats().documentCount).toBe(1);
    expect(index.getStats().vocabularySize).toBe(2); // hello, universe
    
    const results = index.search('world');
    expect(results.length).toBe(0);
  });

  it('should maintain sub-millisecond removal with large vocabulary', () => {
    // 1. Fill index with many unique terms
    const vocabularySize = 5000;
    for (let i = 0; i < vocabularySize; i++) {
      index.addDocument({ id: `doc_${i}`, content: `word${i}x common_term` });
    }
    
    expect(index.getStats().vocabularySize).toBeGreaterThan(vocabularySize);

    // 2. Benchmark removal
    const start = performance.now();
    index.removeDocument('doc_0');
    const duration = performance.now() - start;
    
    console.log(`Document removal duration: ${duration.toFixed(4)}ms`);
    expect(duration).toBeLessThan(1.0); // Should be well under 1ms
  });
});
