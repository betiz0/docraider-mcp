import type { PipelineResult } from '../extraction/types.js';

/**
 * Options for crawling a documentation site
 */
export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  maxConcurrent?: number;
  respectRobots?: boolean;
  sitemapUrl?: string;
}

/**
 * Result of crawling a single page
 */
export interface CrawlResult {
  url: string;
  title?: string;
  success: boolean;
  error?: string;
  documentId?: string;
  discoveredLinks?: string[];
  depth?: number;
  // Enhanced error details for structured logging
  statusCode?: number;
  errorType?: 'waf_blocked' | 'rate_limited' | 'forbidden' | 'not_found' | 'server_error' | 'extraction_error' | 'unknown';
}

/**
 * Data retrieved from a page fetch
 */
export interface PageData {
  url: string;
  html: string;
  statusCode: number;
  etag?: string;
  lastModified?: string;
}

/**
 * Internal state for tracking crawl progress
 */
export interface CrawlState {
  visited: Set<string>;
  toVisit: Set<string>;
  currentDepth: number;
  pagesCrawled: number;
}

/**
 * Processed page data after extraction
 */
export interface ProcessedPage {
  url: string;
  title: string;
  contentHash: string;
  pipelineResult: PipelineResult;
  etag?: string;
  lastModified?: string;
}