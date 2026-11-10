// UT-07: forward-only status; late events are recorded, not applied.
import { describe, expect, it } from 'vitest';
import { applyStatus, type OutboundStatus } from '../src';

describe('UT-07 status rank', () => {
  it('delivered -> sent -> failed stays delivered', () => {
    let s: OutboundStatus = 'sending';
    const applied: boolean[] = [];
    for (const e of ['delivered', 'sent', 'failed'] as const) {
      const r = applyStatus(s, e);
      s = r.next;
      applied.push(r.applied);
    }
    expect(s).toBe('delivered');
    expect(applied).toEqual([true, false, false]);
  });
  it('failed then delivered stays failed (first terminal wins, IT-09 logic)', () => {
    expect(applyStatus('failed', 'delivered')).toEqual({ next: 'failed', applied: false });
  });
  it('unknown (caller timeout) is overtaken by any provider status', () => {
    expect(applyStatus('unknown', 'sent').applied).toBe(true);
  });
});
