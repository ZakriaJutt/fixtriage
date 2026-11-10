// Log scrubber (TRD 8.4, UT-11): logs hold IDs and codes only.
const SENSITIVE_KEYS = /^(body|text|message|content|name|display_name|displayName|first_name|last_name|address|street_address|street|email|phone|mobile|to|from|to_address|from_address|token|password|secret|authorization|cookie|raw_payload|raw|subject)$/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scrubString(s: string): string {
  if (UUID.test(s)) return s;
  return s.replace(EMAIL, '[email]').replace(PHONE, '[number]');
}

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value instanceof Error) return { error: value.name, code: (value as { code?: unknown }).code ?? null };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    return out;
  }
  return value;
}
