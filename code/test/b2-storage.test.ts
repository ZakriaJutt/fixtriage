// B2 attachment storage on MinIO over the S3 API (T-2.3.7 part; AD-10, R-13; IT-10 storage path): a tenant photo sent
// by email to account A is stored under acct/{A}/inbound/...; A's staff download it through the authorised route; B's
// staff, no session and anonymous S3 reads are refused; oversized and wrong-type files are rejected and the message is
// still processed. Every object written here is deleted afterwards. Synthetic bytes only.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FakeObjectStorage, storageKey } from '@fixtriage/platform';
import { MAX_ATTACHMENT_BYTES, storeAttachment } from '@fixtriage/services';
import { call, harness, POSTMARK_SECRET, q, resetData, seedAccount, seedSession, staffCall, type Harness, type Seeded } from './helpers';
import { localConfig, minio } from './b2-helpers';

const store = minio();
const prefixes = new Set<string>();
let h: Harness;
let A: Seeded;
let B: Seeded;

// A 1x1 PNG and a minimal PDF header: synthetic, no real photo.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d00000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeEach(async () => {
  await resetData();
  h = harness('2027-03-02T09:00:00Z', { storage: store });
  A = await seedAccount(h.deps.database, 1);
  B = await seedAccount(h.deps.database, 2);
  prefixes.add(`acct/${A.accountId}/`);
  prefixes.add(`acct/${B.accountId}/`);
});

afterAll(async () => {
  for (const p of prefixes) for (const k of await store.list(p)) await store.delete(k);
  for (const p of prefixes) expect(await store.list(p)).toEqual([]);
});

async function emailWithAttachments(s: Seeded, files: Array<{ name: string; type: string; bytes: Buffer }>, text = 'kitchen tap dripping, photo attached'): Promise<Response> {
  const body = { MessageID: `pm-${randomUUID()}`, From: s.tenants['204'].email, To: s.emailAddress, TextBody: text, Attachments: files.map((f) => ({ Name: f.name, ContentType: f.type, Content: f.bytes.toString('base64'), ContentLength: f.bytes.length })) };
  const req = new Request('http://internal/webhooks/postmark/inbound', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': POSTMARK_SECRET }, body: JSON.stringify(body) });
  return call(h, 'POST', '/webhooks/postmark/inbound', req);
}

describe('B2 attachment storage on MinIO', () => {
  it('stores a tenant photo under an account-scoped key; A downloads it; B, no session and anonymous S3 are refused', async () => {
    expect(await store.ping()).toBe(true);
    expect((await emailWithAttachments(A, [{ name: '../../evil name.png', type: 'text/plain', bytes: PNG }])).status).toBe(200);
    const [att] = await q<{ id: string; storage_key: string; status: string; content_type: string; bytes: number }>('select id, storage_key, status, content_type, bytes from attachments where account_id = $1', [A.accountId]);
    expect(att!.status).toBe('stored');
    expect(att!.content_type).toBe('image/png'); // by content, not the declared type
    expect(att!.storage_key).toMatch(new RegExp(`^acct/${A.accountId}/inbound/2027/03/[0-9a-f-]{36}$`));
    expect(att!.storage_key).not.toContain('evil');
    expect((await store.get(att!.storage_key))!.body.equals(PNG)).toBe(true);

    const a = await seedSession(A.lee);
    const res = await staffCall(h, 'GET', `/api/attachments/${att!.id}`, a);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const b = await seedSession(B.lee);
    expect((await staffCall(h, 'GET', `/api/attachments/${att!.id}`, b)).status).toBe(404);
    expect((await staffCall(h, 'GET', `/api/attachments/${att!.id}`, null)).status).toBe(401);
    // The bucket is private: no public URL works.
    const anon = await fetch(`${localConfig.S3_ENDPOINT}/${localConfig.S3_BUCKET}/${att!.storage_key}`);
    expect(anon.status).toBe(403);
    const [audit] = await q<{ n: number }>(`select count(*)::int n from audit_events where account_id = $1 and action = 'attachment.viewed'`, [A.accountId]);
    expect(audit!.n).toBe(1);
  });

  it('a PDF is served as a download, never inline', async () => {
    await emailWithAttachments(A, [{ name: 'quote.pdf', type: 'application/pdf', bytes: PDF }]);
    const [att] = await q<{ id: string }>('select id from attachments where account_id = $1', [A.accountId]);
    const res = await staffCall(h, 'GET', `/api/attachments/${att!.id}`, await seedSession(A.lee));
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('oversized and wrong-type files are rejected and shown as such; the message still gets a request and a safety reply', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    const exe = Buffer.from('MZ\x90\x00 not an image');
    expect((await emailWithAttachments(A, [{ name: 'a.png', type: 'image/png', bytes: big }, { name: 'b.jpg', type: 'image/jpeg', bytes: exe }])).status).toBe(200);
    const atts = await q<{ idx: number; status: string; storage_key: string | null }>('select idx, status, storage_key from attachments where account_id = $1 order by idx', [A.accountId]);
    expect(atts.map((x) => [x.idx, x.status, x.storage_key])).toEqual([[0, 'rejected', null], [1, 'rejected', null]]);
    expect(await store.list(`acct/${A.accountId}/`)).toEqual([]);
    const [m] = await q<{ n: number }>(`select count(*)::int n from outbound_messages where account_id = $1 and purpose = 'safety_reply'`, [A.accountId]);
    expect(m!.n).toBe(1);
    const [rejected] = await q<{ id: string }>('select id from attachments where account_id = $1 and idx = 0', [A.accountId]);
    expect((await staffCall(h, 'GET', `/api/attachments/${rejected!.id}`, await seedSession(A.lee))).status).toBe(404);
  });

  it('storage down: the attachment is marked unavailable and nothing else fails', async () => {
    const down = new FakeObjectStorage();
    down.healthy = false;
    const h2 = harness('2027-03-02T09:00:00Z', { storage: down });
    const [im] = await (async () => {
      await emailWithAttachments(A, [{ name: 'x', type: 'image/png', bytes: PNG }]);
      return q<{ id: string }>('select inbound_message_id as id from attachments where account_id = $1', [A.accountId]);
    })();
    await q(`update attachments set status = 'pending', storage_key = null where account_id = $1`, [A.accountId]);
    const r = await storeAttachment(h2.deps, A.accountId, { inboundMessageId: im!.id, idx: 0, bytes: PNG });
    expect(r.status).toBe('unavailable');
  });

  it('the store refuses keys that did not come from the key builder, and B\'s key is not reachable with A\'s row lookup', async () => {
    await expect(store.get('../fixtriage-dev/other')).rejects.toThrow(/invalid storage key/);
    await expect(store.put('acct/x/evil.png', PNG, 'image/png')).rejects.toThrow(/invalid storage key/);
    await emailWithAttachments(B, [{ name: 'b.png', type: 'image/png', bytes: PNG }]);
    const [bAtt] = await q<{ id: string; storage_key: string }>('select id, storage_key from attachments where account_id = $1', [B.accountId]);
    expect(bAtt!.storage_key.startsWith(`acct/${B.accountId}/`)).toBe(true);
    expect((await staffCall(h, 'GET', `/api/attachments/${bAtt!.id}`, await seedSession(A.ownerId))).status).toBe(404);
    expect(storageKey(A.accountId, 'inbound', h.clock.now())).not.toBe(bAtt!.storage_key);
  });
});
