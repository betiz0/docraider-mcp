import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db } from '../db/index.js';
import { applyConfig, loadConfig } from '../config.js';
import { generateAndUpsertEmbeddings } from './generate.js';
import { DEFAULT_LEASE_MS, PgBackfillRepository } from './backfill-repository.js';

export interface WorkerOptions {
  workerId?: string;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  idleDelayMs?: number;
}

export async function runBackfillWorker(options: WorkerOptions = {}): Promise<boolean> {
  const workerId = options.workerId ?? `${process.pid}-${randomUUID()}`;
  const batchSize = options.batchSize ?? 32;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const repository = new PgBackfillRepository();
  const job = await repository.claimNext(workerId, leaseMs, options.maxAttempts);
  if (!job) return false;

  let processed = job.processedChunks;
  let failed = job.failedChunks;
  try {
    while (true) {
      const chunks = await db.getChunksForEmbedding(batchSize);
      if (chunks.length === 0) break;
      // Embedding calls may take longer than a small lease. Renew ownership at half
      // the lease interval as well as after every completed batch.
      let leaseLost = false;
      const heartbeatTimer = setInterval(() => {
        void repository.heartbeat(job.id, workerId, processed, failed, leaseMs)
          .then((owned) => { if (!owned) leaseLost = true; })
          .catch(() => { leaseLost = true; });
      }, Math.max(100, Math.floor(leaseMs / 2)));
      heartbeatTimer.unref();
      let results;
      try {
        results = await generateAndUpsertEmbeddings(
          chunks.map(({ id, content }) => ({ chunkId: id, content })),
        );
      } finally {
        clearInterval(heartbeatTimer);
      }
      if (leaseLost) throw new Error('Backfill lease was lost');
      processed += results.filter((result) => result.success).length;
      failed += results.filter((result) => !result.success).length;
      if (!(await repository.heartbeat(job.id, workerId, processed, failed, leaseMs))) {
        throw new Error('Backfill lease was lost');
      }
      if (options.idleDelayMs) await new Promise((resolve) => setTimeout(resolve, options.idleDelayMs));
    }
    if (!(await repository.complete(job.id, workerId, processed, failed))) {
      throw new Error('Backfill job ownership was lost before completion');
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.fail(job.id, workerId, message);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    applyConfig(loadConfig().config);
    await db.connect();
    await runBackfillWorker();
  } finally {
    await db.disconnect();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
