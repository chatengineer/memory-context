/**
 * Compression System
 * 
 * Medium Priority Issue #13: Compression
 * 
 * Provides transparent compression for storage tiers:
 * - Gzip for L2 messages (fast, widely compatible)
 * - Brotli for archive tier (better compression ratio)
 * - Configurable compression levels
 * - Transparent read/write operations
 */

import * as zlib from 'zlib';
import { promisify } from 'util';

// Promisify zlib methods
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

export type CompressionAlgorithm = 'gzip' | 'brotli' | 'none';

export interface CompressionConfig {
  algorithm: CompressionAlgorithm;
  level: number;  // 1-9 for gzip, 0-11 for brotli
  threshold: number;  // Minimum bytes to compress
  chunkSize: number;  // Chunk size for streaming
}

export interface CompressionResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  algorithm: CompressionAlgorithm;
  ratio: number;
}

const DEFAULT_GZIP_CONFIG: CompressionConfig = {
  algorithm: 'gzip',
  level: 6,  // Default balanced compression
  threshold: 1024,  // Don't compress < 1KB
  chunkSize: 16 * 1024  // 16KB chunks
};

const DEFAULT_BROTLI_CONFIG: CompressionConfig = {
  algorithm: 'brotli',
  level: 4,  // Good balance for text
  threshold: 1024,
  chunkSize: 16 * 1024
};

export interface CompressionStats {
  compressed: number;
  decompressed: number;
  bytesSaved: number;
  operationsFailed: number;
}

/**
 * Compressor - Handles compression/decompression operations
 */
export class Compressor {
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    const defaults = config?.algorithm === 'brotli' 
      ? DEFAULT_BROTLI_CONFIG 
      : DEFAULT_GZIP_CONFIG;
    this.config = { ...defaults, ...config };
  }

  /**
   * Compress data
   */
  async compress(data: string | Buffer): Promise<CompressionResult> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const originalSize = buffer.length;

    // Skip if below threshold
    if (originalSize < this.config.threshold) {
      return {
        data: buffer,
        originalSize,
        compressedSize: originalSize,
        algorithm: 'none',
        ratio: 1.0
      };
    }

    let compressed: Buffer;
    let algorithm: CompressionAlgorithm = this.config.algorithm;

    try {
      if (algorithm === 'gzip') {
        compressed = await gzip(buffer, {
          level: this.config.level
        });
      } else if (algorithm === 'brotli') {
        compressed = await brotliCompress(buffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: this.config.level
          }
        });
      } else {
        return {
          data: buffer,
          originalSize,
          compressedSize: originalSize,
          algorithm: 'none',
          ratio: 1.0
        };
      }

      // If compression didn't help, return original
      if (compressed.length >= originalSize) {
        return {
          data: buffer,
          originalSize,
          compressedSize: originalSize,
          algorithm: 'none',
          ratio: 1.0
        };
      }

      return {
        data: compressed,
        originalSize,
        compressedSize: compressed.length,
        algorithm,
        ratio: compressed.length / originalSize
      };
    } catch (error) {
      console.error('[Compressor] Compression error:', error);
      return {
        data: buffer,
        originalSize,
        compressedSize: originalSize,
        algorithm: 'none',
        ratio: 1.0
      };
    }
  }

  /**
   * Decompress data
   */
  async decompress(
    data: Buffer,
    algorithm?: CompressionAlgorithm
  ): Promise<string> {
    // Detect algorithm from header if not specified
    const detectedAlgorithm = algorithm || this.detectAlgorithm(data);

    if (detectedAlgorithm === 'none') {
      return data.toString('utf-8');
    }

    try {
      let decompressed: Buffer;

      if (detectedAlgorithm === 'gzip') {
        decompressed = await gunzip(data);
      } else if (detectedAlgorithm === 'brotli') {
        decompressed = await brotliDecompress(data);
      } else {
        return data.toString('utf-8');
      }

      return decompressed.toString('utf-8');
    } catch (error) {
      console.error('[Compressor] Decompression error:', error);
      // If we failed to decompress what we thought was a compressed stream,
      // it might be raw data or corrupted.
      return data.toString('utf-8');
    }
  }

  /**
   * Detect compression algorithm from buffer header
   */
  detectAlgorithm(data: Buffer): CompressionAlgorithm {
    if (data.length < 2) return 'none';

    // Gzip magic number: 1f 8b
    if (data[0] === 0x1f && data[1] === 0x8b) {
      return 'gzip';
    }

    // Brotli doesn't have a reliable magic number at the bitstream level
    // that is easy to detect in a Buffer without full parsing.
    // However, for our internal L2 storage, we will assume that if it's 
    // passed to CompressionManager.decompress and it's not Gzip, 
    // it's likely Brotli if the tier or explicit flag indicates so.
    
    // We'll return 'none' here to avoid false positives.
    // The CompressionManager should be responsible for providing the algorithm
    // from metadata when possible.
    return 'none';
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }
}

/**
 * CompressionManager - Manages compression for different tiers
 */
