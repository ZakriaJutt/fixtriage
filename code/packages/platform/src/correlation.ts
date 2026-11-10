// Correlation context (TRD 8.4, R-12): created at webhook or request entry, copied into jobs and outbound rows.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const store = new AsyncLocalStorage<{ correlationId: string }>();

export function newCorrelationId(): string {
  return randomUUID();
}
export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  return store.run({ correlationId }, fn);
}
export function currentCorrelationId(): string | null {
  return store.getStore()?.correlationId ?? null;
}
