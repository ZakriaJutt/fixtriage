// Forward-only delivery status (TRD 6.3 R-01; FD-2; UT-07). Pure.

export const OUTBOUND_STATUSES = ['pending', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'unknown'] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

export const STATUS_RANK: Record<OutboundStatus, number> = { pending: 0, sending: 1, unknown: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3 };

export function isFailure(s: OutboundStatus): boolean {
  return s === 'failed' || s === 'undelivered';
}

/** A status event applies only if it ranks above the current one; the first terminal status wins. Late events are still recorded by the caller. */
export function applyStatus(current: OutboundStatus, event: OutboundStatus): { next: OutboundStatus; applied: boolean } {
  if (STATUS_RANK[event] > STATUS_RANK[current]) return { next: event, applied: true };
  return { next: current, applied: false };
}
