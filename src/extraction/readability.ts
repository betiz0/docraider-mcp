import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { ReadabilityResult, ExtractionError } from './types.js';

// Minimum content length threshold for valid extraction
const MIN_CONTENT_LENGTH = 100;

/**
 * Extracts main content from HTML using Mozilla Readability
 */
export function extractWithReadability(
  html: string,
  url: string = 'about:blank'
): ReadabilityResult | ExtractionError {
  let dom: JSDOM | undefined;

  try {
    // Create JSDOM instance with the HTML content
    dom = new JSDOM(html, {
      url,
      contentType: 'text/html',
    });

    const document = dom.window.document;

    // Run Readability on the document
    const reader = new Readability(document);
    const article = reader.parse();

    // Check if parsing failed
    if (!article) {
      return {
        code: 'PARSE_ERROR',
        message: 'Readability failed to parse the document',
      };
    }

    // Validate extracted content
    const validationError = validateArticle(article);
    if (validationError) {
      return validationError;
    }

    // Return successful result
    const result: ReadabilityResult = {
      title: article.title || '',
      content: article.content || '',
      textContent: article.textContent || '',
      length: article.length || 0,
      excerpt: article.excerpt || '',
      byline: article.byline || '',
      dir: article.dir || '',
      siteName: article.siteName || '',
      lang: article.lang || '',
    };

    return result;
  } catch (error) {
    return {
      code: 'PARSE_ERROR',
      message: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  } finally {
    // Clean up JSDOM window to prevent memory leaks
    if (dom) {
      dom.window.close();
    }
  }
}

/**
 * Validates the extracted article and returns an error if invalid
 */
function validateArticle(
  article: { title?: string; content?: string; length?: number }
): ExtractionError | null {
  // Check for empty/null content
  if (!article.content || article.content.trim() === '') {
    return {
      code: 'EMPTY_CONTENT',
      message: 'Extracted content is empty or null',
    };
  }

  // Check minimum content length
  if ((article.length ?? 0) < MIN_CONTENT_LENGTH) {
    return {
      code: 'CONTENT_TOO_SHORT',
      message: `Content length ${article.length} is below minimum threshold of ${MIN_CONTENT_LENGTH}`,
    };
  }

  // Check for empty title
  if (!article.title || article.title.trim() === '') {
    return {
      code: 'NO_TITLE',
      message: 'Extracted article has no title',
    };
  }

  return null;
}