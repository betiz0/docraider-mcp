export interface ReadabilityResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
}

export interface ExtractionError {
  code: 'EMPTY_CONTENT' | 'CONTENT_TOO_SHORT' | 'NO_TITLE' | 'PARSE_ERROR';
  message: string;
}

export type ExtractionResult = ReadabilityResult | ExtractionError;

/**
 * Profile for custom CSS selectors in extraction
 */
export interface ExtractionProfile {
  /** Custom CSS selector for main content (overrides default selectors) */
  contentSelector?: string;
  /** Custom CSS selectors to remove (e.g., navigation, ads) */
  removalSelectors?: string[];
}

/**
 * Result from the extraction pipeline with markdown output
 */
export interface PipelineResult {
  title: string;
  markdown: string;
  textContent: string;
  length: number;
  excerpt: string;
  lang: string;
  source: 'readability' | 'cheerio';
}