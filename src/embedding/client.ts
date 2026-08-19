/**
 * OpenAI-compatible embedding client
 * Uses the standard /v1/embeddings endpoint
 * Supports both local (Ollama) and cloud (OpenAI) compatible APIs
 */

import { config } from '../config.js';
import { DEFAULT_EMBEDDING_TIMEOUT_MS } from '../constants/index.js';

export interface EmbeddingInput {
  text: string;
}

export interface EmbeddingOutput {
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingError {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

/**
 * Generate embeddings for a batch of text inputs
 * @param inputs - Array of text strings to embed
 * @returns Array of embeddings with original indices
 */
export async function generateEmbeddings(inputs: string[]): Promise<EmbeddingOutput[]> {
  const results: EmbeddingOutput[] = [];

  // Process in batches
  const batchSize = config.embedding.batchSize;
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const batchResults = await generateEmbeddingBatch(batch);
    results.push(...batchResults);
  }

  // Sort by original index
  results.sort((a, b) => a.index - b.index);
  return results;
}

/**
 * Generate embeddings for a single batch (within batch size limit)
 */
async function generateEmbeddingBatch(batch: string[]): Promise<EmbeddingOutput[]> {
  const timeoutMs = config.embedding.timeoutMs || DEFAULT_EMBEDDING_TIMEOUT_MS;

  const body = JSON.stringify({
    model: config.embedding.model,
    input: batch.length === 1 ? batch[0] : batch,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.embedding.apiKey) {
    headers['Authorization'] = `Bearer ${config.embedding.apiKey}`;
  }

  const response = await fetch(`${config.embedding.endpoint}/v1/embeddings`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Embedding API error: HTTP ${response.status}`;
    try {
      const errorBody = JSON.parse(errorText) as EmbeddingError;
      errorMessage = `Embedding API error: ${errorBody.error.message}`;
    } catch {
      errorMessage += ` - ${errorText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }

  const data = (await response.json()) as EmbeddingResponse;

  return data.data.map((item) => ({
    embedding: item.embedding,
    index: item.index,
  }));
}
