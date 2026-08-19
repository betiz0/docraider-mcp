import * as cheerio from 'cheerio';
import type { ReadabilityResult, ExtractionError } from './types.js';

// Minimum content length threshold for valid extraction
const MIN_CONTENT_LENGTH = 100;

// Semantic selectors for main content (in priority order)
const MAIN_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '.content',
  '.documentation',
  '.doc-content',
  '.documentation-body',
  '.docs-content',
  '.article-content',
  '[data-testid="content"]',
  '[data-testid="doc-content"]',
  '[data-documentation-content]',
];

// Elements to remove (navigation, scripts, styles, etc.)
const REMOVAL_SELECTORS = [
  'nav',
  'sidebar',
  'footer',
  'script',
  'style',
  'aside',
  '.sidebar',
  '.navigation',
  '.nav',
  '.menu',
  '.advertisement',
  '.ads',
  '.cookie-banner',
  '.newsletter-signup',
];

/**
 * Extracts main content from HTML using cheerio as a fallback method
 */
export function extractWithCheerio(
  html: string,
  url: string = 'about:blank'
): ReadabilityResult | ExtractionError {
  try {
    const $ = cheerio.load(html);

    // Remove unwanted elements first
    removeUnwantedElements($);

    // Try to find main content using semantic selectors
    const mainContent = findMainContent($);

    if (!mainContent) {
      return {
        code: 'PARSE_ERROR',
        message: 'Could not find main content element in document',
      };
    }

    // Extract title
    const title = $('title').first().text() || $('h1').first().text() || '';

    // Get content HTML
    const contentHtml = mainContent.html() || '';

    // Get text content
    const textContent = mainContent.text();

    // Validate content length
    if (textContent.trim().length < MIN_CONTENT_LENGTH) {
      return {
        code: 'CONTENT_TOO_SHORT',
        message: `Content length ${textContent.trim().length} is below minimum threshold of ${MIN_CONTENT_LENGTH}`,
      };
    }

    // Return successful result
    const result: ReadabilityResult = {
      title,
      content: contentHtml,
      textContent,
      length: textContent.length,
      excerpt: textContent.substring(0, 200).trim(),
      byline: '',
      dir: $('html').attr('dir') || '',
      siteName: '',
      lang: $('html').attr('lang') || '',
    };

    return result;
  } catch (error) {
    return {
      code: 'PARSE_ERROR',
      message: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Removes unwanted elements from the document
 */
function removeUnwantedElements($: cheerio.CheerioAPI): void {
  for (const selector of REMOVAL_SELECTORS) {
    $(selector).remove();
  }
}

/**
 * Finds the main content element using semantic selectors
 */
function findMainContent($: cheerio.CheerioAPI): any {
  // Try each selector in priority order
  for (const selector of MAIN_SELECTORS) {
    const element = $(selector).first();
    if (element.length > 0) {
      // Check if element has substantial content
      const text = element.text().trim();
      if (text.length >= MIN_CONTENT_LENGTH) {
        return element;
      }
    }
  }

  // Fallback: return body if no semantic selector matched
  const body = $('body');
  if (body.length > 0) {
    return body;
  }

  return null;
}