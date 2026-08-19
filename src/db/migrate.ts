import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

function globSync(dir: string): string[] {
  const files = readdirSync(dir);
  const matchedFiles = files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => resolve(dir, f));
  return matchedFiles;
}

async function runMigrations(): Promise<void> {
  const files = globSync(MIGRATIONS_DIR).sort();

  if (files.length === 0) {
    console.log('No migrations found');
    await db.disconnect();
    return;
  }

  // Test connection first
  await db.query(`SELECT 1`);

  for (const file of files) {
    const sql = readFileSync(file, 'utf-8');
    const filename = file.split('/').pop() ?? 'unknown';
    console.log(`Running migration: ${filename}`);

    try {
      await db.transaction(async (client) => {
        await client.query(sql);
      });
      console.log(`✓ Migration ${filename} completed`);
    } catch (err) {
      console.error(`✗ Migration ${filename} failed:`, err);
      throw err;
    }
  }

  console.log('All migrations completed successfully');
  await db.disconnect();
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});