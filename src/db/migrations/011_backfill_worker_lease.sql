-- Migration 011: durable backfill queue, worker ownership, and leases
-- Nullable lease columns keep this migration backwards compatible with old readers.

BEGIN;

ALTER TABLE backfill_jobs DROP CONSTRAINT IF EXISTS backfill_jobs_status_check;

UPDATE backfill_jobs SET status = 'queued' WHERE status = 'pending';

ALTER TABLE backfill_jobs
  ALTER COLUMN status SET DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_start_error TEXT;

ALTER TABLE backfill_jobs
  ADD CONSTRAINT backfill_jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

-- Jobs created by the old in-process implementation have no durable owner.
-- Expire them immediately so a lease-aware worker can safely recover them.
UPDATE backfill_jobs
SET lease_expires_at = COALESCE(lease_expires_at, NOW() - INTERVAL '1 second')
WHERE status = 'running' AND (worker_id IS NULL OR heartbeat_at IS NULL);

DROP INDEX IF EXISTS idx_backfill_jobs_status;
CREATE INDEX idx_backfill_jobs_claimable
  ON backfill_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'running');

COMMIT;
