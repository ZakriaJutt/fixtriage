// Migration runner (schema.md 9): one linear sequence from migrations/meta/_journal.json; each file in one transaction
// with lock_timeout 3 s and statement_timeout 30 s; applied files and their checksums recorded in schema_migrations.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export function migrationFiles(): string[] {
  const journal = JSON.parse(readFileSync(`${DIR}meta/_journal.json`, 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  return checkJournalOrder(journal.entries);
}

/** One linear sequence (R-10): indexes 0..n-1, each used once, tags prefixed with their index. Two branches that both add migration n fail here. */
export function checkJournalOrder(entries: Array<{ idx: number; tag: string }>): string[] {
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  sorted.forEach((e, i) => {
    if (e.idx !== i || !e.tag.startsWith(String(i).padStart(4, '0') + '_')) throw new Error(`migration order broken at ${e.tag}`);
  });
  return sorted.map((e) => e.tag);
}

export async function migrate(ownerUrl: string): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    // Extensions are environment setup, not schema: citext columns, btree_gist for the on-call exclusion constraint.
    await client.query('create extension if not exists citext; create extension if not exists btree_gist; create extension if not exists pgcrypto;');
    await client.query('create table if not exists schema_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())');
    const done = new Map<string, string>((await client.query('select filename, checksum from schema_migrations')).rows.map((r) => [r.filename, r.checksum]));
    for (const tag of migrationFiles()) {
      const text = readFileSync(`${DIR}${tag}.sql`, 'utf8');
      const checksum = createHash('sha256').update(text).digest('hex');
      if (done.has(tag)) {
        if (done.get(tag) !== checksum) throw new Error(`applied migration ${tag} was edited after it ran`);
        result.skipped.push(tag);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(`set local lock_timeout = '3s'; set local statement_timeout = '30s'`);
        for (const stmt of text.split('--> statement-breakpoint')) if (stmt.trim()) await client.query(stmt);
        await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [tag, checksum]);
        await client.query('commit');
        result.applied.push(tag);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
  return result;
}
