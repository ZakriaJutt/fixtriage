// check:migrations (execution-plan 8): linear migration order, drizzle-kit reports no pending schema change,
// and a migrated database has no diff against the ORM schema. Non-zero exit on any failure.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrationFiles, ormDiff } from '../src/migrate-entry';
import { ownerUrl, target } from '../src/local-env';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const tags = migrationFiles();
const before = new Set(readdirSync(dir));
const out = execFileSync('npx', ['drizzle-kit', 'generate', '--config', 'packages/db/drizzle.config.ts'], { encoding: 'utf8' });
const created = readdirSync(dir).filter((f) => !before.has(f));
for (const f of created) rmSync(dir + f);
const diffs = await ormDiff(ownerUrl(target()));
const pendingChange = !/No schema changes/i.test(out) || created.length > 0;
console.log(`migrations in order: ${tags.join(', ')}`);
console.log(`drizzle-kit pending schema change: ${pendingChange ? 'YES' : 'none'}`);
console.log(`ORM vs database diff: ${diffs.length ? diffs.join('\n  ') : 'empty'}`);
if (pendingChange || diffs.length) process.exit(1);
