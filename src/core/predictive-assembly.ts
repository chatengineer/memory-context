/**
 * Predictive Context Assembly
 * 
 * Medium Priority Issue #11: Predictive Assembly
 * 
 * Analyzes conversation patterns to predict likely next topics and
 * pre-assemble probable contexts for faster response times.
 * 
 * Features:
 * - Markov chain-based topic prediction
 * - Conversation flow analysis
 * - Pre-assembled context caching
 * - Topic clustering
 */

export interface TopicNode {
  topic: string;
  count: number;
  probability: number;
  transitions: Map<string, number>;
}

export interface ConversationPattern {
  topics: string[];
  transitions: Array<{ from: string; to: string; count: number }>;
  avgTopicLength: number;
}

export interface PredictedContext {
  topic: string;
  probability: number;
  contextIds: string[];
  relevanceScore: number;
}

export interface PredictiveConfig {
  maxPredictions: number;
  minProbability: number;
  cacheSize: number;
  patternWindowSize: number;
  topicSimilarityThreshold: number;
}

const DEFAULT_CONFIG: PredictiveConfig = {
  maxPredictions: 5,
  minProbability: 0.1,
  cacheSize: 100,
  patternWindowSize: 10,
  topicSimilarityThreshold: 0.7
};

/**
 * TopicExtractor - Extracts topics from content
 */
class TopicExtractor {
  private stopWords: Set<string>;
  
  constructor() {
    this.stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'again', 'further', 'then',
      'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just'
    ]);
  }

  /**
   * Extract topics from content
   */
  extract(content: string): string[] {
    const words = content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !this.stopWords.has(w));

    // Use TF to find important terms
    const termFreq = new Map<string, number>();
    for (const word of words) {
      termFreq.set(word, (termFreq.get(word) || 0) + 1);
    }

    // Get top terms as topics
    const sorted = Array.from(termFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term);

    return sorted;
  }

  /**
   * Compute similarity between two topic sets
   */
  similarity(topics1: string[], topics2: string[]): number {
    if (topics1.length === 0 || topics2.length === 0) return 0;
    
    const set1 = new Set(topics1);
    const set2 = new Set(topics2);
    
    let intersection = 0;
    for (const t of set1) {
      if (set2.has(t)) intersection++;
    }
    
    const union = new Set([...set1, ...set2]).size;
    return union > 0 ? intersection / union : 0;
  }
}

/**
 * MarkovChain - Topic transition predictor
 */
class MarkovChain {
  private nodes: Map<string, TopicNode> = new Map();
  private totalTransitions: number = 0;

  /**
   * Add a topic transition
   */
  addTransition(from: string, to: string): void {
    if (!this.nodes.has(from)) {
      this.nodes.set(from, {
        topic: from,
        count: 0,
        probability: 0,
        transitions: new Map()
      });
    }

    const node = this.nodes.get(from)!;
    node.count++;
    node.transitions.set(to, (node.transitions.get(to) || 0) + 1);
    this.totalTransitions++;
  }

  /**
   * Train on a sequence of topics
   */
  train(topicSequence: string[]): void {
    for (let i = 0; i < topicSequence.length - 1; i++) {
      this.addTransition(topicSequence[i], topicSequence[i + 1]);
    }
  }

  /**
   * Predict next topics given current topic
   */
  predict(currentTopic: string, maxPredictions: number = 5): Array<{ topic: string; probability: number }> {
    const node = this.nodes.get(currentTopic);
    if (!node) return [];

    const predictions = Array.from(node.transitions.entries())
      .map(([topic, count]) => ({
        topic,
        probability: count / node.count
      }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, maxPredictions);

    return predictions;
  }

  /**
   * Get all nodes for analysis
   */
  getNodes(): Map<string, TopicNode> {
    return this.nodes;
  }

  /**
   * Export for persistence
   */
  export(): { nodes: Array<[string, { topic: string; count: number; transitions: Array<[string, number]> }]> } {
    return {
      nodes: Array.from(this.nodes.entries()).map(([key, node]) => [
        key,
        {
          topic: node.topic,
          count: node.count,
          transitions: Array.from(node.transitions.entries())
        }
      ])
    };
  }

  /**
   * Import from persistence
   */
  import(data: { nodes: Array<[string, { topic: string; count: number; transitions: Array<[string, number]> }]> }): void {
    this.nodes.clear();
    for (const [key, node] of data.nodes) {
      this.nodes.set(key, {
        topic: node.topic,
        count: node.count,
        probability: 0,
        transitions: new Map(node.transitions)
      });
    }
  }
}

/**
 * ContextCache - Pre-assembled context cache
 */
class ContextCache {
  private cache: Map<string, { context: string; timestamp: number; hits: number }> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get cached context
   */
  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (entry) {
      entry.hits++;
      return entry.context;
    }
    return null;
  }