export class CompressionManager {
  private gzipCompressor: Compressor;
  private brotliCompressor: Compressor;
  private stats = {
    compressed: 0,
    decompressed: 0,
    bytesSaved: 0,
    operationsFailed: 0
  };

  constructor() {
    this.gzipCompressor = new Compressor({ algorithm: 'gzip', level: 6 });
    this.brotliCompressor = new Compressor({ algorithm: 'brotli', level: 4 });
  }

  /**
   * Compress for a specific tier
   * L0: No compression (hot cache)
   * L1: Light gzip (fast decompression)
   * L2: Brotli (best compression)
   */
  async compressForTier(
    data: string | Buffer,
    tier: 'L0' | 'L1' | 'L2'
  ): Promise<CompressionResult> {
    try {
      switch (tier) {
        case 'L0':
          // No compression for hot tier
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          return {
            data: buffer,
            originalSize: buffer.length,
            compressedSize: buffer.length,
            algorithm: 'none',
            ratio: 1.0
          };

        case 'L1':
          // Light gzip for warm tier
          const l1Result = await this.gzipCompressor.compress(data);
          this.stats.compressed++;
          this.stats.bytesSaved += l1Result.originalSize - l1Result.compressedSize;
          return l1Result;

        case 'L2':
          // Brotli for cold/archive tier
          const l2Result = await this.brotliCompressor.compress(data);
          this.stats.compressed++;
          this.stats.bytesSaved += l2Result.originalSize - l2Result.compressedSize;
          return l2Result;
      }
    } catch (error) {
      this.stats.operationsFailed++;
      console.error(`[CompressionManager] Failed to compress for tier ${tier}:`, error);
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      return {
        data: buffer,
        originalSize: buffer.length,
        compressedSize: buffer.length,
        algorithm: 'none',
        ratio: 1.0
      };
    }
  }

  /**
   * Decompress data (auto-detects algorithm)
   */
  async decompress(data: Buffer, algorithm?: CompressionAlgorithm): Promise<string> {
    const detected = algorithm || this.gzipCompressor.detectAlgorithm(data);
    
    // If no algorithm provided and not Gzip, we might be dealing with Brotli
    // but without a magic number we can't be sure unless explicitly told.
    // However, for L2 compatibility where Brotli is default:
    const finalAlgorithm = detected === 'none' && !algorithm ? 'none' : detected;

    try {
      const compressor = finalAlgorithm === 'brotli' 
        ? this.brotliCompressor 
        : this.gzipCompressor;

      const result = await compressor.decompress(data, finalAlgorithm);
      this.stats.decompressed++;
      return result;
    } catch (error) {
      this.stats.operationsFailed++;
      return data.toString('utf-8');
    }
  }

  /**
   * Get compression statistics
   */
  getStats(): CompressionStats {
    return {
      compressed: this.stats.compressed,
      decompressed: this.stats.decompressed,
      bytesSaved: this.stats.bytesSaved,
      operationsFailed: this.stats.operationsFailed
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      compressed: 0,
      decompressed: 0,
      bytesSaved: 0,
      operationsFailed: 0
    };
  }
}

/**
 * CompressedStorage - Wrapper for transparent compression
 */
export class CompressedStorage {
  private manager: CompressionManager;
  private store: Map<string, { data: Buffer; algorithm: CompressionAlgorithm }> = new Map();

  constructor(manager?: CompressionManager) {
    this.manager = manager || new CompressionManager();
  }

  /**
   * Store with compression
   */
  async set(key: string, value: string, tier: 'L0' | 'L1' | 'L2' = 'L1'): Promise<void> {
    const result = await this.manager.compressForTier(value, tier);
    this.store.set(key, {
      data: result.data,
      algorithm: result.algorithm
    });
  }

  /**
   * Retrieve with decompression
   */
  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    return this.manager.decompress(entry.data, entry.algorithm);
  }

  /**
   * Delete entry
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    entries: number;
    totalBytes: number;
    compressionStats: ReturnType<CompressionManager['getStats']>;
  } {
    let totalBytes = 0;
    for (const entry of this.store.values()) {
      totalBytes += entry.data.length;
    }

    return {
      entries: this.store.size,
      totalBytes,
      compressionStats: this.manager.getStats()
    };
  }

  /**
   * Export all data
   */
  async export(): Promise<Array<{ key: string; value: string }>> {
    const entries: Array<{ key: string; value: string }> = [];
    
    for (const [key, entry] of this.store) {
      const value = await this.manager.decompress(entry.data, entry.algorithm);
      entries.push({ key, value });
    }

    return entries;
  }

  /**
   * Import data
   */
  async import(
    entries: Array<{ key: string; value: string }>,
    tier: 'L0' | 'L1' | 'L2' = 'L1'
  ): Promise<void> {
    for (const { key, value } of entries) {
      await this.set(key, value, tier);
    }
  }
}

// Export singleton instances
export const compressionManager = new CompressionManager();
export const compressedStorage = new CompressedStorage(compressionManager);
