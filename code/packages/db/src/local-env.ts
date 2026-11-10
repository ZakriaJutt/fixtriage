// Local database URLs for scripts and tests (DEV-GUIDE: role fixtriage_app, databases fixtriage_dev / fixtriage_test).
export const OWNER = process.env.PGOWNER ?? process.env.USER ?? 'zakria';
export const HOST = process.env.PGHOST ?? 'localhost';
export const PORT = process.env.PGPORT ?? '5432';
export const APP_ROLE = 'fixtriage_app';
export const dbName = (which: 'dev' | 'test') => `fixtriage_${which}`;
export const ownerUrl = (which: 'dev' | 'test') => process.env.MIGRATION_DATABASE_URL ?? `postgres://${OWNER}@${HOST}:${PORT}/${dbName(which)}`;
export const appUrl = (which: 'dev' | 'test') => process.env.DATABASE_URL ?? `postgres://${APP_ROLE}@${HOST}:${PORT}/${dbName(which)}`;
export const target = (): 'dev' | 'test' => (process.argv.includes('--test') || process.env.NODE_ENV === 'test' ? 'test' : 'dev');
