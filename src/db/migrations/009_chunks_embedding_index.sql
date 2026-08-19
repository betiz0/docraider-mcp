-- Migration 009: Create HNSW index on chunks_embedding for fast vector search
-- Uses pgvector cosine similarity operator

BEGIN;

-- Enable pgvector extension (may already exist from migration 002)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create HNSW index for cosine similarity search
-- m=16, ef_construction=64 are good defaults for moderate-dimensional vectors
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks_embedding
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;
