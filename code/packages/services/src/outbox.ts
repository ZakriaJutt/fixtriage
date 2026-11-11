// Single outbox with delivery tracking (AD-12, FD-2, TRD 6.3; IT-09, IT-13).
import { createHash } from 'node:crypto';
import { applyStatus, isFailure, STATUS_RANK, tierRank, type OutboundStatus, type Rendered, type Tier } from '@fixtriage/core';
import { and, eq, poll, resolvers, sql, tables, type Tx } from '@fixtriage/db';
import { ProviderRejectedError, ProviderTimeoutError, publicUrl, withCorrelation, type Channel } from '@fixtriage/platform';
import { audit, correlationId, serviceLog, withAccount, type Deps } from './context';
import { onPageChannelFailed } from './escalation';
import { onDispatchFailed } from './dispatch';
import { ensureIncident, materialiseRequest } from './intake';

export type Purpose = 'safety_reply' | 'urgent_prompt' | 'notice' | 'tenant_update' | 'follow_up' | 'page_sms' | 'page_voice' | 'dispatch' | 'digest' | 'test_page' | 'probe';

export interface EnqueueInput {
  accountId: string;
  purpose: Purpose;
  channel: Channel;
  to: string;
  rendered: Rendered;
  dedupeKey: string;
  at: Date;
  escalationStepId?: string | null;
  dispatchId?: string | null;
  requestId?: string | null;
  approvedBy?: string | null;
}

export const SEND_TIMEOUT_MS = 10_000; // TRD 6.3
export const MAX_ATTEMPTS = 3; // TRD 6.3: 3 tries over 60 s
const RETRY_DELAY_MS = 20_000;
const UNKNOWN_RECHECK_MS = 10_000;

