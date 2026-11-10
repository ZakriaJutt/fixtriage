// classify job (TRD 6.3, 8.5; UR-3, UR-5; IT-03, IT-04). The model proposes; it can raise a tier, never lower a decided one.
import { finalTier, isTier, tierRank, type ModelOutcome, type Tier } from '@fixtriage/core';
import { and, eq, sql, tables } from '@fixtriage/db';
import type { ClassifierAnswer } from '@fixtriage/platform';
import { audit, serviceLog, withAccount, type Deps } from './context';
import { applyEscalationNeed } from './intake';

export const CLASSIFY_CALL_TIMEOUT_MS = 8_000;
export const CLASSIFY_TRIES = 2;
export const CLASSIFY_TOTAL_MS = 20_000;

async function callModel(deps: Deps, text: string | null, hasMedia: boolean): Promise<{ outcome: ModelOutcome; answer: ClassifierAnswer | null; status: 'ok' | 'failed' | 'timeout' }> {
  const started = Date.now();
  let last: 'failed' | 'timeout' = 'failed';
  for (let i = 0; i < CLASSIFY_TRIES; i++) {
    const remaining = CLASSIFY_TOTAL_MS - (Date.now() - started);
    if (remaining <= 0) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(deps.classifyTimeoutMs ?? CLASSIFY_CALL_TIMEOUT_MS, remaining));
    try {
      const a = await deps.classifier.classify({ text, hasMedia }, ctl.signal);
      if (!isTier(a.tier) || typeof a.confidence !== 'number') return { outcome: { status: 'malformed' }, answer: null, status: 'failed' };
      return { outcome: { status: 'ok', tier: a.tier, confidence: a.confidence }, answer: a, status: 'ok' };
    } catch {
      last = ctl.signal.aborted ? 'timeout' : 'failed';
    } finally {
      clearTimeout(timer);
    }
  }
  return { outcome: { status: last }, answer: null, status: last };
}

export async function runClassifyJob(deps: Deps, accountId: string, inboundId: string, requestId: string): Promise<void> {
  const pre = await withAccount(deps.database, accountId, async (tx) => {
    const done = await tx.execute(sql`select 1 from classifications where inbound_message_id = ${inboundId} and kind = 'model' and model = ${deps.classifier.model} limit 1`);
    if (done.rows.length) return null;
    const [m] = await tx.select({ body: tables.inboundMessages.body, mediaCount: tables.inboundMessages.mediaCount }).from(tables.inboundMessages).where(eq(tables.inboundMessages.id, inboundId));
    return m ?? null;
  });
  if (!pre) return;
  // The network call happens outside any transaction (TRD 6.3: webhook and transactions hold no network I/O).
  const res = await callModel(deps, pre.body, pre.mediaCount > 0);
  await withAccount(deps.database, accountId, async (tx) => {
    const now = deps.clock.now();
    const ins = await tx
      .insert(tables.classifications)
      .values({
        accountId,
        requestId,
        inboundMessageId: inboundId,
        kind: 'model',
        provider: deps.classifier.provider,
        model: deps.classifier.model,
        promptVersion: deps.classifier.promptVersion,
        proposedTier: res.answer?.tier ?? null,
        proposedTrade: res.answer?.trade ?? null,
        confidence: res.answer ? res.answer.confidence.toFixed(3) : null,
        missingFields: res.answer?.missingFields ?? null,
        status: res.status,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: tables.classifications.id });
    if (!ins[0]) return;
    const lock = await tx.execute(sql`select id from requests where id = ${requestId} for update`);
    if (!lock.rows.length) return;
    const [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, requestId));
    if (!r) return;
    const pending = r.tierSource === 'pending';
    // A decided tier acts as the floor: finalTier can only return it or higher (UR-5).
    const f = finalTier({ ruleTier: pending ? null : (r.tier as Tier), ruleUncertainty: false, model: res.outcome });
    const patch: Record<string, unknown> = {};
    if (pending) {
      patch.tier = f.tier;
      patch.tierSource = f.source === 'rule' ? 'rule' : f.source;
    } else if (tierRank(f.tier) > tierRank(r.tier as Tier)) {
      patch.tier = f.tier;
      patch.tierSource = 'model';
    }
    const trade = res.answer?.trade ? ((tables.TRADE_VALUES as readonly string[]).includes(res.answer.trade) ? res.answer.trade : 'other') : null;
    if (!r.trade && trade) patch.trade = trade;
    if (!Object.keys(patch).length) return;
    const [u] = await tx.update(tables.requests).set({ ...patch, updatedAt: now, version: sql`${tables.requests.version} + 1` }).where(and(eq(tables.requests.id, requestId))).returning();
    await audit(tx, { accountId, actorKind: 'system', action: 'request.classified', objectType: 'request', objectId: requestId, before: { tier: r.tier, tier_source: r.tierSource }, after: { tier: u!.tier, tier_source: u!.tierSource, model_status: res.status, reasons: f.uncertaintyReasons } }, now);
    if (res.status !== 'ok') serviceLog.warn('classify.model_unavailable', { request_id: requestId, status: res.status });
    await applyEscalationNeed(tx, deps, accountId, u!, 'unknown', u!.openedAt);
  });
}
