// Builds the mail and storage clients from the one configuration object (R-03): settings only select the backend.
import type { Config } from '../config';
import { FakeMailer, SmtpMailer, type Mailer } from './mail';
import { FakeObjectStorage, S3ObjectStorage, type ObjectStorage } from './storage';

export function createMailer(c: Config): Mailer {
  if (c.MAIL_TRANSPORT === 'fake') return new FakeMailer();
  return new SmtpMailer({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_SECURE, requireTls: c.SMTP_REQUIRE_TLS, user: c.SMTP_USER, pass: c.SMTP_PASS, from: c.MAIL_FROM });
}

export function createStorage(c: Config): ObjectStorage {
  if (c.STORAGE === 'fake') return new FakeObjectStorage();
  return new S3ObjectStorage({ endpoint: c.S3_ENDPOINT, region: c.S3_REGION, bucket: c.S3_BUCKET, accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY, forcePathStyle: c.S3_FORCE_PATH_STYLE });
}
