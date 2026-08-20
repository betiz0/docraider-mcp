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
- **Durable Async Backfill**: Persistent jobs run in a detached worker with heartbeat/lease recovery, so work can continue after the requesting CLI exits
- **Embedding Readiness**: Reports coverage, worker health, and per-mode (`keyword` / `semantic` / `hybrid`) readiness, with an optional live probe
- **Agent CLI**: All 12 MCP operations are available through a machine-readable `docraider` CLI with stable JSON/JSONL output and exit codes
- **Agent Skills**: Ships discoverable `docraider-search`, `docraider-crawl`, and `docraider-manage` Skills for pi and other Agent Skills-compatible harnesses
- **Shared Operation Layer**: MCP and CLI adapters use the same typed operations while preserving the existing MCP contract
- **URL Normalization**: Prevents duplicate documents from trailing slashes, query order, and case differences
- **Documentation Crawling**: Playwright-powered crawler with ETag/Last-Modified caching and content hash change detection
- **MCP Integration**: Native stdio MCP tools remain available for existing AI-assistant integrations

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

## Agent CLI

After installing/building the package, invoke the agent-oriented CLI as `docraider` (or, from a source checkout, with `node dist/cli/entry.js`). Run `docraider --help` or append `--help` to a command for the authoritative option list.

The CLI covers all twelve MCP operations:

```text
docraider page read <url> [--content-limit <n>] [--output <path>]
docraider crawl site <url> [--max-pages <n>] [--max-depth <n>] [--format json|jsonl]
docraider crawl pages --url <url> [--url <url> ...] [--format json|jsonl]
docraider search <query> [--mode keyword|semantic|hybrid] [--limit <n>] [--offset <n>] [--site-id <id>] [--content-limit <n>]
docraider document get <id> [--content-limit <n>] [--output <path>]
docraider document list [--site-id <id>] [--limit <n>] [--offset <n>] [--sort-by last_crawled_at|created_at|title] [--sort-order asc|desc] [--content-limit <n>]
docraider stats
docraider site list [--limit <n>] [--offset <n>] [--sort-by last_crawled_at|created_at|domain|name] [--sort-order asc|desc]
docraider site get <id>
docraider site delete <id> --confirm <id>
docraider embedding backfill
docraider embedding status [--job-id <id>] [--probe]
```

Common options include `--config <path>` and `--help`. Site deletion is intentionally guarded: the value passed to `--confirm` must exactly match the target site ID. For large page or document bodies, prefer `--output` or set `--content-limit` rather than sending unrestricted content through an Agent conversation.

### JSON and JSONL contracts

By default, every command writes exactly one JSON document to stdout. Diagnostic logs go to stderr so stdout remains machine-parseable.

A successful response has this shape:

```json
{
  "ok": true,
  "command": "search",
  "data": {},
  "warnings": []
}
```

A failed response uses a stable error object and may include structured details:

```json
{
  "ok": false,
  "command": "document.get",
  "error": {
    "code": "NOT_FOUND",
    "message": "Document not found",
    "details": {}
  }
}
```

Only crawl commands explicitly invoked with `--format jsonl` produce JSON Lines. Each line is an independent event containing an event type, timestamp, and operation ID; the final line is a terminal success or failure event. Do not parse JSONL mode as a single JSON document.

### Configuration precedence

CLI and MCP use the same validated configuration. Configuration is selected in the following order, from highest to lowest priority:

1. `--config <path>`
2. `DOCRAIDER_CONFIG`
3. `config.yaml` in the current working directory
4. the package-bundled `config.yaml`
5. built-in defaults

When a configuration file is selected, its directory is also considered for `.env`; the package-root `.env` remains a compatibility fallback. Configuration is validated before database pools or browsers are created.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Unexpected/internal failure |
| `2` | Invalid input or unsafe confirmation |
| `3` | Requested document, site, or job not found |
| `4` | Configuration failure |
| `5` | Database failure |
| `6` | External service failure (crawl target or embedding endpoint) |

