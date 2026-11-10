// Database access. The application role is NOSUPERUSER NOBYPASSRLS; every read or write of account data goes through
// withAccount (TRD 8.2). The only other entry points are the resolver functions and poll views (schema.md 4).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

// timestamptz as Date, numeric as string (exact), bigint as number where small.
pg.types.setTypeParser(1700, (v) => v);

export function createDatabase(url: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'fixtriage' });
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens a transaction scoped to one account (sets app.account_id for this transaction only). */
export async function withAccount<T>(database: Database, accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(accountId)) throw new Error('withAccount: account id is not a uuid');
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
    return fn(tx);
  });
}

/** Outside withAccount, only these calls are allowed (schema.md 4). Each returns IDs and the listed columns only. */
export const resolvers = {
  async channel(database: Database, address: string): Promise<{ account_id: string; channel_id: string } | null> {
    const r = await database.pool.query('select account_id, channel_id from resolve_channel($1)', [address]);
    return r.rows[0] ?? null;
  },
  async session(database: Database, tokenHash: Buffer): Promise<{ user_id: string | null; operator_id: string | null; account_id: string | null; role: string; expires_at: Date; csrf_token_hash: Buffer } | null> {
    const r = await database.pool.query('select * from resolve_session($1)', [tokenHash]);
    return r.rows[0] ?? null;
  },
  async capability(database: Database, tokenHash: Buffer): Promise<{ account_id: string; purpose: string; escalation_step_id: string | null; user_id: string | null; dispatch_id: string | null; expires_at: Date; used_at: Date | null } | null> {
    const r = await database.pool.query('select * from resolve_capability($1)', [tokenHash]);
    return r.rows[0] ?? null;
  },
  async outbound(database: Database, providerMessageId: string): Promise<{ account_id: string; outbound_message_id: string } | null> {
    const r = await database.pool.query('select account_id, outbound_message_id from resolve_outbound($1)', [providerMessageId]);
    return r.rows[0] ?? null;
  },
};

export type PollView = 'due_escalations' | 'pending_outbox' | 'due_dispatches' | 'due_jobs';

/** Worker polls (schema.md 4). Returns id, account_id and the due column, oldest first. */
export async function poll(database: Database, view: PollView, dueBefore: Date, limit = 100): Promise<Array<{ id: string; account_id: string; due: Date }>> {
  const col = { due_escalations: 'next_due_at', pending_outbox: 'coalesce(next_attempt_at, created_at)', due_dispatches: 'confirm_due_at', due_jobs: 'run_at' }[view];
  const r = await database.pool.query(`select id, account_id, ${col} as due from ${view} where ${col} <= $1 order by ${col} limit $2`, [dueBefore, limit]);
  return r.rows;
}

/** Oldest due item per poll view, for /readyz (TRD 5.1). */
export async function oldestDue(database: Database, now: Date): Promise<Record<PollView, Date | null>> {
  const r = await database.pool.query(
    `select
      (select min(next_due_at) from due_escalations where next_due_at <= $1) as due_escalations,
      (select min(coalesce(next_attempt_at, created_at)) from pending_outbox where coalesce(next_attempt_at, created_at) <= $1) as pending_outbox,
      (select min(confirm_due_at) from due_dispatches where confirm_due_at <= $1) as due_dispatches,
      (select min(run_at) from due_jobs where run_at <= $1) as due_jobs`,
    [now],
  );
  return r.rows[0];
}
