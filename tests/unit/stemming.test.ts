import { BM25Index } from '../../src/search/bm25-index';

describe('BM25Index Stemming', () => {
  let index: any;

  beforeEach(() => {
    index = new BM25Index();
  });

  it('should correctly stem words ending in -ation (Issue #61)', () => {
    // @ts-ignore - accessing private method for test
    const root = index.stem('education');
    expect(root).toBe('educ');
  });

  it('should correctly stem words ending in -ing', () => {
    // @ts-ignore
    expect(index.stem('running')).toBe('runn');
  });
});
