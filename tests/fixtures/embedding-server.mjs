import { createServer } from 'node:http';

const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);

function embeddingFor(text) {
  const vector = Array(dimensions).fill(0);
  const normalized = String(text).toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    vector[normalized.charCodeAt(i) % dimensions] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
    response.writeHead(404).end();
    return;
  }

  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const input = Array.isArray(payload.input) ? payload.input : [payload.input];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        object: 'list',
        model: payload.model,
        data: input.map((text, index) => ({ object: 'embedding', index, embedding: embeddingFor(text) })),
      }));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'invalid request' } }));
    }
  });
}).listen(11434, '0.0.0.0');
