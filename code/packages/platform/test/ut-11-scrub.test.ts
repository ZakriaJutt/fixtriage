// UT-11: log lines never contain phone numbers, emails or message text.
import { describe, expect, it } from 'vitest';
import { createLogger, setLogSink, withCorrelation } from '../src';

describe('UT-11 log scrubbing', () => {
  it('removes phone, email and message text and keeps IDs and the correlation ID', () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    const log = createLogger('test');
    withCorrelation('7d0c2a7e-4d9b-4f43-9d6f-1a2b3c4d5e6f', () => {
      log.info('inbound stored from +1 604 555 0142', {
        inbound_id: '0b6f8a52-3c1e-4c55-9a77-2b3e4f5a6b7c',
        from: '+16045550142',
        body: 'no heat, my name is Pat Example',
        note: 'reply to pat@example.com or 604-555-0142',
        nested: { email: 'pat@example.com', mobile: '+16045550142', count: 3 },
      });
    });
    const out = lines.join('\n');
    expect(out).not.toContain('5550142');
    expect(out).not.toContain('555 0142');
    expect(out).not.toContain('pat@example.com');
    expect(out).not.toContain('no heat');
    expect(out).not.toContain('Pat Example');
    expect(out).toContain('0b6f8a52-3c1e-4c55-9a77-2b3e4f5a6b7c');
    expect(JSON.parse(lines[0]!).correlation_id).toBe('7d0c2a7e-4d9b-4f43-9d6f-1a2b3c4d5e6f');
  });
});
