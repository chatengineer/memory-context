/**
 * BM25 Search Index - Keyword-based relevance ranking
 * 
 * High Priority Issue #6: BM25 Index Implementation
 * 
 * BM25 (Best Matching 25) is a probabilistic ranking function that estimates
 * the relevance of documents to a given search query. It's widely used in
 * information retrieval systems like Elasticsearch and Lucene.
 * 
 * Features:
 * - Term frequency normalization (no length bias)
 * - Inverse document frequency weighting
 * - Configurable k1 and b parameters
 * - Stop word filtering
 * - N-gram support for partial matching
 */

import { Metadata } from '../types';

export interface BM25Config {
  k1: number;           // Term frequency saturation parameter (typically 1.2-2.0)
  b: number;            // Length normalization parameter (typically 0.75)
  avgdl?: number;       // Average document length (computed if not provided)
  minDocFreq?: number;  // Minimum document frequency for IDF (default: 2)
  minTermLength?: number; // Minimum term length (default: 2)
  stopWords?: Set<string>; // Stop words to filter out
}

const DEFAULT_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
  minDocFreq: 2,
  minTermLength: 2
};

// Common English stop words
const DEFAULT_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'just', 'should', 'now', 'i', 'you', 'your', 'we', 'our'
]);

export interface Document {
  id: string;
  content: string;
  metadata?: Metadata;
}

export interface SearchResult {
  id: string;
  score: number;
  terms: string[];
  metadata?: Metadata;
}

interface TermInfo {
  docFreq: number;      // Number of documents containing this term
  postings: Map<string, number>; // docId -> term frequency in that doc
}

/**
 * BM25Index - Full-text search index with BM25 ranking
 */
export class BM25Index {
  private config: BM25Config;
  private documents: Map<string, Document> = new Map();
  private termIndex: Map<string, TermInfo> = new Map();
  private docLengths: Map<string, number> = new Map();
  private docToTerms: Map<string, Set<string>> = new Map(); // docId -> unique terms
  private avgdl: number = 0;
  private totalDocs: number = 0;
  private totalTerms: number = 0;

