-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_crawled_at TIMESTAMPTZ
);

-- GIN index for full-text search on documents
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);

-- Document chunks table for RAG with generated search vector
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    heading_path TEXT[] DEFAULT '{}',
    search_vector TSVECTOR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GIN index for full-text search on chunks (idx_chunks_fts)
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- Note: pgvector extension and chunks_embedding table are handled in migration 002_pgvector.sql

-- Crawl queue table
CREATE TABLE IF NOT EXISTS crawl_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL UNIQUE,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue(status);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_priority ON crawl_queue(priority DESC, created_at ASC);