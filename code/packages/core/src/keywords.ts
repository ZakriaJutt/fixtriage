// Fixed keyword handling (FD-7, UR-2 "tenant replies URGENT", FD-3 vendor reply). Pure.

const STOP = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START = new Set(['start', 'unstop', 'yes start']);
const HELP = new Set(['help', 'info']);

function bare(text: string | null): string {
  return (text ?? '').trim().toLowerCase().replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ');
}

export type Keyword = 'stop' | 'start' | 'help' | null;

/** A message that is only a carrier keyword. Anything longer is a normal message (and still tiered). */
export function carrierKeyword(text: string | null): Keyword {
  const b = bare(text);
  if (STOP.has(b)) return 'stop';
  if (START.has(b)) return 'start';
  if (HELP.has(b)) return 'help';
  return null;
}

export type VendorReply = 'confirmed' | 'declined' | null;

export function vendorReply(text: string | null): VendorReply {
  const b = bare(text);
  if (/^(yes|y|ok|confirm|confirmed|on my way|omw)\b/.test(b)) return 'confirmed';
  if (/^(no|n|decline|declined|cant|can't|cannot|not available)\b/.test(b)) return 'declined';
  return null;
}

/**
 * B1-012 (round 4 ruling): a message that is only a call for help (HELP, INFO, "help me", "please help", SOS) is never
 * consumed as a carrier keyword: it goes through intake with at least an `uncertain` floor, so after hours it pages at
 * once and in business hours the EP-8 timer applies. The provider may still send its own HELP reply. Pure.
 */
const DISTRESS = /^(?:(?:please|pls|plz|someone|somebody|can someone|i need)\s+)?(?:help|sos|info)(?:\s+(?:me|us|please|pls|plz|now|asap|help|sos))*$/;

export function distressFloor(text: string | null): 'uncertain' | null {
  const b = (text ?? '').trim().toLowerCase().replace(/[^a-z\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  return b.length > 0 && DISTRESS.test(b) ? 'uncertain' : null;
}
