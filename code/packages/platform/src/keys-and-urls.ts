// The one storage-key builder (AD-10) and the one public URL builder (R-16). Links never use request host headers.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type StoragePurpose = 'inbound' | 'export' | 'tmp';

export function storageKey(accountId: string, purpose: StoragePurpose, at: Date, id: string = randomUUID()): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `acct/${accountId}/${purpose}/${yyyy}/${mm}/${id}`;
}

export function publicUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Capability tokens (TRD 8.1): 256-bit random, stored hashed. */
export function newCapabilityToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}
export function sha256(s: string | Buffer): Buffer {
  return createHash('sha256').update(s).digest();
}
