// Vendor dispatch (FD-1, FD-3, FD-4, AD-11; schema.md 6 T5; IT-11, IT-12, IT-13, IT-19).
// Nothing reaches a vendor without a human approving that exact text and recipient. The system never contacts a
// second vendor on its own: after a failed emergency dispatch it pages people with the next vendor pre-drafted.
import { createHash } from 'node:crypto';
import { addBusinessMinutes, EP, vendorReply } from '@fixtriage/core';
import { and, desc, eq, isNull, poll, sql, tables, type Tx } from '@fixtriage/db';
import { audit, ConflictError, loadAccount, NotFoundError, withAccount, type Deps } from './context';
import { reopenEscalation } from './escalation';
import { enqueueOutbound } from './outbox';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ApproveInput {
  workOrderId: string;
  vendorId: string;
  body: string;
  /** Hash of the exact text the approver saw (TRD 5.1 approve-dispatch). */
  bodySha256: string;
  userId: string;
  expectedVersion: number;
}

/** T5: compare the hash, insert the dispatch and its outbox row, mark the work order sent. */
export async function approveDispatch(tx: Tx, deps: Deps, accountId: string, input: ApproveInput): Promise<{ dispatchId: string }> {
  const now = deps.clock.now();
  if (sha256Hex(input.body) !== input.bodySha256) throw new ConflictError('body_changed_reload');
  const lock = await tx.execute(sql`select id from work_orders where id = ${input.workOrderId} for update`);
  if (!lock.rows.length) throw new NotFoundError('work_order');
  const [wo] = await tx.select().from(tables.workOrders).where(eq(tables.workOrders.id, input.workOrderId));
  if (!wo) throw new NotFoundError('work_order');
  if (wo.version !== input.expectedVersion) throw new ConflictError('version_conflict_reload');
  const [vendor] = await tx.select().from(tables.vendors).where(and(eq(tables.vendors.id, input.vendorId), eq(tables.vendors.active, true)));
  if (!vendor?.mobile) throw new NotFoundError('vendor');
  const emergency = wo.tier === 'life_safety' || wo.tier === 'urgent';
  const account = await loadAccount(tx, accountId);
  const confirmDueAt = emergency ? new Date(now.getTime() + EP.emergencyConfirmSeconds * 1000) : (addBusinessMinutes(now, EP.routineConfirmBusinessMinutes, account.calendar) ?? new Date(now.getTime() + 24 * 3600 * 1000));
  const seqRow = await tx.execute(sql`select coalesce(max(seq), 0) + 1 as seq from dispatches where work_order_id = ${wo.id}`);
  const seq = Number((seqRow.rows[0] as { seq: number }).seq);
  const [d] = await tx
    .insert(tables.dispatches)
    .values({ accountId, workOrderId: wo.id, vendorId: vendor.id, seq, emergency, approvedBy: input.userId, approvedAt: now, confirmDueAt, createdAt: now, updatedAt: now })
    .returning({ id: tables.dispatches.id });
  await enqueueOutbound(tx, { accountId, purpose: 'dispatch', channel: 'sms', to: vendor.mobile, rendered: { templateId: 'dispatch.approved_text', templateVersion: 1, body: input.body }, dedupeKey: `dispatch:${d!.id}`, at: now, dispatchId: d!.id, approvedBy: input.userId });
  await tx.update(tables.workOrders).set({ state: 'sent', updatedAt: now, version: sql`${tables.workOrders.version} + 1` }).where(eq(tables.workOrders.id, wo.id));
  if (wo.incidentId) {
    // EP-7: approving a dispatch on an acknowledged incident records the outcome "vendor dispatched".
    await tx
      .update(tables.incidents)
      .set({ outcome: 'vendor_dispatched', outcomeBy: input.userId, outcomeAt: now, state: 'outcome_recorded', updatedAt: now, version: sql`${tables.incidents.version} + 1` })
      .where(and(eq(tables.incidents.id, wo.incidentId), eq(tables.incidents.state, 'acknowledged')));
    await tx.update(tables.escalations).set({ nextDueAt: null }).where(and(eq(tables.escalations.incidentId, wo.incidentId), eq(tables.escalations.state, 'acknowledged')));
  }
  await audit(tx, { accountId, actorKind: 'user', actorId: input.userId, action: 'dispatch.approved', objectType: 'dispatch', objectId: d!.id, after: { vendor_id: vendor.id, seq, emergency, body_sha256: input.bodySha256 } }, now);
  return { dispatchId: d!.id };
}

