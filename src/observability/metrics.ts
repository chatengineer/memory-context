/**
 * Observability and Metrics System
 * 
 * High Priority Issue #8: Observability Implementation
 * 
 * Provides comprehensive monitoring, metrics collection, and health checks
 * for the memory-context plugin.
 * 
 * Features:
 * - Prometheus-compatible metrics
 * - Performance histograms
 * - Health checks with detailed status
 * - Structured logging with levels
 * - Error tracking and aggregation
 * - Resource usage monitoring
 */

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MetricValue {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface HistogramBucket {
  le: number;  // Less than or equal to
  count: number;
}

export interface Histogram {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  details?: Record<string, any>;
  lastCheck: number;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, any>;
  error?: Error;
}

export interface MetricsSnapshot {
  timestamp: number;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<string, Histogram>;
  healthChecks: Map<string, HealthCheck>;
}

/**
 * MetricsRegistry - Central metrics collection and reporting
 */
export class MetricsRegistry {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private healthChecks: Map<string, HealthCheck> = new Map();
  private healthCheckFunctions: Map<string, () => Promise<HealthCheck>> = new Map();
  private startTime: number = Date.now();
  private labels: Record<string, string> = {};

  /**
   * Set default labels for all metrics
   */
  setLabels(labels: Record<string, string>): void {
    this.labels = { ...this.labels, ...labels };
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Observe a value in a histogram
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getMetricKey(name, labels);
    
    if (!this.histograms.has(key)) {
      // Initialize with default buckets
      this.histograms.set(key, {
        buckets: [
          { le: 0.001, count: 0 },
          { le: 0.01, count: 0 },
          { le: 0.1, count: 0 },
          { le: 0.5, count: 0 },
          { le: 1, count: 0 },
          { le: 2, count: 0 },
          { le: 5, count: 0 },
          { le: 10, count: 0 },
          { le: 30, count: 0 },
          { le: 60, count: 0 },
          { le: Infinity, count: 0 }
        ],
        sum: 0,
        count: 0
      });
    }

    const histogram = this.histograms.get(key)!;
    histogram.sum += value;
    histogram.count++;

    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Time an operation and record in histogram
   */
  async timeOperation<T>(
    name: string,
    operation: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await operation();
      this.observeHistogram(`${name}_duration_seconds`, (performance.now() - start) / 1000, labels);
      this.incrementCounter(`${name}_total`, 1, { ...labels, status: 'success' });
      return result;
    } catch (error) {
      this.observeHistogram(`${name}_duration_seconds`, (performance.now() - start) / 1000, labels);
      this.incrementCounter(`${name}_total`, 1, { ...labels, status: 'error' });
      throw error;
    }
  }

  /**
   * Register a health check
   */
  registerHealthCheck(name: string, check: () => Promise<HealthCheck>): void {
    this.healthChecks.set(name, {
      name,
      status: 'healthy',
      message: 'Not yet checked',
      lastCheck: 0
    });
    this.healthCheckFunctions.set(name, check);
  }

  /**
   * Run a health check
   */
  async runHealthCheck(name: string): Promise<HealthCheck> {
    const check = this.healthChecks.get(name);
    const checkFn = this.healthCheckFunctions.get(name);

    if (!check || !checkFn) {
      return {
        name,
        status: 'unhealthy',
        message: 'Health check not found',
        lastCheck: Date.now()
      };
    }

    try {
      const result = await checkFn();
      this.healthChecks.set(name, result);
      return result;
    } catch (error) {
      const failedCheck: HealthCheck = {
        name,
        status: 'unhealthy',
        message: `Health check failed: ${error}`,
        lastCheck: Date.now()
      };
      this.healthChecks.set(name, failedCheck);
      return failedCheck;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const memUsage = process.memoryUsage();
    
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      counters: new Map(this.counters),
      gauges: new Map(this.gauges),
      histograms: new Map(this.histograms),
      healthChecks: new Map(this.healthChecks)
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const snapshot = this.getSnapshot();

    // Uptime
    lines.push('# HELP memory_context_uptime_seconds Plugin uptime in seconds');
    lines.push('# TYPE memory_context_uptime gauge');
    lines.push(`memory_context_uptime_seconds ${snapshot.uptime / 1000}`);

    // Memory
    lines.push('# HELP memory_context_memory_bytes Memory usage in bytes');
    lines.push('# TYPE memory_context_memory_bytes gauge');
    lines.push(`memory_context_memory_bytes{type="heap_used"} ${snapshot.memory.heapUsed}`);
    lines.push(`memory_context_memory_bytes{type="heap_total"} ${snapshot.memory.heapTotal}`);
    lines.push(`memory_context_memory_bytes{type="rss"} ${snapshot.memory.rss}`);

    // Counters
    lines.push('# HELP memory_context_counter_total Counter values');
    lines.push('# TYPE memory_context_counter_total counter');
    for (const [key, value] of snapshot.counters) {
      lines.push(`memory_context_counter_total{name="${key}"} ${value}`);
    }

    // Gauges
    lines.push('# HELP memory_context_gauge_value Gauge values');
    lines.push('# TYPE memory_context_gauge_value gauge');
    for (const [key, value] of snapshot.gauges) {
      lines.push(`memory_context_gauge_value{name="${key}"} ${value}`);
    }

    // Histograms
    for (const [key, histogram] of snapshot.histograms) {
      lines.push(`# HELP memory_context_${key}_seconds Time histogram`);
      lines.push(`# TYPE memory_context_${key}_seconds histogram`);
      
      for (const bucket of histogram.buckets) {
        const leLabel = bucket.le === Infinity ? '+Inf' : bucket.le;
        lines.push(`memory_context_${key}_seconds_bucket{le="${leLabel}"} ${bucket.count}`);
      }
      
      lines.push(`memory_context_${key}_seconds_sum ${histogram.sum}`);
      lines.push(`memory_context_${key}_seconds_count ${histogram.count}`);
    }

    return lines.join('\n');
  }

  /**
   * Clear all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    const labelStr = Object.entries({ ...this.labels, ...labels })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

/**
 * StructuredLogger - JSON-formatted logging with levels
 */
export class StructuredLogger {
  private level: LogLevel = 'info';
  private context: Record<string, any> = {};

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setContext(context: Record<string, any>): void {
    this.context = { ...this.context, ...context };
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log('error', message, { ...context, error: error?.message, stack: error?.stack });
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>): void {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) < levels.indexOf(this.level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context: { ...this.context, ...context }
    };

    // Output as JSON for structured logging systems
    console.log(JSON.stringify(entry));
  }
}

/**
 * MemoryContextMetrics - Plugin-specific metrics
 */
export class MemoryContextMetrics {
  private registry: MetricsRegistry;
  private logger: StructuredLogger;

  constructor(registry?: MetricsRegistry, logger?: StructuredLogger) {
    this.registry = registry || new MetricsRegistry();
    this.logger = logger || new StructuredLogger();
  }

  /**
   * Record context build operation
   */
  recordContextBuild(durationMs: number, tokenCount: number, success: boolean): void {
    this.registry.incrementCounter('memory_context_builds_total', 1, { 
      status: success ? 'success' : 'error' 
    });
    this.registry.observeHistogram('memory_context_build_duration_ms', durationMs);
    this.registry.setGauge('memory_context_last_build_tokens', tokenCount);
  }

  /**
   * Record tier storage operation
   */
  recordTierOperation(tier: 'L0' | 'L1' | 'L2', operation: 'read' | 'write' | 'evict', durationMs: number): void {
    this.registry.incrementCounter(`memory_context_tier_${operation}_total`, 1, { tier });
    this.registry.observeHistogram(`memory_context_tier_${operation}_duration_ms`, durationMs);
  }

  /**
   * Record token counting operation
   */
  recordTokenCount(durationMs: number, tokenCount: number): void {
    this.registry.observeHistogram('memory_context_token_count_duration_ms', durationMs);
    this.registry.incrementCounter('memory_context_tokens_counted_total', tokenCount);
  }

  /**
   * Record search operation
   */
  recordSearch(queryLength: number, resultCount: number, durationMs: number): void {
    this.registry.incrementCounter('memory_context_searches_total');
    this.registry.observeHistogram('memory_context_search_duration_ms', durationMs);
    this.registry.setGauge('memory_context_last_search_results', resultCount);
  }

  /**
   * Update storage tier stats
   */
  updateTierStats(stats: { L0: any; L1: any; L2: any }): void {
    this.registry.setGauge('memory_context_tier_tokens', stats.L0.currentTokens, { tier: 'L0' });
    this.registry.setGauge('memory_context_tier_tokens', stats.L1.currentTokens, { tier: 'L1' });
    this.registry.setGauge('memory_context_tier_tokens', stats.L2.currentTokens, { tier: 'L2' });
    this.registry.setGauge('memory_context_tier_items', stats.L0.itemCount, { tier: 'L0' });
    this.registry.setGauge('memory_context_tier_items', stats.L1.itemCount, { tier: 'L1' });
    this.registry.setGauge('memory_context_tier_items', stats.L2.itemCount, { tier: 'L2' });
  }

  /**
   * Get metrics registry
   */
  getRegistry(): MetricsRegistry {
    return this.registry;
  }

  /**
   * Get logger
   */
  getLogger(): StructuredLogger {
    return this.logger;
  }
}

// Export singleton instances
export const metricsRegistry = new MetricsRegistry();
export const defaultLogger = new StructuredLogger();
// Set log level from environment variable
const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
if (envLogLevel && ['debug', 'info', 'warn', 'error'].includes(envLogLevel)) {
  defaultLogger.setLevel(envLogLevel as LogLevel);
}
export const memoryContextMetrics = new MemoryContextMetrics(metricsRegistry, defaultLogger);
