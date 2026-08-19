import { db } from './db/index.js';
import { config } from './config.js';
import { DEFAULT_MAX_CHUNK_LENGTH, HEADING_PATTERN, CHUNK_INDEX_START, DEFAULT_FTS_LANGUAGE } from './constants/index.js';
import type { DocumentChunk } from './db/types.js';

/**
 * Result of chunking a markdown document
 */
export interface ChunkResult {
  content: string;
  headingPath: string[];
  chunkIndex: number;
}

/**
 * Chunk a markdown document into semantically meaningful segments
 * @param markdown - The markdown content to chunk
 * @param maxLength - Maximum characters per chunk (default: 4000)
 * @returns Array of chunk results with heading paths
 */
export function chunkMarkdown(markdown: string, maxLength = DEFAULT_MAX_CHUNK_LENGTH): ChunkResult[] {
  const lines = markdown.split('\n');
  const chunks: ChunkResult[] = [];
  const headingStack: string[] = [];
  let currentChunk = '';
  let chunkIndex = CHUNK_INDEX_START;

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);

    if (headingMatch) {
      // Flush current chunk before processing heading
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          headingPath: [...headingStack],
          chunkIndex: chunkIndex++,
        });
        currentChunk = '';
      }

      // Update heading stack based on heading level
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // Keep only headings at or above current level
      headingStack.length = level - 1;
      headingStack.push(title);
    }

    // Add line to current chunk
    currentChunk += line + '\n';

    // Check if chunk exceeds max length
    if (currentChunk.length >= maxLength) {
      // Try to split at paragraph boundary (empty line)
      const lastEmptyLine = currentChunk.lastIndexOf('\n\n');
      const splitPoint = lastEmptyLine > maxLength * 0.5 ? lastEmptyLine : currentChunk.length;

      const chunkContent = currentChunk.substring(0, splitPoint).trim();
      if (chunkContent) {
        chunks.push({
          content: chunkContent,
          headingPath: [...headingStack],
          chunkIndex: chunkIndex++,
        });
      }
      currentChunk = currentChunk.substring(splitPoint).trimStart();
    }
  }

  // Flush remaining content
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      headingPath: [...headingStack],
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

/**
 * Save chunks to database in a transaction
 * @param documentId - The document ID to associate chunks with
 * @param chunks - Array of chunk results to save
 */
export async function saveChunks(documentId: string, chunks: ChunkResult[]): Promise<void> {
  const language = config.search.language || DEFAULT_FTS_LANGUAGE;
  await db.transaction(async (client) => {
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, heading_path, search_vector)
         VALUES ($1, $2, $3, $4, to_tsvector($5, $3))`,
        [documentId, chunks[i].chunkIndex, chunks[i].content, chunks[i].headingPath, language]
      );
    }
  });
}

/**
 * Replace all chunks for a document (delete old, insert new)
 * @param documentId - The document ID
 * @param chunks - New chunks to save
 */
export async function replaceChunks(documentId: string, chunks: ChunkResult[]): Promise<void> {
  const language = config.search.language || DEFAULT_FTS_LANGUAGE;
  await db.transaction(async (client) => {
    // Delete existing chunks
    await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);

    // Insert new chunks
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, heading_path, search_vector)
         VALUES ($1, $2, $3, $4, to_tsvector($5, $3))`,
        [documentId, chunk.chunkIndex, chunk.content, chunk.headingPath, language]
      );
    }
  });
}

/**
 * Get chunks by document ID
 * @param documentId - The document ID
 * @returns Array of document chunks
 */
export async function getChunksByDocumentId(documentId: string): Promise<DocumentChunk[]> {
  return db.query<DocumentChunk>(
    'SELECT * FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index',
    [documentId]
  );
}