/** Next vendor in preferred order for the work order's trade, not yet dispatched for it (FD-3 pre-draft). */
export async function nextVendorFor(tx: Tx, dispatchId: string): Promise<{ id: string; name: string } | null> {
  const r = await tx.execute(sql`
    select v.id, v.name from dispatches d
    join work_orders w on w.id = d.work_order_id
    join vendor_trades vt on vt.trade = w.trade
    join vendors v on v.id = vt.vendor_id and v.active
    where d.id = ${dispatchId}
      and v.id not in (select vendor_id from dispatches where work_order_id = w.id and vendor_id is not null)
    order by vt.rank limit 1`);
  return (r.rows[0] as { id: string; name: string } | undefined) ?? null;
}

/** FD-3 / FD-4: record the failure; an emergency dispatch reopens the incident's escalation (EP-11b), unique per dispatch. */
export async function onDispatchFailed(tx: Tx, deps: Deps, accountId: string, dispatchId: string, result: 'declined' | 'timeout' | 'undelivered'): Promise<void> {
  const now = deps.clock.now();
  const upd = await tx
    .update(tables.dispatches)
    .set({ result, resultAt: now, updatedAt: now })
    .where(and(eq(tables.dispatches.id, dispatchId), isNull(tables.dispatches.result)))
    .returning();
  const d = upd[0];
  if (!d) return;
  const [wo] = await tx.select().from(tables.workOrders).where(eq(tables.workOrders.id, d.workOrderId));
  await audit(tx, { accountId, actorKind: 'system', action: 'dispatch.failed', objectType: 'dispatch', objectId: d.id, after: { result, emergency: d.emergency } }, now);
  if (!wo) return;
  await tx.update(tables.workOrders).set({ state: 'no_response', updatedAt: now }).where(eq(tables.workOrders.id, wo.id));
  if (d.emergency && wo.incidentId) {
    await reopenEscalation(tx, deps, accountId, wo.incidentId, 'dispatch_failed', { dispatchId: d.id, approverUserId: d.approvedBy });
  }
}

/** dispatch.watch (every 30 s): confirmation timeouts (FD-3 10 min, FD-4 4 business hours). */
export async function watchDispatches(deps: Deps): Promise<number> {
  const due = await poll(deps.database, 'due_dispatches', deps.clock.now());
  for (const d of due) await withAccount(deps.database, d.account_id, (tx) => onDispatchFailed(tx, deps, d.account_id, d.id, 'timeout'));
  return due.length;
}

/** A text from a vendor's number with an open dispatch: YES confirms, NO declines (FD-3). Returns false if not a vendor reply. */
export async function handleVendorReply(tx: Tx, deps: Deps, accountId: string, from: string, body: string | null, inboundId: string): Promise<boolean> {
  const r = await tx
    .select({ id: tables.dispatches.id, workOrderId: tables.dispatches.workOrderId })
    .from(tables.dispatches)
    .innerJoin(tables.vendors, eq(tables.vendors.id, tables.dispatches.vendorId))
    .where(and(eq(tables.vendors.mobile, from), isNull(tables.dispatches.result)))
    .orderBy(desc(tables.dispatches.approvedAt))
    .limit(1);
  const d = r[0];
  if (!d) return false;
  const reply = vendorReply(body);
  const now = deps.clock.now();
  await audit(tx, { accountId, actorKind: 'vendor', action: `dispatch.reply.${reply ?? 'unparsed'}`, objectType: 'dispatch', objectId: d.id, after: { inbound_id: inboundId } }, now);
  if (reply === 'confirmed') {
    await tx.update(tables.dispatches).set({ result: 'confirmed', resultAt: now, updatedAt: now }).where(eq(tables.dispatches.id, d.id));
    await tx.update(tables.workOrders).set({ state: 'confirmed', updatedAt: now }).where(eq(tables.workOrders.id, d.workOrderId));
  } else if (reply === 'declined') {
    await onDispatchFailed(tx, deps, accountId, d.id, 'declined');
  }
  return true;
}
