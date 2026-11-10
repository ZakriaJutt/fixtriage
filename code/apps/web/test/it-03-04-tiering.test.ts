// IT-03: after hours, no rule hit, model timeout -> uncertain and a page. IT-04: "no heat" with model routine -> urgent and a page.
import { beforeEach, describe, expect, it } from 'vitest';
import { drain, harness, pagesTo, q, resetData, seedAccount, seedOperators, sms, type Harness, type Seeded } from '../../../test/helpers';

let h: Harness;
let s: Seeded;
beforeEach(async () => {
  await resetData();
  await seedOperators();
  h = harness('2027-02-04T06:30:00Z'); // Wed 23:30 local (UTC-7 in tzdata 2026e)
  h.deps.classifyTimeoutMs = 50;
  s = await seedAccount(h.deps.database);
});

describe('IT-03 model failure after hours', () => {
  it.each(['hang', 'down'] as const)('model %s: tier uncertain, Level 1 paged, never routine', async (mode) => {
    h.classifier.mode = mode;
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await drain(h.deps);
    const [r] = await q<{ tier: string; tier_source: string; incident_id: string | null }>('select tier, tier_source, incident_id from requests');
    expect(r).toMatchObject({ tier: 'uncertain', tier_source: 'uncertainty' });
    expect(r!.incident_id).not.toBeNull();
    const [c] = await q<{ status: string }>(`select status from classifications where kind = 'model'`);
    expect(c!.status).toBe(mode === 'hang' ? 'timeout' : 'failed');
    expect(pagesTo(h, s.phones.lee)).toHaveLength(2); // voice + SMS
  });
  it('the same message in business hours with a confident routine answer pages nobody and texts nothing extra (EP-10)', async () => {
    h.clock.set('2027-02-03T22:00:00Z'); // Wed 15:00
    h.classifier.answer = { tier: 'routine', trade: 'general', confidence: 0.95, missingFields: [] };
    await sms(h, s, s.tenants['204'].mobile, 'the cabinet door in my kitchen is loose');
    await drain(h.deps);
    const [r] = await q<{ tier: string }>('select tier from requests');
    expect(r!.tier).toBe('routine');
    expect(pagesTo(h, s.phones.lee)).toHaveLength(0);
    expect(h.messaging.sentTo(s.tenants['204'].mobile).every((m) => m.body.includes('911') || m.body.includes('STOP'))).toBe(true);
  });
});

describe('IT-04 rule beats model', () => {
  it('"no heat" with model routine at 0.99 stays urgent and pages', async () => {
    h.classifier.answer = { tier: 'routine', trade: 'heating', confidence: 0.99, missingFields: [] };
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const [r] = await q<{ tier: string; tier_source: string }>('select tier, tier_source from requests');
    expect(r).toMatchObject({ tier: 'urgent', tier_source: 'rule' });
    const cls = await q<{ kind: string; proposed_tier: string; rule_set_version: number | null; matched_rule: string | null }>('select kind, proposed_tier, rule_set_version, matched_rule from classifications order by created_at, kind desc');
    expect(cls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rule', proposed_tier: 'urgent', rule_set_version: 1, matched_rule: 'ur.no_heat' }),
      expect.objectContaining({ kind: 'model', proposed_tier: 'routine' }),
    ]));
    expect(pagesTo(h, s.phones.lee)).toHaveLength(2);
  });
  it('the database refuses a lower tier without a human classification and reason (UR-6 trigger)', async () => {
    await sms(h, s, s.tenants['204'].mobile, 'no heat');
    await drain(h.deps);
    const { withAccount, tables, eq } = await import('@fixtriage/db');
    const [r] = await q<{ id: string }>('select id from requests');
    await expect(withAccount(h.deps.database, s.accountId, (tx) => tx.update(tables.requests).set({ tier: 'routine', tierSource: 'model' }).where(eq(tables.requests.id, r!.id)))).rejects.toThrow();
  });
});
