import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../../src/utils/url-normalize.js';

describe('normalizeUrl', () => {
  it('removes trailing slashes except for root', () => {
    expect(normalizeUrl('https://example.com/docs/')).toBe('https://example.com/docs');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('normalizes query parameter order', () => {
    expect(normalizeUrl('https://example.com/page?z=1&a=2')).toBe('https://example.com/page?a=2&z=1');
    expect(normalizeUrl('https://example.com/page?b=2&a=1')).toBe('https://example.com/page?a=1&b=2');
  });

  it('normalizes case (lowercase scheme, host, path)', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Docs/Page')).toBe('https://example.com/docs/page');
    expect(normalizeUrl('http://EXAMPLE.COM/page')).toBe('http://example.com/page');
  });

  it('removes default ports', () => {
    expect(normalizeUrl('http://example.com:80/page')).toBe('http://example.com/page');
    expect(normalizeUrl('https://example.com:443/page')).toBe('https://example.com/page');
  });

  it('removes fragment identifiers', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    expect(normalizeUrl('https://example.com/page#top')).toBe('https://example.com/page');
  });

  it('handles non-default ports correctly', () => {
    expect(normalizeUrl('http://example.com:8080/page')).toBe('http://example.com:8080/page');
    expect(normalizeUrl('https://example.com:8443/page')).toBe('https://example.com:8443/page');
  });

  it('handles multiple query parameters with same key', () => {
    const result = normalizeUrl('https://example.com/page?b=2&a=1&b=3');
    // Query params should be sorted by key, with duplicate keys preserved
    expect(result).toContain('a=1');
    expect(result).toContain('b=2');
    expect(result).toContain('b=3');
    // a should come before b
    expect(result.indexOf('a=1')).toBeLessThan(result.indexOf('b=2'));
  });

  it('handles invalid URLs gracefully', () => {
    expect(normalizeUrl('not-a-valid-url')).toBe('not-a-valid-url');
  });

  it('normalizes mixed trailing slash and query params', () => {
    expect(normalizeUrl('https://example.com/docs/?page=2&lang=en')).toBe('https://example.com/docs?lang=en&page=2');
  });
});
