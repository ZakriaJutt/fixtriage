// UT-10: safety reply content and clock-only variant selection (MH-02, EP-10).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_TENANT_TEMPLATE_SAMPLES, isAfterHours, pickContacts, renderSafetyReply, type Calendar } from '../src';

const wk: Array<[string, string]> = [['09:00', '17:00']];
const cal: Calendar = { timezone: 'America/Vancouver', hours: { mon: wk, tue: wk, wed: wk, thu: wk, fri: wk }, holidays: [] };
const account = { emergencyContactPhone: '+16045550100', gasEmergencyPhone: '+18006639911' };

describe('UT-10 safety reply', () => {
  it('uses the property override when present, else the account', () => {
    expect(pickContacts(account, { emergencyContactPhone: '+16045550199', gasEmergencyPhone: null })).toEqual({ emergencyContactPhone: '+16045550199', gasEmergencyPhone: '+18006639911' });
    expect(pickContacts(account, null)).toEqual(account);
  });
  it.each([
    ['2027-02-03T22:00:00Z', false, 'safety_reply.standard'], // Wed 14:00 PST
    ['2027-02-04T07:00:00Z', true, 'safety_reply.after_hours'], // Wed 23:00 PST
  ])('at %s after-hours=%s gives %s, with 911, the gas line and the emergency phone', (iso, ah, id) => {
    const afterHours = isAfterHours(new Date(iso), cal);
    expect(afterHours).toBe(ah);
    const r = renderSafetyReply({ afterHours, ...account });
    expect(r.templateId).toBe(id);
    expect(r.body).toContain('911');
    expect(r.body).toContain('+18006639911');
    expect(r.body).toContain('+16045550100');
    expect(r.body).not.toMatch(/\bSTOP\b/);
  });
  it('the selector takes no tier: a request later classed routine cannot change the text', () => {
    // renderSafetyReply's only inputs are the clock result and contact numbers (EP-10).
    expect(Object.keys({ afterHours: true, ...account }).sort()).toEqual(['afterHours', 'emergencyContactPhone', 'gasEmergencyPhone']);
  });
  it('no tenant template says "next business day" or calls the number an emergency line', () => {
    for (const t of ALL_TENANT_TEMPLATE_SAMPLES()) {
      expect(t.body.toLowerCase()).not.toContain('next business day');
      expect(t.body.toLowerCase()).not.toMatch(/emergency (text )?line\b(?! [0-9+])/);
    }
  });
  it('the template module imports nothing (no model, no classifier)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/templates.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
