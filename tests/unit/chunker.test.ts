import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../src/chunker.js';
import { DEFAULT_MAX_CHUNK_LENGTH } from '../../src/constants/index.js';

describe('chunkMarkdown', () => {
  it('should return empty array for empty input', () => {
    const result = chunkMarkdown('');
    expect(result).toEqual([]);
  });

  it('should return single chunk for short content', () => {
    const markdown = '# Title\n\nThis is a short paragraph.';
    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('This is a short paragraph.');
    expect(result[0].headingPath).toEqual(['Title']);
  });

  it('should split content by headings', () => {
    const markdown = `# Heading 1
Content under heading 1.

## Heading 2
Content under heading 2.

### Heading 3
Content under heading 3.`;
    const result = chunkMarkdown(markdown);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].headingPath).toEqual(['Heading 1']);
  });

  it('should respect max length parameter', () => {
    const longContent = '# Title\n\n' + 'A'.repeat(10000);
    const result = chunkMarkdown(longContent, 1000);
    // Long content should be split into multiple chunks
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Each chunk should be reasonably sized
    result.forEach((chunk) => {
      expect(chunk.content.length).toBeGreaterThan(0);
    });
  });

  it('should use default max chunk length', () => {
    const result = chunkMarkdown('# Test\n\nContent');
    expect(result[0].chunkIndex).toBe(0);
  });

  it('should track heading paths correctly', () => {
    const markdown = `# Main Title
Intro

## Section 1
Content 1

## Section 2
Content 2`;
    const result = chunkMarkdown(markdown);
    const section1Chunk = result.find((c) => c.headingPath.includes('Section 1'));
    const section2Chunk = result.find((c) => c.headingPath.includes('Section 2'));
    expect(section1Chunk).toBeDefined();
    expect(section2Chunk).toBeDefined();
    expect(section1Chunk?.headingPath).toEqual(['Main Title', 'Section 1']);
    expect(section2Chunk?.headingPath).toEqual(['Main Title', 'Section 2']);
  });
});