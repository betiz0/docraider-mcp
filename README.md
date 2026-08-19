# docraider-mcp

Documentation crawler and extraction MCP server for intelligent document processing and hybrid search.

## Overview

Docraider-MCP is a Model Context Protocol (MCP) server that crawls documentation sites, extracts clean content using Readability and Cheerio, and provides **hybrid search** (keyword + semantic) powered by PostgreSQL with PGroonga and pgvector.

## Features

- **Smart Content Extraction**: Uses Readability as primary extractor with Cheerio fallback for robust HTML-to-Markdown conversion
- **Hybrid Search**: PostgreSQL-based search combining PGroonga keyword matching with pgvector semantic similarity, fused via Reciprocal Rank Fusion (RRF)
- **Three Search Modes**: `keyword`, `semantic`, and `hybrid` (default) — choose the best approach per query
- **Graceful Degradation**: Keyword search continues working even when embeddings are unavailable
- **Auto-Embedding**: Newly crawled documents are automatically queued for embedding generation
- **Async Backfill**: Generate embeddings for existing documents in the background
- **URL Normalization**: Prevents duplicate documents from trailing slashes, query order, case differences
- **Documentation Crawling**: Playwright-powered crawler with ETag/Last-Modified caching and content hash change detection
- **MCP Integration**: Native MCP tools for seamless integration with AI assistants

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 13
- **PGroonga extension** (for Japanese + English full-text search)
- **pgvector extension** (for semantic similarity search)
- npm or yarn
- OpenAI-compatible embedding API (local Ollama server recommended, or cloud API)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. PostgreSQL Setup

```sql
-- Create database and user
CREATE DATABASE docraider-mcp;
CREATE USER docraider-mcp_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE docraider-mcp TO docraider-mcp_user;

-- Connect to the database and create extensions
\c docraider-mcp
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgroonga;
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database Configuration
DOCRAIDER_DB_HOST=localhost
DOCRAIDER_DB_PORT=5432
DOCRAIDER_DB_NAME=docraider-mcp
DOCRAIDER_DB_USER=docraider-mcp_user
DOCRAIDER_DB_PASSWORD=your_password
DOCRAIDER_DB_SSL=false
DOCRAIDER_DB_POOL_MAX=20
DOCRAIDER_DB_POOL_MIN=5

# Embedding Configuration (OpenAI-compatible API)
# Local: http://localhost:11434 (Ollama with nomic-embed-text)
# Cloud: https://api.openai.com
EMBEDDING_ENDPOINT=http://localhost:11434
EMBEDDING_API_KEY=
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
EMBEDDING_BATCH_SIZE=16
EMBEDDING_TIMEOUT_MS=30000
```

### 4. Run Migrations

```bash
# Migrations are run automatically on server startup
npm run dev
```

## Configuration

The `config.yaml` file provides runtime configuration with environment variable substitution:

```yaml
# Embedding configuration
embedding:
  endpoint: "${EMBEDDING_ENDPOINT:-http://localhost:11434}"
  apiKey: "${EMBEDDING_API_KEY:-}"
  model: "${EMBEDDING_MODEL:-nomic-embed-text}"
  dimensions: "${EMBEDDING_DIMENSIONS:-768}"
  batchSize: "${EMBEDDING_BATCH_SIZE:-16}"
  timeoutMs: "${EMBEDDING_TIMEOUT_MS:-30000}"
```

## MCP Tools

### read_and_extract_page

Extract clean Markdown content from a single URL.

```json
{
  "url": "https://example.com/docs/api"
}
```

### crawl_documentation_site

Crawl an entire documentation site starting from a base URL.

```json
{
  "url": "https://example.com/docs",
  "maxPages": 100,
  "maxDepth": 3
}
```

### search_crawled_docs

Search crawled documentation with three modes:

```json
{
  "query": "authentication methods",
  "mode": "hybrid",       // "keyword" | "semantic" | "hybrid" (default)
  "limit": 20,
  "offset": 0,
  "siteId": "optional-site-id"
}
```

**Mode descriptions:**
- `keyword`: PGroonga full-text search with Japanese/English tokenization
- `semantic`: Vector similarity search using embeddings
- `hybrid`: Combines both via Reciprocal Rank Fusion (RRF) — recommended default

