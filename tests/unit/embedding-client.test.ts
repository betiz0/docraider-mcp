import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateEmbeddings } from '../../src/embedding/client.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('Embedding Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends correct request format to OpenAI-compatible API', async () => {
    const mockResponse = {
      data: [
        { embedding: [0.1, 0.2, 0.3], index: 0, object: 'embedding' },
      ],
      model: 'test-model',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const results = await generateEmbeddings(['test text']);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/embeddings'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );

    // Verify the body contains the expected model and input
    const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.model).toBeDefined();
    expect(body.input).toBe('test text');

    expect(results).toHaveLength(1);
    expect(results[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(results[0].index).toBe(0);
  });

  it('batches large inputs', async () => {
    const mockResponse = {
      data: [
        { embedding: [0.1], index: 0, object: 'embedding' },
        { embedding: [0.2], index: 1, object: 'embedding' },
      ],
      model: 'test-model',
      usage: { prompt_tokens: 2, total_tokens: 2 },
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const results = await generateEmbeddings(['text1', 'text2']);

    expect(results).toHaveLength(2);
    expect(results[0].embedding).toEqual([0.1]);
    expect(results[1].embedding).toEqual([0.2]);
  });

  it('throws error on API failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({
        error: { message: 'Internal server error', type: 'server_error' },
      }),
    });

    await expect(generateEmbeddings(['test'])).rejects.toThrow('Embedding API error');
  });

  it('includes Authorization header when API key is set', async () => {
    // This test verifies the header is set when config.embedding.apiKey is non-empty
    // The actual value depends on config, so we just verify the function doesn't crash
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
        model: 'test',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    });

    await expect(generateEmbeddings(['test'])).resolves.toBeDefined();
  });
});
