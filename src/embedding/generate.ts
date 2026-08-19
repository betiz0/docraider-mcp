/**
 * Embedding generation service
 * Generates embeddings for chunks and upserts them into chunks_embedding table
 * Updates document_chunks.embedding_status on completion/failure
 */

import { db } from '../db/index.js';
import { generateEmbeddings } from './client.js';
import { config } from '../config.js';

export interface EmbeddingResult {
  chunkId: string;
  success: boolean;
  error?: string;
}

/**
 * Generate embeddings for an array of chunks and upsert into chunks_embedding
 * @param chunks - Array of { chunkId, content } to embed
 * @returns Array of EmbeddingResult with success/failure per chunk
 */
export async function generateAndUpsertEmbeddings(
  chunks: Array<{ chunkId: string; content: string }>
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  if (chunks.length === 0) {
    return results;
  }

  const chunkIds = chunks.map((c) => c.chunkId);
  const contents = chunks.map((c) => c.content);

  try {
    const embeddings = await generateEmbeddings(contents);

    // Upsert each embedding into chunks_embedding
    await db.transaction(async (client) => {
      for (let i = 0; i < embeddings.length; i++) {
        const embedding = embeddings[i];
        const chunkId = chunkIds[i];
        const modelVersion = `${config.embedding.model}-${config.embedding.dimensions}`;

        await client.query(
          `INSERT INTO chunks_embedding (chunk_id, embedding, model_version)
           VALUES ($1, $2, $3)
           ON CONFLICT (chunk_id, model_version)
           DO UPDATE SET embedding = EXCLUDED.embedding, created_at = NOW()`,
          [chunkId, JSON.stringify(embedding.embedding), modelVersion]
        );
      }

      // Update embedding_status to 'completed' for all chunks
      const placeholders = chunkIds.map((_, i) => `$${i + 2}`).join(', ');
      await client.query(
        `UPDATE document_chunks
         SET embedding_status = 'completed',
             embedding_attempts = embedding_attempts + 1,
             embedding_model = $1,
             embedding_updated_at = NOW()
         WHERE id IN (${placeholders})`,
        [config.embedding.model, ...chunkIds]
      );
    });

    for (const chunkId of chunkIds) {
      results.push({ chunkId, success: true });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark all chunks as failed, but keep existing vectors
    await db.transaction(async (client) => {
      const placeholders = chunkIds.map((_, i) => `$${i + 2}`).join(', ');
      await client.query(
        `UPDATE document_chunks
         SET embedding_status = 'failed',
             embedding_attempts = embedding_attempts + 1,
             embedding_error = $1,
             embedding_updated_at = NOW()
         WHERE id IN (${placeholders})`,
        [errorMessage, ...chunkIds]
      );
    });

    for (const chunkId of chunkIds) {
      results.push({ chunkId, success: false, error: errorMessage });
    }
  }

  return results;
}
