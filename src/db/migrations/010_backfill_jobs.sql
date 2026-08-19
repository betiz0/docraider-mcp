-- Migration 010: Create backfill_jobs table for async embedding backfill
-- Tracks backfill job state, progress, and allows idempotent re-runs

BEGIN;

CREATE TABLE IF NOT EXISTS backfill_jobs (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_chunks INT NOT NULL DEFAULT 0,
  processed_chunks INT NOT NULL DEFAULT 0,
  failed_chunks INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_jobs_status
  ON backfill_jobs (status)
  WHERE status IN ('pending', 'running');

COMMIT;
