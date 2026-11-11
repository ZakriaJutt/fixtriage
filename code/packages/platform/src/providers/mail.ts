// Staff mail (B2): invitations and password-reset links. SMTP is the only interface; locally it points at Mailpit
// (127.0.0.1:1025, no authentication), in production at a real provider's SMTP endpoint selected by settings only.
// Tenant-facing email keeps going through MessagingProvider and the outbox (TRD 8.5).
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(m: MailMessage): Promise<{ messageId: string }>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  /** Local Mailpit has no TLS; production requires it (config refuses an unauthenticated, plaintext production SMTP). */
  requireTls: boolean;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(private readonly s: SmtpSettings) {
    this.transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: s.requireTls,
      ignoreTLS: !s.secure && !s.requireTls,
      ...(s.user ? { auth: { user: s.user, pass: s.pass ?? '' } } : {}),
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  async send(m: MailMessage): Promise<{ messageId: string }> {
    const r = await this.transport.sendMail({ from: this.s.from, to: m.to, subject: m.subject, text: m.text });
    return { messageId: String(r.messageId) };
  }
}

export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  fail = false;
  async send(m: MailMessage): Promise<{ messageId: string }> {
    if (this.fail) throw new Error('fake mailer failure');
    this.sent.push(m);
    return { messageId: `fake-${this.sent.length}` };
  }
}
