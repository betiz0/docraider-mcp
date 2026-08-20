import type { PoolClient } from 'pg';
import { db, type DatabaseManager } from '../db/index.js';
import type { BackfillJob } from '../db/types.js';

export const DEFAULT_LEASE_MS = 30_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
const QUEUE_ADVISORY_LOCK = 0x444f4352; // "DOCR"

const JOB_COLUMNS = `
  id, status, total_chunks AS "totalChunks",
  processed_chunks AS "processedChunks", failed_chunks AS "failedChunks",
  error_message AS "errorMessage", started_at AS "startedAt",
  completed_at AS "completedAt", created_at AS "createdAt",
  worker_id AS "workerId", heartbeat_at AS "heartbeatAt",
  lease_expires_at AS "leaseExpiresAt", attempt_count AS "attemptCount",
  last_start_error AS "lastStartError"`;

export interface BackfillRepository {
  createOrGetActive(totalChunks: number): Promise<BackfillJob>;
  claimNext(workerId: string, leaseMs?: number, maxAttempts?: number): Promise<BackfillJob | null>;
  heartbeat(jobId: number, workerId: string, processed: number, failed: number, leaseMs?: number): Promise<boolean>;
  complete(jobId: number, workerId: string, processed: number, failed: number): Promise<boolean>;
  fail(jobId: number, workerId: string, error: string): Promise<boolean>;
  recordStartError(jobId: number, error: string): Promise<void>;
  get(jobId: number): Promise<BackfillJob | null>;
  latest(): Promise<BackfillJob | null>;
}

export class PgBackfillRepository implements BackfillRepository {
  constructor(private readonly database: DatabaseManager = db) {}

  async createOrGetActive(totalChunks: number): Promise<BackfillJob> {
    return this.database.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [QUEUE_ADVISORY_LOCK]);
      const active = await client.query<BackfillJob>(
        `SELECT ${JOB_COLUMNS} FROM backfill_jobs
         WHERE status IN ('queued', 'running')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      );
      if (active.rows[0]) return active.rows[0];
      const created = await client.query<BackfillJob>(
        `INSERT INTO backfill_jobs (status, total_chunks) VALUES ('queued', $1)
         RETURNING ${JOB_COLUMNS}`,
        [totalChunks],
      );
      return created.rows[0];
    });
  }

  async claimNext(workerId: string, leaseMs = DEFAULT_LEASE_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS): Promise<BackfillJob | null> {
    return this.database.transaction(async (client) => {
      const candidate = await client.query<{ id: number; attemptCount: number }>(
        `SELECT id, attempt_count AS "attemptCount" FROM backfill_jobs
         WHERE status = 'queued' OR (status = 'running' AND lease_expires_at <= NOW())
         ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const row = candidate.rows[0];
      if (!row) return null;
      if (row.attemptCount >= maxAttempts) {
        await client.query(
          `UPDATE backfill_jobs SET status='failed', error_message=$2, completed_at=NOW(),
           worker_id=NULL, heartbeat_at=NULL, lease_expires_at=NULL WHERE id=$1`,
          [row.id, `Maximum worker attempts (${maxAttempts}) exceeded`],
        );
        return null;
      }
      const claimed = await client.query<BackfillJob>(
        `UPDATE backfill_jobs SET status='running', worker_id=$2, heartbeat_at=NOW(),
         lease_expires_at=NOW() + ($3 * INTERVAL '1 millisecond'),
         attempt_count=attempt_count+1, started_at=COALESCE(started_at, NOW()),
         completed_at=NULL, error_message=NULL, last_start_error=NULL
         WHERE id=$1 RETURNING ${JOB_COLUMNS}`,
        [row.id, workerId, leaseMs],
      );
      return claimed.rows[0];
    });
  }

  async heartbeat(jobId: number, workerId: string, processed: number, failed: number, leaseMs = DEFAULT_LEASE_MS): Promise<boolean> {
    const rows = await this.database.query<{ id: number }>(
      `UPDATE backfill_jobs SET heartbeat_at=NOW(),
       lease_expires_at=NOW() + ($5 * INTERVAL '1 millisecond'),
       processed_chunks=$3, failed_chunks=$4
       WHERE id=$1 AND worker_id=$2 AND status='running' AND lease_expires_at > NOW()
       RETURNING id`, [jobId, workerId, processed, failed, leaseMs]);
    return rows.length === 1;
  }

  async complete(jobId: number, workerId: string, processed: number, failed: number): Promise<boolean> {
    const rows = await this.database.query<{ id: number }>(
      `UPDATE backfill_jobs SET status='completed', processed_chunks=$3, failed_chunks=$4,
       completed_at=NOW(), heartbeat_at=NOW(), lease_expires_at=NULL
       WHERE id=$1 AND worker_id=$2 AND status='running' RETURNING id`,
      [jobId, workerId, processed, failed]);
    return rows.length === 1;
  }

  async fail(jobId: number, workerId: string, error: string): Promise<boolean> {
    const rows = await this.database.query<{ id: number }>(
      `UPDATE backfill_jobs SET status='failed', error_message=$3, completed_at=NOW(),
       lease_expires_at=NULL WHERE id=$1 AND worker_id=$2 AND status='running' RETURNING id`,
      [jobId, workerId, error]);
    return rows.length === 1;
  }

  async recordStartError(jobId: number, error: string): Promise<void> {
    await this.database.query(
      `UPDATE backfill_jobs SET last_start_error=$2 WHERE id=$1 AND status='queued'`,
      [jobId, error]);
  }

  async get(jobId: number): Promise<BackfillJob | null> {
    const rows = await this.database.query<BackfillJob>(`SELECT ${JOB_COLUMNS} FROM backfill_jobs WHERE id=$1`, [jobId]);
    return rows[0] ?? null;
  }

  async latest(): Promise<BackfillJob | null> {
    const rows = await this.database.query<BackfillJob>(`SELECT ${JOB_COLUMNS} FROM backfill_jobs ORDER BY id DESC LIMIT 1`);
    return rows[0] ?? null;
  }
}
