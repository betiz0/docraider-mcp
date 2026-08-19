/**
 * Async embedding backfill service
 * Processes pending/failed chunks in batches, tracks progress in backfill_jobs table
 * Ensures idempotency: only one running job at a time, re-runnable
 */

import { db } from '../db/index.js';
import { generateAndUpsertEmbeddings } from './generate.js';
import { config } from '../config.js';

const BACKFILL_BATCH_SIZE = 32; // Process 32 chunks per batch

let currentJobId: number | null = null;
let isRunning = false;

/**
 * Start a new backfill job
 * Creates a job record and begins processing pending/failed chunks
 * @returns Job info with jobId, estimatedTotal, and status
 */
export async function startBackfill(): Promise<{
  jobId: number;
  estimatedTotal: number;
  status: string;
}> {
  // Check if there's already a running job
  const runningJob = await db.getRunningBackfillJob();
  if (runningJob) {
    return {
      jobId: runningJob.id,
      estimatedTotal: runningJob.totalChunks,
      status: runningJob.status,
    };
  }

  // Count chunks that need embedding
  const stats = await db.getEmbeddingStats();
  const totalToProcess = stats.pendingCount + stats.failedCount;

  if (totalToProcess === 0) {
    return { jobId: 0, estimatedTotal: 0, status: 'no work' };
  }

  // Create a new backfill job
  const jobId = await db.createBackfillJob(totalToProcess);
  await db.startBackfillJob(jobId);
  currentJobId = jobId;
  isRunning = true;

  // Process in background (non-blocking)
  processBackfill(jobId).catch((error) => {
    console.error(`[Backfill] Job ${jobId} failed:`, error);
  });

  return { jobId, estimatedTotal: totalToProcess, status: 'running' };
}

/**
 * Get the status of a backfill job
 */
export async function getBackfillStatus(jobId: number): Promise<{
  jobId: number;
  status: string;
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
} | null> {
  const job = await db.getBackfillJob(jobId);
  if (!job) return null;

  return {
    jobId: job.id,
    status: job.status,
    totalChunks: job.totalChunks,
    processedChunks: job.processedChunks,
    failedChunks: job.failedChunks,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

/**
 * Get stats for all embedding-related data
 */
export async function getEmbeddingStats(): Promise<{
  totalChunks: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  currentJob: {
    jobId: number;
    status: string;
    processedChunks: number;
    totalChunks: number;
  } | null;
}> {
  const stats = await db.getEmbeddingStats();
  const runningJob = await db.getRunningBackfillJob();

  return {
    ...stats,
    currentJob: runningJob
      ? {
          jobId: runningJob.id,
          status: runningJob.status,
          processedChunks: runningJob.processedChunks,
          totalChunks: runningJob.totalChunks,
        }
      : null,
  };
}

/**
 * Process backfill batches in a loop
 * Runs synchronously within a single job context
 */
async function processBackfill(jobId: number): Promise<void> {
  let processed = 0;
  let failed = 0;

  try {
    while (true) {
      // Fetch a batch of chunks for embedding
      const chunks = await db.getChunksForEmbedding(BACKFILL_BATCH_SIZE);

      if (chunks.length === 0) {
        // No more chunks to process
        break;
      }

      // Generate embeddings for this batch
      const results = await generateAndUpsertEmbeddings(chunks.map((c) => ({ chunkId: c.id, content: c.content })));

      // Count successes and failures
      for (const result of results) {
        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      }

      // Update job progress
      await db.updateBackfillJobProgress(jobId, processed, failed);

      // Small delay between batches to avoid overwhelming the embedding API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Mark job as completed
    await db.completeBackfillJob(jobId);
    console.error(`[Backfill] Job ${jobId} completed: ${processed} processed, ${failed} failed`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db.failBackfillJob(jobId, errorMessage);
    console.error(`[Backfill] Job ${jobId} failed: ${errorMessage}`);
  } finally {
    isRunning = false;
    currentJobId = null;
  }
}

/**
 * Enqueue embedding generation for new/changed chunks after crawl
 * Called automatically when chunks are saved during crawling
 */
export async function enqueueEmbeddingsForChunks(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;

  // Update embedding_status to 'pending' for the given chunk IDs
  const placeholders = chunkIds.map((_, i) => `$${i + 2}`).join(', ');
  await db.query(
    `UPDATE document_chunks
     SET embedding_status = 'pending',
         embedding_attempts = 0,
         embedding_error = NULL,
         embedding_updated_at = NOW()
     WHERE id IN (${placeholders})`,
    [config.embedding.model, ...chunkIds]
  );
}

/**
 * Generate embeddings for specific chunks (used by backfill and direct calls)
 */
export async function embedChunks(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;

  const chunks = await db.getChunksForEmbedding(chunkIds.length);
  if (chunks.length === 0) return;

  await generateAndUpsertEmbeddings(chunks.map((c) => ({ chunkId: c.id, content: c.content })));
}
