/** Durable embedding backfill queue. Processing is owned by a detached worker. */
import { spawn, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { PgBackfillRepository } from './backfill-repository.js';

export interface SpawnedWorker {
  unref(): void;
  once?(event: 'error', listener: (error: Error) => void): unknown;
}
export type WorkerSpawner = (command: string, args: string[], options: SpawnOptions) => SpawnedWorker;

export async function startBackfill(spawner: WorkerSpawner = spawn): Promise<{
  jobId: number; estimatedTotal: number; status: string;
}> {
  const stats = await db.getEmbeddingStats();
  const totalToProcess = stats.pendingCount + stats.failedCount;
  const repository = new PgBackfillRepository();
  const latest = await repository.latest();
  const active = latest && (latest.status === 'queued' ||
    (latest.status === 'running' && !!latest.leaseExpiresAt && latest.leaseExpiresAt.getTime() > Date.now()));
  if (active) {
    if (latest.status === 'queued') await launchWorker(latest.id, repository, spawner);
    return { jobId: latest.id, estimatedTotal: latest.totalChunks, status: latest.status };
  }
  if (totalToProcess === 0) return { jobId: 0, estimatedTotal: 0, status: 'no work' };

  const job = await repository.createOrGetActive(totalToProcess);
  await launchWorker(job.id, repository, spawner);
  return { jobId: job.id, estimatedTotal: job.totalChunks, status: job.status };
}

async function launchWorker(jobId: number, repository: PgBackfillRepository, spawner: WorkerSpawner): Promise<void> {
  const adjacentWorkerPath = fileURLToPath(new URL('./backfill-worker.js', import.meta.url));
  const distWorkerPath = fileURLToPath(new URL('../../dist/embedding/backfill-worker.js', import.meta.url));
  const sourceWorkerPath = fileURLToPath(new URL('./backfill-worker.ts', import.meta.url));
  const workerPath = existsSync(adjacentWorkerPath) ? adjacentWorkerPath
    : existsSync(distWorkerPath) ? distWorkerPath : sourceWorkerPath;
  const workerArgs = workerPath.endsWith('.ts')
    ? [fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url)), workerPath]
    : [workerPath];
  try {
    const child = spawner(process.execPath, workerArgs, {
      detached: true, stdio: 'ignore', env: process.env,
    });
    // spawn() reports many launch failures asynchronously (for example ENOENT).
    // Persist them without changing the accepted/queued response contract.
    child.once?.('error', (error) => {
      void Promise.resolve(repository.recordStartError(jobId, error.message)).catch(() => undefined);
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.recordStartError(jobId, message);
  }
}

export async function getBackfillStatus(jobId: number): Promise<{
  jobId: number; status: string; totalChunks: number; processedChunks: number;
  failedChunks: number; errorMessage: string | null; startedAt: string | null;
  completedAt: string | null; workerId: string | null; heartbeatAt: string | null;
  leaseExpiresAt: string | null; attemptCount: number; lastStartError: string | null;
} | null> {
  const job = await new PgBackfillRepository().get(jobId);
  if (!job) return null;
  return { jobId: job.id, status: job.status, totalChunks: job.totalChunks,
    processedChunks: job.processedChunks, failedChunks: job.failedChunks,
    errorMessage: job.errorMessage, startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null, workerId: job.workerId,
    heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    attemptCount: job.attemptCount, lastStartError: job.lastStartError };
}

export async function getEmbeddingStats(): Promise<{
  totalChunks: number; pendingCount: number; completedCount: number; failedCount: number;
  currentJob: { jobId: number; status: string; processedChunks: number; totalChunks: number } | null;
}> {
  const stats = await db.getEmbeddingStats();
  const job = await new PgBackfillRepository().latest();
  const active = job && (job.status === 'queued' || job.status === 'running') ? job : null;
  return { ...stats, currentJob: active ? { jobId: active.id, status: active.status,
    processedChunks: active.processedChunks, totalChunks: active.totalChunks } : null };
}

export async function enqueueEmbeddingsForChunks(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  const placeholders = chunkIds.map((_, i) => `$${i + 2}`).join(', ');
  await db.query(`UPDATE document_chunks SET embedding_status='pending', embedding_attempts=0,
    embedding_error=NULL, embedding_updated_at=NOW() WHERE id IN (${placeholders})`,
    [config.embedding.model, ...chunkIds]);
}

export async function embedChunks(chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  const chunks = await db.getChunksForEmbedding(chunkIds.length);
  if (chunks.length === 0) return;
  const { generateAndUpsertEmbeddings } = await import('./generate.js');
  await generateAndUpsertEmbeddings(chunks.map((c) => ({ chunkId: c.id, content: c.content })));
}
