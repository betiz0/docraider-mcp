-- Migration: Update search_vector for existing chunks
-- Backfills search_vector for all chunks that were created before migration 002/005

-- 既存チャンクの search_vector を content から再生成
UPDATE document_chunks
SET search_vector = to_tsvector('english', content)
WHERE search_vector IS NULL;
