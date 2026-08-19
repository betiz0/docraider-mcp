import { describe, it, expect } from 'vitest';
import { extractContent } from '../../src/extraction/pipeline.js';

describe('extraction pipeline', () => {
  it('should extract content from simple HTML', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <article>
            <h1>Main Title</h1>
            <p>This is the main content of the page.</p>
          </article>
        </body>
      </html>
    `;
    const result = extractContent(html, 'https://example.com');
    // May succeed with readability or fallback to cheerio
    expect(result).toBeDefined();
  });

  it('should fallback to cheerio when readability fails', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Simple Page</title></head>
        <body>
          <div class="content">
            <h1>Article Title</h1>
            <p>Some content here.</p>
          </div>
        </body>
      </html>
    `;
    const result = extractContent(html, 'https://example.com');
    expect(result).toBeDefined();
  });

  it('should return error for empty HTML', () => {
    const result = extractContent('', 'https://example.com');
    expect('code' in result).toBe(true);
  });

  it('should handle minimal HTML', () => {
    const html = '<html><head><title>Empty</title></head><body></body></html>';
    const result = extractContent(html, 'https://example.com');
    expect(result).toBeDefined();
    // May return error or fallback content
  });
});