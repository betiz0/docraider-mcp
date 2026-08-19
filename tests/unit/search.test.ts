import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  keywordSearch: vi.fn(),
  semanticSearch: vi.fn(),
  fuseResults: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../../src/search/keyword.js', () => ({ keywordSearch: mocks.keywordSearch }));
vi.mock('../../src/search/semantic.js', () => ({ semanticSearch: mocks.semanticSearch }));
vi.mock('../../src/search/fusion.js', () => ({ fuseResults: mocks.fuseResults }));
vi.mock('../../src/db/index.js', () => ({ db: { query: mocks.query } }));

import { getSearchCount, searchDocuments } from '../../src/search.js';

const keywordResult = {
  chunkId: 'chunk-keyword',
  documentId: 'doc-1',
  url: 'https://example.com/docs',
  title: 'Keyword result',
  content: 'test content',
  headingPath: ['Intro'],
  score: 0.8,
  highlight: '<mark>test</mark> content',
};

const semanticResult = {
  chunkId: 'chunk-semantic',
  documentId: 'doc-2',
  url: 'https://example.com/semantic',
  title: 'Semantic result',
  content: 'related content',
  headingPath: [],
  similarity: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keywordSearch.mockResolvedValue([keywordResult]);
  mocks.semanticSearch.mockResolvedValue([semanticResult]);
  mocks.fuseResults.mockReturnValue([
    { ...keywordResult, matchType: 'keyword', score: 1 / 61 },
    { ...semanticResult, matchType: 'semantic', score: 1 / 62 },
  ]);
});

describe('searchDocuments', () => {
  it('defaults to hybrid and fuses keyword and semantic candidates', async () => {
    const results = await searchDocuments({ query: 'test' });

    expect(mocks.keywordSearch).toHaveBeenCalledWith({ query: 'test', limit: 20, offset: 0, siteId: undefined });
    expect(mocks.semanticSearch).toHaveBeenCalledWith({ query: 'test', limit: 20, offset: 0, siteId: undefined });
    expect(mocks.fuseResults).toHaveBeenCalledWith([keywordResult], [semanticResult]);
    expect(results).toHaveLength(2);
  });

  it('runs keyword mode and maps the result contract', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'keyword', siteId: 'site-1' });

    expect(mocks.keywordSearch).toHaveBeenCalledWith({ query: 'test', limit: 20, offset: 0, siteId: 'site-1' });
    expect(mocks.semanticSearch).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ chunkId: 'chunk-keyword', matchType: 'keyword', score: 0.8 });
  });

  it('runs semantic mode and maps similarity to score', async () => {
    const results = await searchDocuments({ query: 'test', mode: 'semantic' });

    expect(results[0]).toMatchObject({ chunkId: 'chunk-semantic', matchType: 'semantic', score: 0.9 });
  });

  it('clamps limit and negative offset', async () => {
    await searchDocuments({ query: 'test', mode: 'keyword', limit: 500, offset: -4 });
    expect(mocks.keywordSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 }));
  });

  it('applies offset after fusion without double pagination', async () => {
    await searchDocuments({ query: 'test', mode: 'hybrid', limit: 5, offset: 5 });

    expect(mocks.keywordSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
    expect(mocks.semanticSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  it('falls back to keyword results when semantic search fails', async () => {
    mocks.semanticSearch.mockRejectedValue(new Error('embedding endpoint unavailable'));

    const results = await searchDocuments({ query: 'test', mode: 'hybrid' });
    expect(results).toHaveLength(1);
    expect(results[0].matchType).toBe('keyword');
  });

  it('returns an empty semantic result instead of propagating an embedding error', async () => {
    mocks.semanticSearch.mockRejectedValue(new Error('no embeddings'));
    await expect(searchDocuments({ query: 'test', mode: 'semantic' })).resolves.toEqual([]);
  });

  it('rejects an invalid mode', async () => {
    await expect(searchDocuments({ query: 'test', mode: 'fuzzy' as never })).rejects.toThrow('Invalid search mode');
  });
});

describe('getSearchCount', () => {
  it('counts keyword matches without a site filter', async () => {
    mocks.query.mockResolvedValue([{ count: '42' }]);
    await expect(getSearchCount('test')).resolves.toBe(42);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('dc.content &@~ $1'), ['test']);
  });

  it('counts keyword matches with a site filter', async () => {
    mocks.query.mockResolvedValue([{ count: '7' }]);
    await expect(getSearchCount('test', 'hybrid', 'site-1')).resolves.toBe(7);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('dc.content &@~ $2'), ['site-1', 'test']);
    expect(mocks.query.mock.calls[0][0]).toContain('AND d.site_id = $1');
  });

  it('returns zero when no count row is returned', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(getSearchCount('missing')).resolves.toBe(0);
  });
});
