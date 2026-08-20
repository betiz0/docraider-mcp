import { Pool, PoolClient } from 'pg';
import { config } from '../config.js';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_CONNECTION_TIMEOUT_MS,
} from '../constants/index.js';
import type { Document, DocumentChunk, CrawlQueue, CrawlResult, SearchResult, BackfillJob, EmbeddingStats } from './types.js';

const DB_CONNECTION_TIMEOUT = DEFAULT_CONNECTION_TIMEOUT_MS;
const DB_IDLE_TIMEOUT = 30000;
const DB_MAX_LIFETIME = 60000;

class DatabaseManager {
  private pool: Pool | null = null;
  private isConnected = false;

  private createPool(): Pool {
    const pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
      max: config.database.poolMax,
      min: config.database.poolMin,
      connectionTimeoutMillis: DB_CONNECTION_TIMEOUT,
      idleTimeoutMillis: DB_IDLE_TIMEOUT,
    });

    pool.on('error', (err) => { console.error('Unexpected error on idle client', err); });
    return pool;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.pool ??= this.createPool();
    try {
      const client = await this.pool.connect();
      client.release();
      this.isConnected = true;
    } catch (error) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
    this.isConnected = false;
  }

  async getClient(): Promise<PoolClient> {
    this.pool ??= this.createPool();
    return this.pool.connect();
  }

  async query<T extends object = object>(text: string, params?: unknown[]): Promise<T[]> {
    const client = await this.getClient();
    try {
      const result = await client.query<T>(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Document operations
  async createDocument(doc: Omit<Document, 'id' | 'createdAt' | 'updatedAt'>): Promise<Document> {
    const result = await this.query<Document>(
      `INSERT INTO documents (url, title, content, summary, last_crawled_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [doc.url, doc.title, doc.content, doc.summary, doc.lastCrawledAt]
    );
    return result[0];
  }

  async getDocumentById(id: string): Promise<Document | null> {
    const result = await this.query<Document>('SELECT * FROM documents WHERE id = $1', [id]);
    return result[0] || null;
  }

  async getDocumentByUrl(url: string): Promise<Document | null> {
    const result = await this.query<Document>('SELECT * FROM documents WHERE url = $1', [url]);
    return result[0] || null;
  }

  async updateDocument(id: string, updates: Partial<Document>): Promise<Document | null> {
    const setClause = Object.keys(updates)
      .map((key, i) => `"${key}" = $${i + 1}`)
      .join(', ');
    const values = Object.values(updates);
    values.push(id);

    const result = await this.query<Document>(
      `UPDATE documents SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return result[0] || null;
  }

  async listDocuments(params: {
    siteId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'last_crawled_at' | 'created_at' | 'title';
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{ documents: Array<Document & { siteBaseUrl?: string; chunkCount: number }>; total: number; limit: number; offset: number }> {
    const limit = Math.min(params.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const offset = params.offset ?? 0;
    const sortBy = params.sortBy ?? 'last_crawled_at';
    const sortOrder = params.sortOrder ?? 'desc';

    const allowedSortColumns = ['last_crawled_at', 'created_at', 'title'];
    const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'last_crawled_at';

    let whereClause = '';
    const queryParams: unknown[] = [];

    if (params.siteId) {
      whereClause = 'WHERE d.site_id = $1';
      queryParams.push(params.siteId);
    }

    const countResult = await this.query<{ count: string }>(
      `SELECT COUNT(*) FROM documents d ${whereClause}`,
      queryParams
    );

    const documents = await this.query<Document & { siteBaseUrl?: string; chunkCount: number }>(
      `SELECT d.*, s.base_url as "siteBaseUrl",
              (SELECT COUNT(*) FROM document_chunks dc WHERE dc.document_id = d.id) as "chunkCount"
       FROM documents d
       LEFT JOIN sites s ON d.site_id = s.id
       ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
       LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
      [...queryParams, limit, offset]
    );

    return {
      documents,
      total: parseInt(countResult[0].count, 10),
      limit,
      offset,
    };
  }

  async countDocuments(siteId?: string): Promise<number> {
    if (siteId) {
      const result = await this.query<{ count: string }>(
        'SELECT COUNT(*) FROM documents WHERE site_id = $1',
        [siteId]
      );
      return parseInt(result[0].count, 10);
    }
    const result = await this.query<{ count: string }>('SELECT COUNT(*) FROM documents', []);
    return parseInt(result[0].count, 10);
  }

  // Document chunk operations
  async createChunks(documentId: string, chunks: Array<{ content: string; embedding?: number[]; headingPath?: string[] }>): Promise<void> {
    await this.transaction(async (client) => {
      for (let i = 0; i < chunks.length; i++) {
        await client.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content, heading_path, embedding_status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [documentId, i, chunks[i].content, chunks[i].headingPath ?? null]
        );
      }
    });
  }

  async getChunksByDocumentId(documentId: string): Promise<DocumentChunk[]> {
    return this.query<DocumentChunk>('SELECT * FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index', [documentId]);
  }

  // Crawl queue operations
  async enqueueUrl(url: string, priority = 0): Promise<CrawlQueue> {
    const result = await this.query<CrawlQueue>(
      `INSERT INTO crawl_queue (url, priority, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (url) DO UPDATE SET priority = GREATEST(crawl_queue.priority, $2)
       RETURNING *`,
      [url, priority]
    );
    return result[0];
  }

  async getNextPendingUrl(): Promise<CrawlQueue | null> {
    const result = await this.query<CrawlQueue>(
      `UPDATE crawl_queue
       SET status = 'processing', updated_at = NOW()
       WHERE id = (
         SELECT id FROM crawl_queue
         WHERE status = 'pending'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      []
    );
    return result[0] || null;
  }

  async markQueueItemCompleted(id: string): Promise<void> {
    await this.query('UPDATE crawl_queue SET status = $1, updated_at = NOW() WHERE id = $2', ['completed', id]);
  }

  async markQueueItemFailed(id: string, error: string): Promise<void> {
    await this.query(
      `UPDATE crawl_queue
       SET status = 'pending', retry_count = retry_count + 1, last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [error, id]
    );
  }

  // Search operations
  async searchDocuments(query: string, limit = 20): Promise<SearchResult[]> {
    return this.query<SearchResult>(
      `SELECT id, url, title, content, 0 as score, NULL as chunk_index
       FROM documents
       WHERE title ILIKE $1 OR content ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [`%${query}%`, limit]
    );
  }

  async searchChunks(query: string, limit = 20): Promise<SearchResult[]> {
    const language = config.search.language;
    return this.query<SearchResult>(
      `SELECT dc.id, d.url, d.title, dc.content,
              ts_rank_cd(dc.search_vector, plainto_tsquery($2, $1)) as score,
              dc.chunk_index
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       WHERE dc.search_vector @@ plainto_tsquery($2, $1)
       ORDER BY score DESC
       LIMIT $3`,
      [query, language, limit]
    );
  }

  // Embedding status aggregation
  async getEmbeddingStats(): Promise<EmbeddingStats> {
    const result = await this.query<{
      total_chunks: string;
      pending_count: string;
      completed_count: string;
      failed_count: string;
    }>(
      `SELECT
        COUNT(*) as total_chunks,
        COUNT(*) FILTER (WHERE embedding_status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE embedding_status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE embedding_status = 'failed') as failed_count
       FROM document_chunks`
    );
    const row = result[0];
    return {
      totalChunks: parseInt(row.total_chunks, 10),
      pendingCount: parseInt(row.pending_count, 10),
      completedCount: parseInt(row.completed_count, 10),
      failedCount: parseInt(row.failed_count, 10),
    };
  }

  // Get chunks that need embedding (pending or failed), with FOR UPDATE SKIP LOCKED
  async getChunksForEmbedding(limit: number): Promise<Array<{ id: string; content: string }>> {
    return this.query<{ id: string; content: string }>(
      `SELECT id, content
       FROM document_chunks
       WHERE embedding_status = 'pending' OR (embedding_status = 'failed' AND embedding_attempts < 3)
       ORDER BY
         CASE embedding_status WHEN 'failed' THEN 0 ELSE 1 END,
         embedding_updated_at ASC NULLS FIRST
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
  }

  // Vector similarity search using pgvector
  async vectorSearch(
    vector: number[],
    options: {
      limit?: number;
      offset?: number;
      siteId?: string;
      minScore?: number;
    } = {}
  ): Promise<Array<{ chunkId: string; documentId: string; url: string; title: string; content: string; headingPath: string[]; similarity: number }>> {
    const { limit: topN = 20, offset = 0, siteId, minScore = 0 } = options;
    const vectorParam = siteId ? 2 : 1;
    const whereClause = siteId ? 'WHERE d.site_id = $1' : '';
    const paramIndex = siteId ? 3 : 2;

    const results = await this.query<{
      chunkId: string;
      documentId: string;
      url: string;
      title: string;
      content: string;
      headingPath: string[];
      similarity: number;
    }>(
      `SELECT
        ce.chunk_id as "chunkId",
        dc.document_id as "documentId",
        d.url,
        d.title,
        dc.content,
        dc.heading_path as "headingPath",
        (1 - (ce.embedding <=> $${vectorParam}::vector)) as similarity
       FROM chunks_embedding ce
       JOIN document_chunks dc ON ce.chunk_id = dc.id
       JOIN documents d ON dc.document_id = d.id
       ${whereClause}
       ORDER BY ce.embedding <=> $${vectorParam}::vector
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      siteId ? [siteId, JSON.stringify(vector), topN, offset] : [JSON.stringify(vector), topN, offset]
    );

    // Filter by minScore if specified
    if (minScore > 0) {
      return results.filter((r) => r.similarity >= minScore);
    }

    return results;
  }

  // PGroonga keyword search
  async keywordSearch(
    query: string,
    options: {
      limit?: number;
      offset?: number;
      siteId?: string;
    } = {}
  ): Promise<Array<{ chunkId: string; documentId: string; url: string; title: string; content: string; headingPath: string[]; score: number; highlight: string }>> {
    const { limit: topN = 20, offset = 0, siteId } = options;
    const whereClause = siteId ? 'AND d.site_id = $3' : '';
    const queryParam = siteId ? 4 : 3;
    const limitParam = siteId ? 5 : 4;

    // Build highlight regex pattern (escape special chars for PGroonga matching)
    const escapedQuery = query.replace(/[.+?^${}()|[\]\\-]/g, '\\$&');
    const highlightPattern = `(${escapedQuery})`;
    const highlightReplacement = '<mark>$1</mark>';

    const results = await this.query<{
      chunkId: string;
      documentId: string;
      url: string;
      title: string;
      content: string;
      headingPath: string[];
      score: number;
      highlight: string;
    }>(
      `SELECT
        dc.id as "chunkId",
        dc.document_id as "documentId",
        d.url,
        d.title,
        dc.content,
        dc.heading_path as "headingPath",
        pgroonga_score(dc.tableoid, dc.ctid) as score,
        regexp_replace(dc.content, $1, $2, 'gi') as highlight
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       WHERE dc.content &@~ $${queryParam}
       ${whereClause}
       ORDER BY pgroonga_score(dc.tableoid, dc.ctid) DESC
       LIMIT $${limitParam} OFFSET $${limitParam + 1}`,
      siteId ? [highlightPattern, highlightReplacement, siteId, query, topN, offset] : [highlightPattern, highlightReplacement, query, topN, offset]
    );

    return results;
  }

  // Backfill job CRUD
  async createBackfillJob(totalChunks: number): Promise<number> {
    const result = await this.query<{ id: number }>(
      `INSERT INTO backfill_jobs (status, total_chunks, processed_chunks, failed_chunks)
       VALUES ('pending', $1, 0, 0)
       RETURNING id`,
      [totalChunks]
    );
    return result[0].id;
  }

  async updateBackfillJobProgress(jobId: number, processed: number, failed: number): Promise<void> {
    await this.query(
      `UPDATE backfill_jobs
       SET processed_chunks = $1, failed_chunks = $2
       WHERE id = $3`,
      [processed, failed, jobId]
    );
  }

  async completeBackfillJob(jobId: number): Promise<void> {
    await this.query(
      `UPDATE backfill_jobs
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  }

  async failBackfillJob(jobId: number, errorMessage: string): Promise<void> {
    await this.query(
      `UPDATE backfill_jobs
       SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [errorMessage, jobId]
    );
  }

  async startBackfillJob(jobId: number): Promise<void> {
    await this.query(
      `UPDATE backfill_jobs
       SET status = 'running', started_at = NOW()
       WHERE id = $1`,
      [jobId]
    );
  }

  async getBackfillJob(jobId: number): Promise<BackfillJob | null> {
    const result = await this.query<BackfillJob>(
      'SELECT * FROM backfill_jobs WHERE id = $1',
      [jobId]
    );
    return result[0] || null;
  }

  async getRunningBackfillJob(): Promise<BackfillJob | null> {
    const result = await this.query<BackfillJob>(
      "SELECT * FROM backfill_jobs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
    );
    return result[0] || null;
  }
}

export const db = new DatabaseManager();
export { DatabaseManager };
export { siteRepository } from './site-repository.js';