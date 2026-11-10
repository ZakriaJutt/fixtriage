// Creates the application role once: NOSUPERUSER NOBYPASSRLS, login without password (local trust auth only).
import pg from 'pg';
import { APP_ROLE, ownerUrl } from '../src/local-env';

const c = new pg.Client({ connectionString: ownerUrl('dev') });
await c.connect();
const exists = (await c.query('select 1 from pg_roles where rolname = $1', [APP_ROLE])).rowCount;
if (!exists) await c.query(`create role ${APP_ROLE} login nosuperuser nobypassrls nocreatedb nocreaterole`);
const r = await c.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [APP_ROLE]);
await c.end();
if (r.rows[0].rolsuper || r.rows[0].rolbypassrls) throw new Error(`${APP_ROLE} must not be superuser or bypass RLS`);
console.log(`${APP_ROLE}: ${exists ? 'exists' : 'created'}; superuser=false bypassrls=false`);
