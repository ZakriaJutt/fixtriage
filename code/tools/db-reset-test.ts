// Drops every object in fixtriage_test's public schema and re-migrates from empty (DEV-GUIDE quality loop).
import pg from 'pg';
import { APP_ROLE, ownerUrl } from '@fixtriage/db';
import { migrate } from '@fixtriage/db/migrate';
import { seedRuleSets } from '@fixtriage/services';

const url = ownerUrl('test');
if (!url.endsWith('/fixtriage_test')) throw new Error('reset-test only runs against fixtriage_test');
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(`drop schema public cascade; create schema public; grant usage on schema public to ${APP_ROLE}`);
await c.end();
const r = await migrate(url);
await seedRuleSets(url);
console.log(`fixtriage_test reset: applied ${r.applied.join(', ')}`);
