/**
 * Unit Tests for BM25 Index
 */

import { BM25Index } from '../src/search/bm25-index';

describe('BM25Index', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index({ k1: 1.2, b: 0.75 });
  });

  describe('addDocument()', () => {
    it('should add a document', () => {
      index.addDocument({ id: '1', content: 'Hello world' });
      const stats = index.getStats();
      expect(stats.documentCount).toBe(1);
    });

    it('should handle multiple documents', () => {
      index.addDocument({ id: '1', content: 'Hello world' });
      index.addDocument({ id: '2', content: 'Goodbye world' });
      
      const stats = index.getStats();
      expect(stats.documentCount).toBe(2);
    });

    it('should update existing document', () => {
      index.addDocument({ id: '1', content: 'Hello' });
      index.addDocument({ id: '1', content: 'Goodbye' });
      
      const stats = index.getStats();
      expect(stats.documentCount).toBe(1);
    });
  });

  describe('removeDocument()', () => {
    it('should remove a document', () => {
      index.addDocument({ id: '1', content: 'Hello world' });
      const removed = index.removeDocument('1');
      
      expect(removed).toBe(true);
      expect(index.getStats().documentCount).toBe(0);
    });

    it('should return false for non-existent document', () => {
      const removed = index.removeDocument('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('search()', () => {
    beforeEach(() => {
      index.addDocument({ id: '1', content: 'The quick brown fox' });
      index.addDocument({ id: '2', content: 'The lazy dog' });
      index.addDocument({ id: '3', content: 'A quick decision was made' });
    });

    it('should return matching documents', () => {
      const results = index.search('quick');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should rank results by relevance', () => {
      const results = index.search('quick');
      expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
    });

    it('should respect limit parameter', () => {
      const results = index.search('the', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty array for no matches', () => {
      const results = index.search('zebra');
      expect(results).toEqual([]);
    });

    it('should return matched terms', () => {
      const results = index.search('quick fox');
      expect(results[0].terms.length).toBeGreaterThan(0);
    });
  });

  describe('getStats()', () => {
    it('should return statistics', () => {
      index.addDocument({ id: '1', content: 'Hello world' });
      const stats = index.getStats();
      
      expect(stats).toHaveProperty('documentCount');
      expect(stats).toHaveProperty('termCount');
      expect(stats).toHaveProperty('avgDocLength');
      expect(stats).toHaveProperty('vocabularySize');
    });
  });

  describe('export/import', () => {
    it('should export and import index', () => {
      index.addDocument({ id: '1', content: 'Test document' });
      
      const exported = index.export();
      index.clear();
      index.import(exported);
      
      const stats = index.getStats();
      expect(stats.documentCount).toBe(1);
    });
  });

  describe('clear()', () => {
    it('should clear all documents', () => {
      index.addDocument({ id: '1', content: 'Hello' });
      index.addDocument({ id: '2', content: 'World' });
      index.clear();
      
      expect(index.getStats().documentCount).toBe(0);
    });
  });
});
