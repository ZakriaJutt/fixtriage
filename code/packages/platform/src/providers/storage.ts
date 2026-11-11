// Object storage boundary (AD-10, R-13). Keys come only from storageKey() and start with the account ID; the bucket
// is private and nothing builds a public URL. Downloads go through an authorised route (GET /api/attachments/:id).
// Locally the S3 API points at MinIO; in production at S3 in ca-central-1, selected by settings only.
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  ping(): Promise<boolean>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the key does not exist. */
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Keys under a prefix (test cleanup, retention sweep). */
  list(prefix: string): Promise<string[]>;
}

const KEY = /^acct\/[0-9a-f-]{36}\/(inbound|export|tmp)\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

/** Refuses any key that did not come from storageKey() (no user file names, no path tricks; R-13). */
export function assertStorageKey(key: string): void {
  if (!KEY.test(key)) throw new Error('invalid storage key');
}

export class FakeObjectStorage implements ObjectStorage {
  healthy = true;
  readonly objects = new Map<string, StoredObject>();
  async ping(): Promise<boolean> {
    return this.healthy;
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    if (!this.healthy) throw new Error('fake storage down');
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }
  async get(key: string): Promise<StoredObject | null> {
    assertStorageKey(key);
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

export interface S3Settings {
  endpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(private readonly s: S3Settings) {
    this.client = new S3Client({
      region: s.region,
      forcePathStyle: s.forcePathStyle,
      ...(s.endpoint ? { endpoint: s.endpoint } : {}),
      ...(s.accessKeyId && s.secretAccessKey ? { credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } } : {}),
    });
  }
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.s.bucket }));
      return true;
    } catch {
      return false;
    }
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertStorageKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.s.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string): Promise<StoredObject | null> {
    assertStorageKey(key);
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: key }));
      const bytes = await r.Body!.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: r.ContentType ?? 'application/octet-stream' };
    } catch (e) {
      if (e instanceof Error && (e.name === 'NoSuchKey' || e.name === 'NotFound')) return null;
      throw e;
    }
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s.bucket, Key: key }));
  }
  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.s.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}
