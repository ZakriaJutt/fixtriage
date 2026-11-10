// ORM-diff check (schema.md 9, R-08, IT-14): the Drizzle schema and a freshly migrated database must agree on
// tables, columns (type, nullability), indexes, constraints, policies, RLS flags and the custom objects.
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

const norm = (t: string) => t.replace(/\s+/g, '').replace(/^character varying/, 'varchar').toLowerCase();

export async function ormDiff(ownerUrl: string): Promise<string[]> {
  const diffs: string[] = [];
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const ormTables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));
    const dbTables = (await c.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`)).rows.map((r) => r.tablename as string);
    const ormNames = ormTables.map((t) => t.name);
    for (const t of dbTables) if (!ormNames.includes(t)) diffs.push(`table only in database: ${t}`);
    for (const t of ormTables) {
      if (!dbTables.includes(t.name)) {
        diffs.push(`table only in ORM: ${t.name}`);
        continue;
      }
      const cols = (await c.query(`select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped`, [t.name])).rows;
      for (const col of t.columns) {
        const d = cols.find((x) => x.attname === col.name);
        if (!d) diffs.push(`${t.name}.${col.name}: column only in ORM`);
        else {
          if (norm(d.type) !== norm(col.getSQLType())) diffs.push(`${t.name}.${col.name}: type ${d.type} vs ORM ${col.getSQLType()}`);
          if (d.attnotnull !== (col.notNull || col.primary)) diffs.push(`${t.name}.${col.name}: not null ${d.attnotnull} vs ORM ${col.notNull}`);
        }
      }
      for (const d of cols) if (!t.columns.some((x) => x.name === d.attname)) diffs.push(`${t.name}.${d.attname}: column only in database`);
      const ormIdx = t.indexes.map((i) => i.config.name!).sort();
      const ormCons = [...t.checks.map((x) => x.name), ...t.uniqueConstraints.map((x) => x.getName()!), ...t.foreignKeys.map((x) => x.getName()), ...t.columns.filter((x) => x.isUnique).map((x) => x.uniqueName!)];
      const ormFkCols = t.columns.filter((x) => x.primary).length ? [`${t.name}_pkey`] : [];
      const dbIdx = (await c.query(`select indexname from pg_indexes where tablename = $1 and indexname not in (select conname from pg_constraint where conrelid = $1::regclass)`, [t.name])).rows.map((r) => r.indexname as string).sort();
      const dbCons = (await c.query(`select conname from pg_constraint where conrelid = $1::regclass and contype <> 'n'`, [t.name])).rows.map((r) => r.conname as string);
      const custom = schema.CUSTOM_OBJECTS.constraints as readonly string[];
      for (const i of ormIdx) if (!dbIdx.includes(i)) diffs.push(`${t.name}: index only in ORM ${i}`);
      for (const i of dbIdx) if (!ormIdx.includes(i)) diffs.push(`${t.name}: index only in database ${i}`);
      const expectedCons = [...ormCons, ...ormFkCols];
      for (const k of expectedCons) if (!dbCons.includes(k)) diffs.push(`${t.name}: constraint only in ORM ${k}`);
      for (const k of dbCons) if (!expectedCons.includes(k) && !custom.includes(k)) diffs.push(`${t.name}: constraint only in database ${k}`);
      const ormPol = t.policies.map((p) => p.name).sort();
      const dbPol = (await c.query(`select policyname from pg_policies where tablename = $1`, [t.name])).rows.map((r) => r.policyname as string).sort();
      if (JSON.stringify(ormPol) !== JSON.stringify(dbPol)) diffs.push(`${t.name}: policies ${dbPol.join(',')} vs ORM ${ormPol.join(',')}`);
      const rls = (await c.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`, [t.name])).rows[0];
      const accountOwned = (schema.ACCOUNT_TABLES as readonly string[]).includes(t.name);
      if (rls.relrowsecurity !== accountOwned || rls.relforcerowsecurity !== accountOwned) diffs.push(`${t.name}: RLS enabled=${rls.relrowsecurity} forced=${rls.relforcerowsecurity}, expected ${accountOwned}`);
    }
    for (const k of schema.CUSTOM_OBJECTS.constraints) if (!(await c.query('select 1 from pg_constraint where conname = $1', [k])).rowCount) diffs.push(`missing constraint ${k}`);
    for (const k of schema.CUSTOM_OBJECTS.triggers) if (!(await c.query('select 1 from pg_trigger where tgname = $1', [k])).rowCount) diffs.push(`missing trigger ${k}`);
    for (const k of schema.CUSTOM_OBJECTS.functions) if (!(await c.query('select 1 from pg_proc where proname = $1', [k])).rowCount) diffs.push(`missing function ${k}`);
    for (const k of schema.CUSTOM_OBJECTS.views) if (!(await c.query(`select 1 from pg_views where viewname = $1 and schemaname = 'public'`, [k])).rowCount) diffs.push(`missing view ${k}`);
  } finally {
    await c.end();
  }
  return diffs;
}