  /**
   * Set cached context
   */
  set(key: string, context: string): void {
    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      let lruKey: string | null = null;
      let lruHits = Infinity;
      
      for (const [k, v] of this.cache) {
        if (v.hits < lruHits) {
          lruHits = v.hits;
          lruKey = k;
        }
      }
      
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(key, {
      context,
      timestamp: Date.now(),
      hits: 0
    });
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; maxSize: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalHits
    };
  }
}

/**
 * PredictiveAssembler - Main predictive context assembly system
 */
export class PredictiveAssembler {
  private config: PredictiveConfig;
  private markovChain: MarkovChain;
  private topicExtractor: TopicExtractor;
  private contextCache: ContextCache;
  private topicHistory: string[] = [];
  private messageTopics: Map<string, string[]> = new Map();

  constructor(config?: Partial<PredictiveConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.markovChain = new MarkovChain();
    this.topicExtractor = new TopicExtractor();
    this.contextCache = new ContextCache(this.config.cacheSize);
  }

  /**
   * Analyze a message and update patterns
   */
  analyzeMessage(messageId: string, content: string): string[] {
    const topics = this.topicExtractor.extract(content);
    this.messageTopics.set(messageId, topics);

    // Update topic history
    if (topics.length > 0) {
      const primaryTopic = topics[0];
      
      if (this.topicHistory.length > 0) {
        const lastTopic = this.topicHistory[this.topicHistory.length - 1];
        this.markovChain.addTransition(lastTopic, primaryTopic);
      }
      
      this.topicHistory.push(primaryTopic);
      
      // Keep history bounded
      if (this.topicHistory.length > this.config.patternWindowSize) {
        this.topicHistory.shift();
      }
    }

    return topics;
  }

  /**
   * Predict likely next contexts
   */
  predictNextContexts(): PredictedContext[] {
    if (this.topicHistory.length === 0) return [];

    const currentTopic = this.topicHistory[this.topicHistory.length - 1];
    const predictions = this.markovChain.predict(currentTopic, this.config.maxPredictions);

    // Filter by minimum probability
    const filtered = predictions.filter(p => p.probability >= this.config.minProbability);

    // Find relevant message IDs for each predicted topic
    const results: PredictedContext[] = filtered.map(pred => {
      const relevantIds = this.findRelevantMessages(pred.topic);
      return {
        topic: pred.topic,
        probability: pred.probability,
        contextIds: relevantIds,
        relevanceScore: pred.probability
      };
    });

    return results;
  }

  /**
   * Pre-assemble context for a predicted topic
   */
  preAssembleContext(topic: string, contextBuilder: () => string): string {
    // Check cache first
    const cached = this.contextCache.get(topic);
    if (cached) return cached;

    // Build and cache
    const context = contextBuilder();
    this.contextCache.set(topic, context);
    return context;
  }

  /**
   * Get cached context if available
   */
  getCachedContext(topic: string): string | null {
    return this.contextCache.get(topic);
  }

  /**
   * Find messages relevant to a topic
   */
  private findRelevantMessages(topic: string): string[] {
    const relevant: string[] = [];
    
    for (const [messageId, topics] of this.messageTopics) {
      if (topics.includes(topic)) {
        relevant.push(messageId);
      }
    }

    return relevant.slice(-10); // Return last 10 relevant messages
  }

  /**
   * Get conversation patterns
   */
  getPatterns(): ConversationPattern {
    const transitions: ConversationPattern['transitions'] = [];
    const nodes = this.markovChain.getNodes();

    for (const [from, node] of nodes) {
      for (const [to, count] of node.transitions) {
        transitions.push({ from, to, count });
      }
    }

    return {
      topics: this.topicHistory,
      transitions,
      avgTopicLength: this.topicHistory.length > 0 
        ? this.topicHistory.join(' ').length / this.topicHistory.length 
        : 0
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    topicCount: number;
    transitionCount: number;
    cacheStats: { size: number; maxSize: number; totalHits: number };
    historyLength: number;
  } {
    const nodes = this.markovChain.getNodes();
    let transitionCount = 0;
    for (const node of nodes.values()) {
      transitionCount += node.transitions.size;
    }

    return {
      topicCount: nodes.size,
      transitionCount,
      cacheStats: this.contextCache.getStats(),
      historyLength: this.topicHistory.length
    };
  }

  /**
   * Export state for persistence
   */
  export(): {
    markovChain: ReturnType<MarkovChain['export']>;
    topicHistory: string[];
    messageTopics: Array<[string, string[]]>;
  } {
    return {
      markovChain: this.markovChain.export(),
      topicHistory: this.topicHistory,
      messageTopics: Array.from(this.messageTopics.entries())
    };
  }

  /**
   * Import state from persistence
   */
  import(data: ReturnType<PredictiveAssembler['export']>): void {
    this.markovChain.import(data.markovChain);
    this.topicHistory = data.topicHistory;
    this.messageTopics = new Map(data.messageTopics);
  }

  /**
   * Reset all patterns
   */
  reset(): void {
    this.markovChain = new MarkovChain();
    this.topicHistory = [];
    this.messageTopics.clear();
    this.contextCache.clear();
  }
}

// Export singleton instance
export const predictiveAssembler = new PredictiveAssembler();