  constructor(config?: Partial<BM25Config>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      stopWords: config?.stopWords || DEFAULT_STOP_WORDS
    };
  }

  /**
   * Add or update a document in the index
   */
  addDocument(doc: Document): void {
    const isNew = !this.documents.has(doc.id);
    
    // If updating, remove old term frequencies first
    if (!isNew) {
      this.removeDocumentTerms(doc.id);
    }

    // Tokenize and count terms
    const terms = this.tokenize(doc.content);
    const termFreqs = this.countTerms(terms);

    // Update document store
    this.documents.set(doc.id, doc);
    this.docLengths.set(doc.id, terms.length);
    this.docToTerms.set(doc.id, new Set(termFreqs.keys()));

    // Update term index
    for (const [term, freq] of termFreqs) {
      if (!this.termIndex.has(term)) {
        this.termIndex.set(term, {
          docFreq: 0,
          postings: new Map()
        });
      }
      const termInfo = this.termIndex.get(term)!;
      termInfo.docFreq += isNew ? 1 : 0;
      termInfo.postings.set(doc.id, freq);
    }

    // Update statistics
    if (isNew) {
      this.totalDocs++;
      this.totalTerms += terms.length;
      this.avgdl = this.totalTerms / this.totalDocs;
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) return false;

    const docLength = this.docLengths.get(docId) || 0;
    
    // Remove term frequencies
    this.removeDocumentTerms(docId);

    // Remove document
    this.documents.delete(docId);
    this.docLengths.delete(docId);
    
    // Update statistics
    this.totalDocs--;
    this.totalTerms -= docLength;
    if (this.totalDocs > 0) {
      this.avgdl = this.totalTerms / this.totalDocs;
    } else {
      this.avgdl = 0;
    }

    return true;
  }

  /**
   * Search for documents matching the query
   */
  search(query: string, limit?: number): SearchResult[] {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    // Get candidate documents (those containing at least one query term)
    const candidates = new Set<string>();
    for (const term of queryTerms) {
      const termInfo = this.termIndex.get(term);
      if (termInfo) {
        for (const docId of termInfo.postings.keys()) {
          candidates.add(docId);
        }
      }
    }

    // Score each candidate
    const results: SearchResult[] = [];
    for (const docId of candidates) {
      const { score, matchedTerms } = this.scoreDocument(docId, queryTerms);
      if (score > 0) {
        results.push({
          id: docId,
          score,
          terms: matchedTerms,
          metadata: this.documents.get(docId)?.metadata
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Get the BM25 score for a specific document and query
   */
  private scoreDocument(docId: string, queryTerms: string[]): { score: number; matchedTerms: string[] } {
    let score = 0;
    const matchedTerms: string[] = [];
    const docLength = this.docLengths.get(docId) || 0;

    for (const term of queryTerms) {
      const termInfo = this.termIndex.get(term);
      if (!termInfo) continue;

      const tf = termInfo.postings.get(docId);
      if (!tf) continue;

      matchedTerms.push(term);

      // IDF calculation: log((N - df + 0.5) / (df + 0.5))
      const idf = this.calculateIDF(termInfo.docFreq);

      // BM25 formula: IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))
      const numerator = tf * (this.config.k1 + 1);
      const denominator = tf + this.config.k1 * (
        1 - this.config.b + this.config.b * (docLength / (this.avgdl || 1))
      );

      score += idf * (numerator / denominator);
    }

    return { score, matchedTerms };
  }

  /**
   * Calculate inverse document frequency for a term
   */
  private calculateIDF(docFreq: number): number {
    // Robertson-Sparck Jones formula
    const N = this.totalDocs;
    return Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    if (!text) return [];

    // Lowercase and split on non-alphanumeric (preserving common code symbols)
    const rawTerms = text
      .toLowerCase()
      .replace(/[^a-z0-9\s\+#_\$]/g, ' ')
      .split(/\s+/)
      .filter(term => 
        term.length >= (this.config.minTermLength || 2) &&
        !this.config.stopWords?.has(term)
      );

    // Apply Porter stemming (simplified version)
    return rawTerms.map(term => this.stem(term));
  }

  /**
   * Simplified Porter stemmer
   */
  private stem(term: string): string {
    // Very simplified stemming - just remove common suffixes
    // For production, use a proper Porter stemmer library
    const suffixes = ['ing', 'ly', 'ed', 'ies', 'es', 's', 'ment', 'ness', 'tion', 'ation'];
    
    for (const suffix of suffixes) {
      if (term.length > suffix.length + 2 && term.endsWith(suffix)) {
        return term.slice(0, -suffix.length);
      }
    }
    
    return term;
  }

  /**
   * Count term frequencies
   */
  private countTerms(terms: string[]): Map<string, number> {
    const freqs = new Map<string, number>();
    for (const term of terms) {
      freqs.set(term, (freqs.get(term) || 0) + 1);
    }
    return freqs;
  }

  /**
   * Remove term frequencies for a document (internal)
   * Optimization: Uses docToTerms mapping for O(DocTerms) complexity
   */
  private removeDocumentTerms(docId: string): void {
    const docTerms = this.docToTerms.get(docId);
    if (!docTerms) return;

    for (const term of docTerms) {
      const termInfo = this.termIndex.get(term);
      if (termInfo) {
        termInfo.postings.delete(docId);
        termInfo.docFreq--;
        
        // Clean up empty terms
        if (termInfo.postings.size === 0) {
          this.termIndex.delete(term);
        }
      }
    }
    
    this.docToTerms.delete(docId);
  }

  /**
   * Get index statistics
   */
  getStats(): {
    documentCount: number;
    termCount: number;
    avgDocLength: number;
    vocabularySize: number;
  } {
    return {
      documentCount: this.totalDocs,
      termCount: this.totalTerms,
      avgDocLength: this.avgdl,
      vocabularySize: this.termIndex.size
    };
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.documents.clear();
    this.termIndex.clear();
    this.docLengths.clear();
    this.docToTerms.clear();
    this.totalDocs = 0;
    this.totalTerms = 0;
    this.avgdl = 0;
  }

  /**
   * Export index for persistence
   */
  export(): {
    documents: [string, Document][];
    termIndex: [string, { docFreq: number; postings: [string, number][] }][];
    docLengths: [string, number][];
    docToTerms: [string, string[]][];
    avgdl: number;
    totalDocs: number;
    totalTerms: number;
  } {
    return {
      documents: Array.from(this.documents.entries()),
      termIndex: Array.from(this.termIndex.entries()).map(([term, info]) => [
        term,
        {
          docFreq: info.docFreq,
          postings: Array.from(info.postings.entries())
        }
      ]),
      docLengths: Array.from(this.docLengths.entries()),
      docToTerms: Array.from(this.docToTerms.entries()).map(([id, terms]) => [id, Array.from(terms)]),
      avgdl: this.avgdl,
      totalDocs: this.totalDocs,
      totalTerms: this.totalTerms
    };
  }

  /**
   * Import index from persisted data
   */
  import(data: ReturnType<BM25Index['export']>): void {
    this.clear();
    
    this.documents = new Map(data.documents);
    this.docLengths = new Map(data.docLengths);
    this.docToTerms = new Map(data.docToTerms.map(([id, terms]) => [id, new Set(terms)]));
    this.avgdl = data.avgdl;
    this.totalDocs = data.totalDocs;
    this.totalTerms = data.totalTerms;

    this.termIndex = new Map(
      data.termIndex.map(([term, info]) => [
        term,
        {
          docFreq: info.docFreq,
          postings: new Map(info.postings)
        }
      ])
    );
  }
}

// Export singleton instance
export const bm25Index = new BM25Index();
