import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ReadabilityResult, ExtractionError, PipelineResult, ExtractionProfile } from './types.js';
import { extractWithReadability } from './readability.js';
import { extractWithCheerio } from './cheerio-extractor.js';

type ExtractionResult = ReadabilityResult | ExtractionError;

// Singleton TurndownService instance with GFM plugin
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Apply GFM plugin for tables, strikethrough, task lists
gfm(turndownService);

// Custom rule for code blocks with language class detection
turndownService.addRule('codeBlockWithLanguage', {
  filter: function (node): boolean {
    return (
      node.nodeName === 'PRE' &&
      node.firstChild !== null &&
      (node.firstChild as Element).nodeName === 'CODE'
    );
  },
  replacement: function (content, node) {
    const codeElement = (node as Element).firstChild as Element;
    const languageClass = codeElement?.className || '';
    // Extract language from class like "language-javascript" or "lang-python"
    const langMatch = languageClass.match(/(?:language|lang)-(\w+)/);
    const language = langMatch ? langMatch[1] : '';
    return '\n\n```' + language + '\n' + content + '\n```\n\n';
  },
});

/**
 * Extracts content from HTML using a primary (Readability) -> fallback (cheerio) pipeline
 * and converts the result to Markdown format.
 */
export function extractContent(
  html: string,
  url: string,
  profile?: ExtractionProfile
): PipelineResult | ExtractionError {
  // Step 1: Try Readability extraction
  const readabilityResult = extractWithReadability(html, url);

  if (isReadabilityResult(readabilityResult)) {
    // Success with Readability
    return createPipelineResult(readabilityResult, 'readability');
  }

  // Step 2: Fallback to cheerio extraction
  const cheerioResult = extractWithCheerio(html, url);

  if (isReadabilityResult(cheerioResult)) {
    // Success with cheerio
    return createPipelineResult(cheerioResult, 'cheerio');
  }

  // Both methods failed - return the error
  return cheerioResult;
}

/**
 * Type guard to check if result is a successful ReadabilityResult
 */
function isReadabilityResult(result: ExtractionResult): result is ReadabilityResult {
  return 'content' in result && !('code' in result);
}

/**
 * Creates a PipelineResult from a successful extraction result
 */
function createPipelineResult(
  result: ReadabilityResult,
  source: 'readability' | 'cheerio'
): PipelineResult {
  const markdown = turndownService.turndown(result.content);

  return {
    title: result.title,
    markdown,
    textContent: result.textContent,
    length: result.length,
    excerpt: result.excerpt,
    lang: result.lang,
    source,
  };
}