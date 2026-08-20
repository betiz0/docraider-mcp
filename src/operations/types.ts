/** Transport-independent operation contracts shared by MCP and CLI adapters. */
export type OperationName =
  | 'page.read' | 'crawl.site' | 'crawl.pages' | 'search'
  | 'document.get' | 'document.list' | 'stats'
  | 'site.list' | 'site.get' | 'site.delete'
  | 'embedding.backfill' | 'embedding.status';

export type ErrorKind = 'input' | 'not_found' | 'config' | 'database' | 'external_service' | 'unexpected';

export class OperationError extends Error {
  constructor(public readonly kind: ErrorKind, public readonly code: string, message: string, public readonly details?: unknown, options?: ErrorOptions) {
    super(message, options); this.name = 'OperationError';
  }
}

export interface OperationResult<T> { data: T; warnings: string[] }
export interface OperationContext { log?: (message: string) => void }
export const MCP_OPERATION_MAP = {
  read_and_extract_page: 'page.read', crawl_documentation_site: 'crawl.site',
  crawl_component_docs: 'crawl.pages', search_crawled_docs: 'search',
  get_document: 'document.get', list_documents: 'document.list', get_index_stats: 'stats',
  list_sites: 'site.list', get_site: 'site.get', delete_site: 'site.delete',
  backfill_embeddings: 'embedding.backfill', get_backfill_status: 'embedding.status',
} as const satisfies Record<string, OperationName>;

export const CLI_OPERATION_MAP = {
  'page read':'page.read','crawl site':'crawl.site','crawl pages':'crawl.pages',search:'search',
  'document get':'document.get','document list':'document.list',stats:'stats','site list':'site.list',
  'site get':'site.get','site delete':'site.delete','embedding backfill':'embedding.backfill',
  'embedding status':'embedding.status',
} as const satisfies Record<string, OperationName>;
