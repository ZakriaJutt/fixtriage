// Messaging provider boundary (SMS, voice page, email). Real Twilio/Postmark clients are not part of B1.
export type Channel = 'sms' | 'voice' | 'email';
export type ProviderStatus = 'sent' | 'delivered' | 'undelivered' | 'failed' | 'unknown';

export interface SendRequest {
  channel: Channel;
  to: string;
  from: string;
  body: string;
  /** Our dedupe key; used to reconcile an unknown result by lookup (TRD 6.3 R-02). */
  clientRef: string;
  subject?: string;
  /** For voice pages: path of the keypress callback, built from PUBLIC_BASE_URL. */
  callbackUrl?: string;
}
export interface SendResult {
  providerMessageId: string;
}

export class ProviderTimeoutError extends Error {
  override name = 'ProviderTimeoutError';
}
export class ProviderRejectedError extends Error {
  override name = 'ProviderRejectedError';
  constructor(public readonly code: string) {
    super(`provider rejected: ${code}`);
  }
}

export interface MessagingProvider {
  send(req: SendRequest): Promise<SendResult>;
  lookup(clientRef: string): Promise<{ providerMessageId: string; status: ProviderStatus } | null>;
}

type Mode = 'ok' | 'timeout' | 'reject' | 'timeout_then_lost';

/** In-memory fake used by tests and local runs. It never contacts a network. */
export class FakeMessagingProvider implements MessagingProvider {
  readonly sent: Array<SendRequest & { providerMessageId: string }> = [];
  readonly attempts: SendRequest[] = [];
  /** Numbers that sent STOP: the carrier blocks every text (error 21610) until START (FD-7, SRC-21). */
  readonly blockedSms = new Set<string>();
  down = false;
  private rules: Array<{ match: (r: SendRequest) => boolean; mode: Mode; times: number }> = [];
  private seq = 0;
  private lost = new Map<string, string>();

  script(match: (r: SendRequest) => boolean, mode: Mode, times = 1): void {
    this.rules.push({ match, mode, times });
  }

  async send(req: SendRequest): Promise<SendResult> {
    this.attempts.push(req);
    if (this.down) throw new ProviderTimeoutError('provider down');
    if (req.channel === 'sms' && this.blockedSms.has(req.to)) throw new ProviderRejectedError('21610');
    const rule = this.rules.find((r) => r.times > 0 && r.match(req));
    if (rule) {
      rule.times -= 1;
      if (rule.mode === 'timeout') {
        // Provider accepted the message but the answer was lost; a lookup finds it.
        const id = this.nextId(req);
        this.sent.push({ ...req, providerMessageId: id });
        this.lost.set(req.clientRef, id);
        throw new ProviderTimeoutError('timeout');
      }
      if (rule.mode === 'reject') throw new ProviderRejectedError('30003');
      if (rule.mode === 'timeout_then_lost') {
        // Provider accepted nothing; a lookup will not find it.
        throw new ProviderTimeoutError('timeout');
      }
    }
    const providerMessageId = this.nextId(req);
    this.sent.push({ ...req, providerMessageId });
    this.lost.set(req.clientRef, providerMessageId);
    return { providerMessageId };
  }

  private nextId(req: SendRequest): string {
    return `${req.channel === 'voice' ? 'CA' : req.channel === 'sms' ? 'SM' : 'PM'}fake${String(++this.seq).padStart(6, '0')}`;
  }

  async lookup(clientRef: string): Promise<{ providerMessageId: string; status: ProviderStatus } | null> {
    const id = this.lost.get(clientRef);
    return id ? { providerMessageId: id, status: 'sent' } : null;
  }

  sentTo(to: string): Array<SendRequest & { providerMessageId: string }> {
    return this.sent.filter((s) => s.to === to);
  }
  reset(): void {
    this.sent.length = 0;
    this.attempts.length = 0;
    this.rules = [];
    this.blockedSms.clear();
    this.down = false;
    this.lost.clear();
  }
}