Each result includes `matchType` (`keyword`, `semantic`, or `both`) and a `score`.

### crawl_component_docs

Crawl documentation for specific URLs in batch.

```json
{
  "urls": ["https://example.com/docs/button", "https://example.com/docs/input"]
}
```

### backfill_embeddings

Start async backfill to generate embeddings for existing chunks. Returns immediately with a `jobId`.

```json
{}
```

### get_backfill_status

Check the status of a backfill job.

```json
{
  "jobId": 1
}
```

### get_document

Retrieve a specific document by ID.

```json
{
  "documentId": "uuid-here"
}
```

### get_index_stats

Get statistics about crawled documents, chunks, and embedding progress.

```json
{}
```

### list_documents / list_sites / get_site / delete_site

Standard CRUD operations for documents and sites with pagination.

## Search Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client (Claude)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     docraider-mcp Server                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Search Orchestrator (search.ts)           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐ │  │
│  │  │ Keyword  │  │ Semantic │  │  RRF Fusion         │ │  │
│  │  │ Search   │  │ Search   │  │  (fusion.ts)        │ │  │
│  │  │(PGroonga)│  │(pgvector)│  │                     │ │  │
│  │  └──────────┘  └──────────┘  └─────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────┐
│   Crawler     │   │   Embedding     │   │   Search    │
│ (crawler/)    │   │ (embedding/)    │   │             │
│ - normalizeUrl│   │ - client        │   │             │
│ - auto-embed  │   │ - generate      │   │             │
│               │   │ - backfill      │   │             │
└───────────────┘   └─────────────────┘   └─────────────┘
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                       │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ documents    │  │ document_     │  │ chunks_embedding│  │
│  │              │  │ chunks        │  │ (pgvector)      │  │
│  │ - url (uniq) │  │ - search_     │  │                 │  │
│  │ - content    │  │   vector      │  │ - embedding     │  │
│  │ - site_id    │  │ - embedding_  │  │ - model_version │  │
│  └──────────────┘  │   status      │  └─────────────────┘  │
│                    │ (pending/     │                        │
│  ┌──────────────┐  │  completed/   │  ┌─────────────────┐  │
│  │ sites        │  │  failed)      │  │ backfill_jobs   │  │
│  └──────────────┘  └───────────────┘  │ (progress)      │  │
│                                       └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### documents

Stores crawled document metadata and content.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| url | TEXT | Unique URL (normalized) |
| title | TEXT | Page title |
| content | TEXT | Markdown content |
| content_hash | TEXT | SHA-256 hash for change detection |
| site_id | UUID | Foreign key to sites |
| last_crawled_at | TIMESTAMPTZ | Last crawl timestamp |

### document_chunks

Stores searchable chunks with embedding status tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| document_id | UUID | Foreign key to documents |
| chunk_index | INTEGER | Order within document |
| content | TEXT | Chunk text content |
| heading_path | TEXT[] | Heading hierarchy path |
| embedding_status | TEXT | pending/completed/failed |
| embedding_attempts | INTEGER | Number of generation attempts |
| embedding_model | TEXT | Model used for embedding |

### chunks_embedding

Stores vector embeddings for semantic search.

| Column | Type | Description |
|--------|------|-------------|
| chunk_id | UUID | Foreign key to document_chunks (CASCADE) |
| embedding | vector(N) | Embedding vector |
| model_version | TEXT | Model identifier |

## Development

```bash
# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run unit tests (uses the configured database for integration suites)
npm test

# Start the reproducible PostgreSQL + PGroonga + pgvector test environment
docker compose -f docker-compose.test.yml up -d --build --wait
DOCRAIDER_DB_PORT=55432 EMBEDDING_DIMENSIONS=1536 npx tsx src/db/migrate.ts

# Run the complete acceptance suite against the test environment
DOCRAIDER_DB_PORT=55432 \
EMBEDDING_ENDPOINT=http://localhost:11435 \
EMBEDDING_DIMENSIONS=1536 \
npm test -- --run

# Stop the test environment
docker compose -f docker-compose.test.yml down -v

# Run tests in watch mode
npm run test:watch
```

## License

MIT