Agents should inspect both the process exit code and the JSON envelope. A non-zero code never changes the rule that the result envelope is written to stdout and diagnostics belong on stderr.

### Backfill and readiness examples

Backfill is accepted as a persistent job and processed by a detached package worker, so the initiating CLI can exit without owning the work:

```bash
# Queue work; retain data.jobId from the JSON response.
docraider embedding backfill

# Check one persistent job.
docraider embedding status --job-id 42

# Inspect overall coverage, worker state, latest job, and search readiness.
docraider embedding status

# Explicitly probe the embedding endpoint, model/dimension, pgvector, and schema.
docraider embedding status --probe
```

Normal status checks do not contact the embedding endpoint. Use `--probe` only when a live external-service check is needed. Readiness is reported separately for `keyword`, `semantic`, and `hybrid` as `ready`, `degraded`, or `unavailable`, together with reason codes and a recommended action. If semantic search is unavailable but keyword search is usable, prefer `--mode keyword`; a degraded hybrid result may explicitly allow keyword fallback. Do not repeatedly enqueue backfills while an active job is already queued or running.

## pi and Agent Skills

Install the npm package into pi and let pi discover the package-declared Skills:

```bash
pi install npm:docraider-mcp
```

The package provides three purpose-specific, Agent Skills-compatible Skills:

- **`docraider-search`** — search stored documentation, inspect bounded previews, and retrieve selected documents.
- **`docraider-crawl`** — choose between a single-page read, a site crawl, and a URL batch; use JSONL for long-running progress.
- **`docraider-manage`** — inspect index/readiness state, manage backfill jobs, list sites, and perform confirmed deletion safely.

Under pi, ask the Agent to perform the documentation task normally; pi loads the matching Skill on demand, and the Skill invokes its bundled wrapper. The wrapper prefers a `docraider` executable already on `PATH` and otherwise resolves the CLI entrypoint relative to the installed package, so a pi-managed install does not require a separate global npm bin setup.

For example, requests such as “search the indexed docs for authentication setup”, “crawl this documentation site”, or “check semantic-search readiness” select the corresponding workflow. Destructive site deletion still requires an explicit user request, a preceding `site get`, and a matching confirmation ID.

The same `skills/docraider-*` directories can be copied or installed into another Agent Skills-compatible harness. That harness must allow the Skill to run shell commands and must make the Docraider CLI available either on `PATH` or alongside the package in the layout expected by the included wrapper. No pi-specific tool API is required. If only a Skill directory is copied, install `docraider-mcp` separately and expose its `docraider` executable on `PATH`.

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

Queue a durable embedding-backfill job. The call returns immediately; a detached worker claims the job and records heartbeat, lease, progress, and failures in PostgreSQL. If an active job already exists, Docraider returns that job rather than running another backfill concurrently.

```json
{}
```

### get_backfill_status

Check the persistent progress of one backfill job. The existing MCP contract still requires `jobId`; use the CLI's `embedding status` command without a job ID for overall coverage and search readiness, or add `--probe` for a live endpoint/database compatibility check.

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

Get statistics about crawled documents, chunks, sites, crawl queue, and embedding progress.

```json
{}
```

### list_documents / list_sites / get_site / delete_site

Document and site operations support pagination and sorting. MCP site deletion preserves its existing `confirmDelete: true` contract; the CLI uses the stricter `--confirm <site-id>` guard described above.

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
| embedding | vector(N) | Embedding vector; dimensions must match `EMBEDDING_DIMENSIONS` |
| model_version | TEXT | Model identifier |

### backfill_jobs

Stores durable embedding jobs and worker ownership. Jobs use `queued`, `running`, `completed`, or `failed` status. The `worker_id`, `heartbeat_at`, and `lease_expires_at` fields allow another worker to recover stale work safely; `attempt_count` and `last_start_error` make worker-start failures and retry state observable.

## Development

```bash
# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run tests against services configured in your environment.
# Database/embedding integration tests require migrated PostgreSQL with
# PGroonga + pgvector and a reachable OpenAI-compatible embedding endpoint.
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
