// Tenant attachments (T-2.3.7 in part; AD-10, R-13; TRD 8.7 V5.2.1, V5.2.2, V5.3.2). Bytes go to object storage
// under acct/{account_id}/inbound/{yyyy}/{mm}/{uuid} (never a user file name); the row in `attachments` carries the
// key, the type detected from the content and the size. Download only through an authorised staff route that looks
// the row up inside withAccount, so another account's attachment ID is "not found" (IT-10 storage path).
import { and, eq, tables } from '@fixtriage/db';
import { storageKey } from '@fixtriage/platform';
import { audit, NotFoundError, serviceLog, withAccount, type Deps } from './context';

/** Per-file limit (V5.2.1). Twilio MMS caps media at 5 MB; Postmark inbound at 35 MB per message; 10 MB per file here. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Type by content, not by the declared type or file name (V5.2.2). Images may be shown inline; everything else is a download. */
export function sniffContentType(b: Buffer): { type: string; image: boolean } | null {
  const hex = b.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return { type: 'image/jpeg', image: true };
  if (hex.startsWith('89504e470d0a1a0a')) return { type: 'image/png', image: true };
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return { type: 'image/gif', image: true };
  if (hex.startsWith('52494646') && b.subarray(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', image: true };
  if (b.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|mif1|heif)/.test(b.subarray(8, 12).toString('ascii'))) return { type: 'image/heic', image: true };
  if (hex.startsWith('255044462d')) return { type: 'application/pdf', image: false };
  return null;
}

export type StoreResult = { status: 'stored'; attachmentId: string; key: string } | { status: 'rejected'; attachmentId: string; reason: 'too_large' | 'unsupported_type' | 'empty' } | { status: 'unavailable'; attachmentId: string };

/**
 * Stores one attachment of a stored inbound message. A rejected or failed file is recorded and shown to staff as such;
 * the message text is processed regardless (TRD 6.4 media.fetch row).
 */
export async function storeAttachment(deps: Deps, accountId: string, input: { inboundMessageId: string; idx: number; bytes: Buffer }): Promise<StoreResult> {
  const now = deps.clock.now();
  const [att] = await withAccount(deps.database, accountId, (tx) =>
    tx.select().from(tables.attachments).where(and(eq(tables.attachments.inboundMessageId, input.inboundMessageId), eq(tables.attachments.idx, input.idx))),
  );
  if (!att) throw new NotFoundError('attachment');
  const set = (v: Partial<typeof tables.attachments.$inferInsert>) => withAccount(deps.database, accountId, (tx) => tx.update(tables.attachments).set(v).where(eq(tables.attachments.id, att.id)));
  const reject = async (reason: 'too_large' | 'unsupported_type' | 'empty'): Promise<StoreResult> => {
    await set({ status: 'rejected', bytes: input.bytes.length });
    serviceLog.warn('attachment.rejected', { attachment_id: att.id, reason });
    return { status: 'rejected', attachmentId: att.id, reason };
  };
  if (input.bytes.length === 0) return reject('empty');
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) return reject('too_large');
  const kind = sniffContentType(input.bytes);
  if (!kind) return reject('unsupported_type');
  const key = storageKey(accountId, 'inbound', now);
  try {
    await deps.storage.put(key, input.bytes, kind.type);
  } catch (e) {
    await set({ status: 'unavailable' });
    serviceLog.error('attachment.store_failed', { attachment_id: att.id, error: e instanceof Error ? e.name : 'unknown' });
    return { status: 'unavailable', attachmentId: att.id };
  }
  await set({ status: 'stored', storageKey: key, contentType: kind.type, bytes: input.bytes.length });
  return { status: 'stored', attachmentId: att.id, key };
}

/** GET /api/attachments/:id for a signed-in user of the account. Not found for another account's ID (RLS). */
export async function readAttachment(deps: Deps, p: { accountId: string; userId: string }, attachmentId: string): Promise<{ body: Buffer; contentType: string; inline: boolean }> {
  const att = await withAccount(deps.database, p.accountId, async (tx) => {
    const [a] = await tx.select().from(tables.attachments).where(eq(tables.attachments.id, attachmentId));
    if (a?.status === 'stored') await audit(tx, { accountId: p.accountId, actorKind: 'user', actorId: p.userId, action: 'attachment.viewed', objectType: 'attachment', objectId: a.id }, deps.clock.now());
    return a;
  });
  if (!att || att.status !== 'stored' || !att.storageKey) throw new NotFoundError('attachment');
  // Defence in depth: the key must belong to the caller's account even if a row were ever wrong (R-13).
  if (!att.storageKey.startsWith(`acct/${p.accountId}/`)) throw new NotFoundError('attachment');
  const obj = await deps.storage.get(att.storageKey);
  if (!obj) throw new NotFoundError('attachment');
  return { body: obj.body, contentType: att.contentType ?? 'application/octet-stream', inline: (att.contentType ?? '').startsWith('image/') };
}
