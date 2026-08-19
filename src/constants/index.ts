/**
 * Project-wide constants for docraider-mcp
 * Layer 2: PROJECT-GLOBAL constants
 */

// Server constants
export const SERVER_NAME = 'docraider-mcp'; // MCP server name
export const SERVER_VERSION = '1.0.0'; // MCP server version
export const DEFAULT_SERVER_PORT = 3000; // Default HTTP server port
export const DEFAULT_MAX_CONNECTIONS = 200; // Default max concurrent connections

// Chunking engine constants
export const DEFAULT_MAX_CHUNK_LENGTH = 4000; // Maximum characters per chunk (PostgreSQL TEXT limit safe)
export const MIN_CHUNK_LENGTH = 100; // Minimum viable chunk size
export const DEFAULT_CHUNK_SIZE = 1000; // Default chunk size for extraction
export const DEFAULT_CHUNK_OVERLAP = 200; // Default chunk overlap for extraction

// Heading pattern for markdown H1-H3 detection
export const HEADING_PATTERN = /^(#{1,3})\s+(.+)$/;

// Database constants
export const CHUNK_INDEX_START = 0; // Starting index for chunk enumeration
export const DEFAULT_DB_PORT = 5432; // Default PostgreSQL port
export const DEFAULT_DB_NAME = 'docraider'; // Default database name
export const DEFAULT_DB_USER = 'postgres'; // Default database user
export const DEFAULT_POOL_MAX = 20; // Default connection pool max
export const DEFAULT_POOL_MIN = 5; // Default connection pool min

// Search constants
export const DEFAULT_SEARCH_LIMIT = 20; // Default number of search results
export const DEFAULT_SEARCH_OFFSET = 0; // Default offset for pagination
export const HEADLINE_MAX_WORDS = 50; // Max words in search headline highlight
export const HEADLINE_MIN_WORDS = 10; // Min words in search headline highlight
export const DEFAULT_MIN_SCORE = 0.1; // Default minimum search score
export const DEFAULT_FTS_LANGUAGE = 'simple'; // Default full-text search language (tsvector configuration)

// Crawler constants
export const DEFAULT_MAX_CONCURRENT = 5; // Default concurrent page crawls
export const DEFAULT_PAGE_TIMEOUT_MS = 30000; // Default page load timeout (ms)
export const DEFAULT_CONTENT_WAIT_TIMEOUT_MS = 5000; // Default timeout for waiting main content (ms)
export const MEMORY_LOG_INTERVAL = 50; // Log memory every N pages during crawl
export const DEFAULT_MAX_CRAWL_PAGES = 100; // Default max pages to crawl
export const DEFAULT_CRAWL_MAX_DEPTH = 3; // Default max crawl depth
export const DEFAULT_CRAWLER_MAX_RETRIES = 3; // Default max retry attempts
export const DEFAULT_CRAWLER_USER_AGENT = 'Docraider-MCP/1.0'; // Default crawler user agent
export const DEFAULT_CRAWLER_DELAY_MIN_MS = 1000; // Default minimum delay between requests (ms)
export const DEFAULT_CRAWLER_DELAY_MAX_MS = 3000; // Default maximum delay between requests (ms)
export const DEFAULT_BACKOFF_INITIAL_MS = 1000; // Default initial backoff delay (ms)
export const DEFAULT_BACKOFF_MAX_MS = 30000; // Default maximum backoff delay (ms)
export const DEFAULT_BACKOFF_MULTIPLIER = 2; // Default backoff multiplier

// Connection manager constants
export const DEFAULT_CONNECTION_TIMEOUT_MS = 30000; // Default connection timeout (ms)

// MCP error codes
export const MCP_CONNECTION_LIMIT_ERROR = -32000; // JSON-RPC error code for connection limit exceeded

// Pagination constants
export const DEFAULT_PAGE_LIMIT = 20; // Default pagination limit
export const MAX_PAGE_LIMIT = 100; // Maximum pagination limit

// Site identification constants
export const DOC_ROOT_PATHS = ['docs', 'documentation', 'doc', 'api', 'guide', 'manual']; // Common documentation path segments

// Search mode constants
export const SEARCH_MODES = ['keyword', 'semantic', 'hybrid'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];
export const DEFAULT_SEARCH_MODE = 'hybrid' as const;

// RRF (Reciprocal Rank Fusion) constants
export const RRF_K = 60; // RRF constant (k=60 is standard)

// Embedding constants
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536; // Default embedding dimensions (OpenAI text-embedding-3-small)
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16; // Default batch size for embedding generation
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30000; // Default timeout for embedding API (ms)

// Embedding status constants
export const EMBEDDING_STATUSES = ['pending', 'completed', 'failed'] as const;
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number];