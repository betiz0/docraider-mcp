-- pgvector extension for embedding storage
-- This migration is optional - if pgvector is not installed, this will be skipped gracefully

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS chunks_embedding (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
        embedding vector(1536),
        model_version TEXT NOT NULL DEFAULT 'unknown',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_embedding_chunk_model
        ON chunks_embedding (chunk_id, model_version);

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pgvector extension not available, skipping embedding table creation';
END $$;
