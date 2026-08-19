-- Migration 008: Add embedding status tracking to document_chunks
-- Tracks embedding generation state for each chunk
-- Enables incremental backfill and degradation fallback

BEGIN;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS embedding_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding_error TEXT,
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- Partial index for finding chunks that need embedding
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_status
  ON document_chunks (embedding_status)
  WHERE embedding_status IN ('pending', 'failed');

COMMIT;
