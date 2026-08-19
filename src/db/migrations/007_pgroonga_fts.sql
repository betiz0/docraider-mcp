-- Migration 007: Replace tsvector FTS with PGroonga for Japanese + English support
-- Addresses audit findings A-1 (FTS language mismatch) and A-2 (Japanese not tokenized)
-- Drops the old tsvector trigger and creates a PGroonga index

BEGIN;

-- Enable PGroonga extension
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- Drop the old tsvector trigger and function
DROP TRIGGER IF EXISTS trg_chunks_update_search_vector ON document_chunks;
DROP FUNCTION IF EXISTS update_search_vector;

-- Make search_vector nullable (PGroonga index handles search, tsvector column kept for backward compat)
-- Do NOT ALTER COLUMN search_vector SET NOT NULL — it's already nullable or will be left as-is

-- Create PGroonga index on document_chunks.content
-- PGroonga automatically tokenizes Japanese (MeCab) and English
CREATE INDEX IF NOT EXISTS idx_chunks_pgroonga ON document_chunks USING pgroonga (content);

-- Update existing search_vector entries to NULL (PGroonga handles search via &@~ operator)
UPDATE document_chunks SET search_vector = NULL WHERE search_vector IS NOT NULL;

COMMIT;
