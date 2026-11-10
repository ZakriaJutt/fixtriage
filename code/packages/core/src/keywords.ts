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