/** Inserts one outbound row; a repeated dedupe key is a no-op. Returns the row id (existing or new). */
export async function enqueueOutbound(tx: Tx, m: EnqueueInput): Promise<string> {
  const inserted = await tx
    .insert(tables.outboundMessages)
    .values({
      accountId: m.accountId,
      purpose: m.purpose,
      channel: m.channel,
      toAddress: m.to,
      templateId: m.rendered.templateId,
      templateVersion: m.rendered.templateVersion,
      body: m.rendered.body,
      bodySha256: createHash('sha256').update(m.rendered.body).digest(),
      dedupeKey: m.dedupeKey,
      escalationStepId: m.escalationStepId ?? null,
      dispatchId: m.dispatchId ?? null,
      requestId: m.requestId ?? null,
      approvedBy: m.approvedBy ?? null,
      correlationId: correlationId(),
      createdAt: m.at,
      updatedAt: m.at,
    })
    .onConflictDoNothing()
    .returning({ id: tables.outboundMessages.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await tx
    .select({ id: tables.outboundMessages.id })
    .from(tables.outboundMessages)
    .where(and(eq(tables.outboundMessages.accountId, m.accountId), eq(tables.outboundMessages.dedupeKey, m.dedupeKey)));
  return existing!.id;
}

const TENANT_PURPOSES: Purpose[] = ['safety_reply', 'urgent_prompt', 'notice', 'tenant_update', 'follow_up'];

async function senderFor(tx: Tx, accountId: string, purpose: string, channel: string, deps: Deps): Promise<string> {
  if (TENANT_PURPOSES.includes(purpose as Purpose) || channel === 'email') {
    const kind = channel === 'email' ? 'email' : 'sms';
    const [c] = await tx.select({ address: tables.channels.address }).from(tables.channels).where(and(eq(tables.channels.accountId, accountId), eq(tables.channels.kind, kind)));
    if (c) return c.address;
  }
  return deps.pagingFromNumber;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (timer = setTimeout(() => rej(new ProviderTimeoutError('send timeout')), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** One pass of `outbox.send` over due rows of every account (poll view `pending_outbox`). */
export async function processOutbox(deps: Deps, limit = 100): Promise<number> {
  const now = deps.clock.now();
  // Rows enqueued together are spaced 1 ms apart to keep their order (safety reply before notice, voice before SMS).
  const due = await poll(deps.database, 'pending_outbox', new Date(now.getTime() + 10), limit);
  let n = 0;
  for (const d of due) {
    if (await sendOne(deps, d.account_id, d.id)) n++;
  }
  return n;
}

async function sendOne(deps: Deps, accountId: string, id: string): Promise<boolean> {
  const now = deps.clock.now();
  const claimed = await withAccount(deps.database, accountId, async (tx) => {
    const rows = await tx.execute(sql`select * from outbound_messages where id = ${id} and (status = 'pending' or (status = 'unknown' and next_attempt_at is not null)) for update skip locked`);
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const from = await senderFor(tx, accountId, String(row.purpose), String(row.channel), deps);
    if (row.status === 'pending') {
      await tx
        .update(tables.outboundMessages)
        .set({ status: 'sending', statusRank: STATUS_RANK.sending, attempts: sql`${tables.outboundMessages.attempts} + 1`, nextAttemptAt: null, updatedAt: now })
        .where(eq(tables.outboundMessages.id, id));
    }
    return { row, from };
  });
  if (!claimed) return false;
  const { row, from } = claimed;
  const purpose = String(row.purpose);
  return withCorrelation(String(row.correlation_id), async () => {
    if (row.status === 'unknown') return reconcileUnknown(deps, accountId, id, purpose, String(row.dedupe_key));
    try {
      const res = await withTimeout(
        deps.messaging.send({
          channel: row.channel as Channel,
          to: String(row.to_address),
          from,
          body: String(row.body),
          clientRef: String(row.dedupe_key),
          ...(row.channel === 'voice' ? { callbackUrl: publicUrl(deps.publicBaseUrl, '/webhooks/twilio/voice-ack') } : {}),
        }),
        SEND_TIMEOUT_MS,
      );
      await withAccount(deps.database, accountId, (tx) =>
        tx
          .update(tables.outboundMessages)
          .set({ status: 'sent', statusRank: STATUS_RANK.sent, providerMessageId: res.providerMessageId, updatedAt: deps.clock.now() })
          .where(and(eq(tables.outboundMessages.id, id), eq(tables.outboundMessages.status, 'sending'))),
      );
      return true;
    } catch (e) {
      const t = deps.clock.now();
      if (e instanceof ProviderTimeoutError) {
        // Result unknown (R-02): reconcile by lookup of our reference before deciding.
        await withAccount(deps.database, accountId, (tx) =>
          tx
            .update(tables.outboundMessages)
            .set({ status: 'unknown', statusRank: STATUS_RANK.unknown, nextAttemptAt: new Date(t.getTime() + UNKNOWN_RECHECK_MS), updatedAt: t })
            .where(eq(tables.outboundMessages.id, id)),
        );
        serviceLog.warn('outbox.send_unknown', { outbound_id: id, purpose });
        return false;
      }
      const code = e instanceof ProviderRejectedError ? e.code : 'error';
      const attempts = Number(row.attempts) + 1;
      const final = code === '21610' || attempts >= MAX_ATTEMPTS;
      await withAccount(deps.database, accountId, async (tx) => {
        if (final) {
          await tx.update(tables.outboundMessages).set({ status: 'failed', statusRank: STATUS_RANK.failed, updatedAt: t }).where(eq(tables.outboundMessages.id, id));
          await audit(tx, { accountId, actorKind: 'provider', action: 'outbound.failed', objectType: 'outbound_message', objectId: id, after: { code, attempts } }, t);
          await onOutboundFailed(tx, deps, accountId, id);
        } else {
          await tx
            .update(tables.outboundMessages)
            .set({ status: 'pending', statusRank: STATUS_RANK.pending, nextAttemptAt: new Date(t.getTime() + RETRY_DELAY_MS), updatedAt: t })
            .where(eq(tables.outboundMessages.id, id));
        }
      });
      serviceLog.warn('outbox.send_failed', { outbound_id: id, purpose, code, final });
      return false;
    }
  });
}

/**
 * TRD 6.3: an unknown send is looked up by our reference. Still unknown: a page, safety reply or tenant message is
 * sent again (a duplicate page is acceptable, a missing one is not); a vendor dispatch is NOT re-sent and stays
 * `unknown`, shown to the approver as "delivery unknown" (IT-13).
 */
async function reconcileUnknown(deps: Deps, accountId: string, id: string, purpose: string, clientRef: string): Promise<boolean> {
  const found = await deps.messaging.lookup(clientRef).catch(() => null);
  const t = deps.clock.now();
  await withAccount(deps.database, accountId, async (tx) => {
    if (found) {
      await tx
        .update(tables.outboundMessages)
        .set({ status: 'sent', statusRank: STATUS_RANK.sent, providerMessageId: found.providerMessageId, nextAttemptAt: null, updatedAt: t })
        .where(eq(tables.outboundMessages.id, id));
    } else if (purpose === 'dispatch') {
      await tx.update(tables.outboundMessages).set({ nextAttemptAt: null, updatedAt: t }).where(eq(tables.outboundMessages.id, id));
      await audit(tx, { accountId, actorKind: 'system', action: 'dispatch.delivery_unknown', objectType: 'outbound_message', objectId: id }, t);
    } else {
      await tx
        .update(tables.outboundMessages)
        .set({ status: 'pending', statusRank: STATUS_RANK.pending, nextAttemptAt: null, updatedAt: t })
        .where(eq(tables.outboundMessages.id, id));
      await audit(tx, { accountId, actorKind: 'system', action: 'outbound.resend_after_unknown', objectType: 'outbound_message', objectId: id }, t);
    }
  });
  return !!found;
}

/** Reaction to a definitive failure of one outbound row (EP-4 for pages, FD-3 for dispatches, FD-5 for tenants). */
export async function onOutboundFailed(tx: Tx, deps: Deps, accountId: string, outboundId: string): Promise<void> {
  const [m] = await tx.select().from(tables.outboundMessages).where(eq(tables.outboundMessages.id, outboundId));
  if (!m) return;
  const now = deps.clock.now();
  if ((m.purpose === 'page_sms' || m.purpose === 'page_voice') && m.escalationStepId) {
    await onPageChannelFailed(tx, deps, accountId, m.escalationStepId);
  } else if (m.purpose === 'dispatch' && m.dispatchId) {
    await onDispatchFailed(tx, deps, accountId, m.dispatchId, 'undelivered');
  } else if (TENANT_PURPOSES.includes(m.purpose as Purpose)) {
    // B1-003 round 4: the after-hours URGENT line (after-hours safety reply or tenant.urgent_prompt) is the net for
    // what the rules miss; when it cannot reach the tenant the request is escalated, never left silent.
    const net = carriesUrgentLine(m);
    let requestId = m.requestId;
    if (!requestId && net) requestId = (await materialiseRequest(tx, deps, accountId, net.inboundId)).requestId;
    if (requestId && m.channel === 'sms') {
      // FD-5: fall back to email when an address is known; otherwise flag "tenant unreachable" for the manager.
      const rows = await tx.execute(sql`
        select tc.email from inbound_messages i join tenant_contacts tc on tc.id = i.tenant_contact_id
        where i.request_id = ${requestId} and tc.email is not null and tc.deleted_at is null limit 1`);
      const email = (rows.rows[0] as { email?: string } | undefined)?.email;
      if (email) {
        await enqueueOutbound(tx, {
          accountId, purpose: m.purpose as Purpose, channel: 'email', to: email,
          rendered: { templateId: m.templateId ?? 'unknown', templateVersion: m.templateVersion ?? 1, body: m.body },
          dedupeKey: `${m.dedupeKey}:email`, at: now, requestId,
        });
      } else {
        await audit(tx, { accountId, actorKind: 'system', action: 'tenant.unreachable', objectType: 'request', objectId: requestId }, now);
      }
    }
    if (net && requestId) await escalateUndeliveredNet(tx, deps, accountId, requestId, m.id);
  }
}

/** The rows that carry the EP-10a URGENT line, with the inbound message they answer (dedupe key `safety:<id>` or `urgent_prompt:<id>`). */
function carriesUrgentLine(m: { purpose: string; templateId: string | null; dedupeKey: string }): { inboundId: string } | null {
  const hit = (m.purpose === 'urgent_prompt' || (m.purpose === 'safety_reply' && m.templateId === 'safety_reply.after_hours')) && /^(?:safety|urgent_prompt):([0-9a-f-]{36})(?::email)?$/.exec(m.dedupeKey);
  return hit ? { inboundId: hit[1]! } : null;
}

/**
 * EP-10a(b): the URGENT line failed definitively (provider error, invalid number, blocked). The tenant cannot reply
 * URGENT, so the request is raised to at least `uncertain`, flagged cannot-text ("phone the tenant") and paged at once.
 */
async function escalateUndeliveredNet(tx: Tx, deps: Deps, accountId: string, requestId: string, outboundId: string): Promise<void> {
  const now = deps.clock.now();
  const [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, requestId));
  if (!r || r.state === 'closed') return;
  const raise = r.tierSource === 'pending' || tierRank(r.tier as Tier) < tierRank('uncertain');
  const [u] = await tx
    .update(tables.requests)
    .set({ ...(raise ? { tier: 'uncertain', tierSource: 'uncertainty' } : {}), cannotText: true, updatedAt: now, version: sql`${tables.requests.version} + 1` })
    .where(eq(tables.requests.id, requestId))
    .returning();
  await audit(tx, { accountId, actorKind: 'system', action: 'request.urgent_line_undelivered', objectType: 'request', objectId: requestId, after: { outbound_id: outboundId, raised: raise } }, now);
  serviceLog.warn('request.urgent_line_undelivered', { request_id: requestId });
  await ensureIncident(tx, deps, accountId, u!, 'unknown', r.openedAt, 'new_incident');
}

/** Delivery-status webhook (TRD 5.1): forward-only by rank; unknown provider IDs are stored and retried (IT-09). */
export async function applyDeliveryStatus(deps: Deps, providerMessageId: string, status: Exclude<OutboundStatus, 'pending' | 'sending' | 'unknown'>): Promise<'applied' | 'recorded' | 'stored_unknown'> {
  const at = deps.clock.now();
  const target = await resolvers.outbound(deps.database, providerMessageId);
  if (!target) {
    await deps.database.pool.query('insert into pending_status_events (provider, provider_message_id, status, received_at) values ($1, $2, $3, $4)', ['twilio', providerMessageId, status, at]);
    return 'stored_unknown';
  }
  return withAccount(deps.database, target.account_id, async (tx) => {
    const rows = await tx.execute(sql`select status from outbound_messages where id = ${target.outbound_message_id} for update`);
    const current = (rows.rows[0] as { status: OutboundStatus }).status;
    const r = applyStatus(current, status);
    await audit(tx, { accountId: target.account_id, actorKind: 'provider', action: 'outbound.status', objectType: 'outbound_message', objectId: target.outbound_message_id, before: { status: current }, after: { status, applied: r.applied } }, at);
    if (!r.applied) return 'recorded';
    await tx.update(tables.outboundMessages).set({ status: r.next, statusRank: STATUS_RANK[r.next], updatedAt: at }).where(eq(tables.outboundMessages.id, target.outbound_message_id));
    if (isFailure(r.next)) await onOutboundFailed(tx, deps, target.account_id, target.outbound_message_id);
    return 'applied';
  });
}

/** Retries stored status events whose provider ID was unknown when they arrived. */
export async function retryPendingStatusEvents(deps: Deps): Promise<number> {
  const r = await deps.database.pool.query('select id, provider_message_id, status from pending_status_events order by received_at limit 100');
  let applied = 0;
  for (const ev of r.rows as Array<{ id: string; provider_message_id: string; status: 'sent' | 'delivered' | 'undelivered' | 'failed' }>) {
    const target = await resolvers.outbound(deps.database, ev.provider_message_id);
    if (!target) {
      await deps.database.pool.query('update pending_status_events set attempts = attempts + 1 where id = $1', [ev.id]);
      continue;
    }
    await deps.database.pool.query('delete from pending_status_events where id = $1', [ev.id]);
    await applyDeliveryStatus(deps, ev.provider_message_id, ev.status);
    applied++;
  }
  return applied;
}
