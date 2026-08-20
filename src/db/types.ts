export interface Site {
  id: string;
  baseUrl: string;
  domain: string;
  name: string | null;
  documentCount: number;
  lastCrawledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SiteListParams {
  limit?: number;
  offset?: number;
  sortBy?: 'last_crawled_at' | 'created_at' | 'domain' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface SiteWithPagination {
  sites: Site[];
  total: number;
  limit: number;
  offset: number;
}

export interface Document {
  id: string;
  url: string;
  title: string;
  content: string;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastCrawledAt: Date | null;
  etag?: string | null;
  lastModified?: string | null;
  contentHash?: string | null;
  siteId?: string | null;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  headingPath: string[];
  embedding: number[] | null;
  embeddingStatus: 'pending' | 'completed' | 'failed' | null;
  embeddingAttempts: number | null;
  embeddingError: string | null;
  embeddingModel: string | null;
  embeddingUpdatedAt: Date | null;
  createdAt: Date;
}

export interface ChunkEmbedding {
  chunkId: string;
  embedding: number[];
  modelVersion: string;
  createdAt: Date;
}

export interface CrawlQueue {
  id: string;
  url: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrawlResult {
  url: string;
  title: string;
  content: string;
  summary: string | null;
  chunks: Array<{
    content: string;
    embedding: number[] | null;
  }>;
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  content: string;
  score: number;
  chunkIndex: number | null;
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface HybridSearchResult {
  chunkId: string;
  documentId: string;
  url: string;
  title: string;
  content: string;
  headingPath: string[];
  score: number;
  matchType: 'keyword' | 'semantic' | 'both';
}

export interface BackfillJob {
  id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  workerId: string | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  lastStartError: string | null;
}

export interface EmbeddingStats {
  totalChunks: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
}