import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL from the schema; migrations are applied by scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  strict: true,
});
