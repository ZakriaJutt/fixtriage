// Shared dependencies and small helpers for the transactional workflows (TRD 6, schema.md 6).
import { isAfterHours, type BusinessHours, type Calendar } from '@fixtriage/core';
import { eq, sql, tables, withAccount, type Database, type Tx } from '@fixtriage/db';
import { createLogger, currentCorrelationId, newCorrelationId, type Classifier, type Clock, type Logger, type MessagingProvider, type ObjectStorage } from '@fixtriage/platform';

export interface Deps {
  database: Database;
  clock: Clock;
  messaging: MessagingProvider;
  classifier: Classifier;
  storage: ObjectStorage;
  publicBaseUrl: string;
  pagingFromNumber: string;
  /** Per-call model timeout; TRD 6.3 says 8 s. Tests shorten it. */
  classifyTimeoutMs?: number;
  log?: Logger;
}

export const serviceLog = createLogger('services');

export function correlationId(): string {
  return currentCorrelationId() ?? newCorrelationId();
}

export { withAccount };
export type { Tx };

export interface AccountContext {
  id: string;
  name: string;
  calendar: Calendar;
  ackTimeoutSeconds: number;
  emergencyContactPhone: string | null;
  gasEmergencyPhone: string;
}

export async function loadAccount(tx: Tx, accountId: string): Promise<AccountContext> {
  const [a] = await tx.select().from(tables.accounts).where(eq(tables.accounts.id, accountId));
  if (!a) throw new NotFoundError('account');
  return {
    id: a.id,
    name: a.name,
    calendar: { timezone: a.timezone, hours: a.businessHours as BusinessHours, holidays: a.holidays },
    ackTimeoutSeconds: a.ackTimeoutSeconds,
    emergencyContactPhone: a.emergencyContactPhone,
    gasEmergencyPhone: a.gasEmergencyPhone,
  };
}

/** B1-009: a calendar that cannot be evaluated counts as after hours (the safer side: pages at once). */
export function afterHours(account: AccountContext, at: Date): boolean {
  try {
    return isAfterHours(at, account.calendar);
  } catch {
    serviceLog.error('calendar.invalid', { account_id: account.id });
    return true;
  }
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
export class ConflictError extends Error {
  override name = 'ConflictError';
  constructor(public readonly code: string) {
    super(code);
  }
}
export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

export interface AuditInput {
  accountId: string;
  actorKind: 'user' | 'operator' | 'system' | 'tenant' | 'vendor' | 'provider';
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Audit rows hold IDs and enumerated values only, never message text (schema.md 3.4). */
export async function audit(tx: Tx, a: AuditInput, at: Date): Promise<void> {
  await tx.insert(tables.auditEvents).values({
    accountId: a.accountId,
    actorKind: a.actorKind,
    actorId: a.actorId ?? null,
    action: a.action,
    objectType: a.objectType,
    objectId: a.objectId,
    before: (a.before ?? null) as object | null,
    after: (a.after ?? null) as object | null,
    reason: a.reason ?? null,
    correlationId: correlationId(),
    createdAt: at,
  });
}

export type JobKind = 'intake.process' | 'classify' | 'triage.timeout';
/** B1-002: model calls run only in the classify runner; every other job runs in the safety loop. */
export const MODEL_JOB_KINDS: JobKind[] = ['classify'];

export async function enqueueJob(tx: Tx, accountId: string, kind: JobKind, payload: Record<string, unknown>, dedupeKey: string, runAt: Date): Promise<void> {
  await tx
    .insert(tables.jobs)
    .values({ accountId, kind, payload, dedupeKey, runAt, correlationId: correlationId(), createdAt: runAt })
    .onConflictDoNothing();
}

/** Serialises work per (account, key) inside the current transaction (DU-2 threading lock, schema.md 6). */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
