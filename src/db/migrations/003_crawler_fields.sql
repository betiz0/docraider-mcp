-- Add crawler-specific fields to documents table for ETag/Last-Modified caching and content change detection
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS etag TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_modified TEXT;

-- Index for faster lookups by content hash
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_etag ON documents(etag);
CREATE INDEX IF NOT EXISTS idx_documents_last_modified ON documents(last_modified);