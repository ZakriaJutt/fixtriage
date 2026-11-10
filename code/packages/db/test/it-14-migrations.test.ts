// IT-14 (B1 part): empty database -> migrate -> ORM diff empty; re-run is a no-op; an edited applied migration is
// refused; conflicting migration parents fail the order check. The backfill case is not run (no backfill exists in B1).
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { ownerUrl, APP_ROLE } from '@fixtriage/db';
import { checkJournalOrder, migrate, ormDiff } from '@fixtriage/db/migrate';
import { seedRuleSets } from '@fixtriage/services';

const url = ownerUrl('test');

describe('IT-14 migrations', () => {
  it('migrates an empty database cleanly with an empty ORM diff, and a second run applies nothing', async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query(`drop schema public cascade; create schema public; grant usage on schema public to ${APP_ROLE}`);
    await c.end();
    const first = await migrate(url);
    expect(first.applied).toEqual(['0000_tables', '0001_rls_functions_views_grants']);
    await seedRuleSets(url);
    expect(await ormDiff(url)).toEqual([]);
    const second = await migrate(url);
    expect(second).toEqual({ applied: [], skipped: ['0000_tables', '0001_rls_functions_views_grants'] });
  });
  it('refuses to continue when an applied migration file was edited', async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query(`update schema_migrations set checksum = 'edited' where filename = '0000_tables'`);
    await c.end();
    await expect(migrate(url)).rejects.toThrow(/edited after it ran/);
    const c2 = new pg.Client({ connectionString: url });
    await c2.connect();
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../migrations/0000_tables.sql', import.meta.url), 'utf8');
    await c2.query(`update schema_migrations set checksum = $1 where filename = '0000_tables'`, [createHash('sha256').update(text).digest('hex')]);
    await c2.end();
  });
  it('two branches adding the same next migration fail the order check', () => {
    expect(() => checkJournalOrder([{ idx: 0, tag: '0000_tables' }, { idx: 1, tag: '0001_a' }, { idx: 1, tag: '0001_b' }])).toThrow(/order broken/);
    expect(checkJournalOrder([{ idx: 1, tag: '0001_x' }, { idx: 0, tag: '0000_y' }])).toEqual(['0000_y', '0001_x']);
  });
});
