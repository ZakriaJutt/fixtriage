// HTTP handlers for the B1 core path (TRD 5.1). Framework-neutral (Request -> Response) so that Next.js route files
// stay one line each and tests can call the handlers directly. Links and signature URLs come from PUBLIC_BASE_URL.
import { isTier } from '@fixtriage/core';
import { eq, resolvers, tables, withAccount } from '@fixtriage/db';
import { createLogger, newCorrelationId, publicUrl, secretEquals, verifyTwilioSignature, withCorrelation } from '@fixtriage/platform';
import {
  ackByToken,
  ackByVoice,
  ackIncidentFromApp,
  applyDeliveryStatus,
  actOnDeadJob,
  approveDispatch,
  authenticateOperator,
  listDeadJobs,
  OperatorOnlyError,
  AuthError,
  authenticate,
  ConflictError,
  describeAckToken,
  downgradeIncident,
  ForbiddenError,
  ingestInbound,
  NotFoundError,
  readiness,
  recordOutcome,
  withIdempotency,
  type Deps,
  type StaffPrincipal,
} from '@fixtriage/services';

const log = createLogger('web');

export interface WebDeps extends Deps {
  twilioAuthToken: string;
  postmarkSecret: string;
}

export const SESSION_COOKIE = '__Host-ft_session';
export const CSRF_HEADER = 'x-csrf-token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function error(status: number, code: string, correlationId: string, message = code): Response {
  return json(status, { error: { code, message, correlation_id: correlationId } });
}
function xml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { 'content-type': 'text/xml' } });
}
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function formParams(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function cookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

export function createHandlers(deps: WebDeps): Record<string, Handler> {
  const twilioOk = (path: string, req: Request, params: Record<string, string>) => verifyTwilioSignature(deps.twilioAuthToken, publicUrl(deps.publicBaseUrl, path), params, req.headers.get('x-twilio-signature'));

  const traced = (name: string, h: (req: Request, params: Record<string, string>, cid: string) => Promise<Response>): Handler =>
    (req, params) => {
      const cid = newCorrelationId();
      return withCorrelation(cid, async () => {
        try {
          return await h(req, params, cid);
        } catch (e) {
          if (e instanceof AuthError) {
            log.warn('auth.rejected', { route: name, code: e.code });
            return error(e.code === 'csrf' ? 403 : 401, e.code, cid);
          }
          if (e instanceof NotFoundError) return error(404, 'not_found', cid);
          if (e instanceof ForbiddenError || e instanceof OperatorOnlyError) return error(403, 'forbidden', cid);
          if (e instanceof ConflictError) return error(409, e.code, cid);
          log.error('handler.error', { route: name, error: e instanceof Error ? e.name : 'unknown' });
          return error(500, 'internal', cid);
        }
      });
    };

  /** Staff routes: session + anti-forgery token on state changes; account from the session only (TRD 5.1). */
  const staff = (name: string, stateChanging: boolean, h: (p: StaffPrincipal, req: Request, params: Record<string, string>, cid: string) => Promise<Response>): Handler =>
    traced(name, async (req, params, cid) => {
      const p = await authenticate(deps, cookie(req, SESSION_COOKIE), req.headers.get(CSRF_HEADER), stateChanging);
      return h(p, req, params, cid);
    });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const idParam = (params: Record<string, string>) => {
    const id = params.id ?? '';
    if (!UUID.test(id)) throw new NotFoundError('id');
    return id;
  };

  return {
    'GET /healthz': traced('healthz', async () => json(200, { ok: true })),

    'GET /readyz': traced('readyz', async () => {
      const r = await readiness(deps);
      return json(r.ok ? 200 : 503, r);
    }),

    'POST /webhooks/twilio/sms': traced('twilio.sms', async (req, _p, cid) => {
      const params = await formParams(req);
      if (!twilioOk('/webhooks/twilio/sms', req, params)) return error(403, 'bad_signature', cid);
      const sid = params.MessageSid ?? params.SmsSid;
      if (!sid || !params.From || !params.To) return error(400, 'invalid_payload', cid);
      const r = await ingestInbound(deps, {
        provider: 'twilio', kind: 'sms', providerMessageId: sid, to: params.To, from: params.From,
        body: params.Body ?? null, mediaCount: Math.min(Number(params.NumMedia ?? 0) || 0, 10), receivedAt: deps.clock.now(), correlationId: cid, raw: params,
      });
      log.info('twilio.sms', { status: r.status });
      // Twilio does not retry an inbound SMS webhook on error, so 200 is returned in every case; an unrouted message
      // was recorded in unrouted_inbound and fails /readyz (B1-004).
      return xml(''); // 200 with empty TwiML: no reply from the webhook itself; the safety reply goes through the outbox
    }),

    'POST /webhooks/twilio/status': traced('twilio.status', async (req, _p, cid) => {
      const params = await formParams(req);
      if (!twilioOk('/webhooks/twilio/status', req, params)) return error(403, 'bad_signature', cid);
      const id = params.MessageSid ?? params.CallSid;
      const raw = (params.MessageStatus ?? params.CallStatus ?? '').toLowerCase();
      // An unanswered call is not a delivery failure (TRD 6.2 note); only failed/canceled calls are.
      const map: Record<string, 'sent' | 'delivered' | 'undelivered' | 'failed'> = {
        sent: 'sent', queued: 'sent', accepted: 'sent', sending: 'sent', delivered: 'delivered', undelivered: 'undelivered', failed: 'failed',
        initiated: 'sent', ringing: 'sent', 'in-progress': 'sent', 'no-answer': 'sent', busy: 'sent', completed: 'delivered', canceled: 'failed',
      };
      const status = map[raw];
      if (!id || !status) return error(400, 'invalid_payload', cid);
      const r = await applyDeliveryStatus(deps, id, status);
      return json(200, { result: r });
    }),

    'POST /webhooks/twilio/voice': traced('twilio.voice', async (req, _p, cid) => {
      const params = await formParams(req);
      if (!twilioOk('/webhooks/twilio/voice', req, params)) return error(403, 'bad_signature', cid);
      // MH-16(e): a call to the SMS number is forwarded to the account's emergency contact number, never dropped.
      const ch = params.To ? await resolvers.channel(deps.database, params.To) : null;
      let phone: string | null = null;
      if (ch) {
        phone = await withAccount(deps.database, ch.account_id, async (tx) => {
          const [a] = await tx.select({ p: tables.accounts.emergencyContactPhone }).from(tables.accounts).where(eq(tables.accounts.id, ch.account_id));
          return a?.p ?? null;
        });
      }
      if (!phone) return xml('<Say>If anyone is in danger, hang up and call 9 1 1. Please call your landlord\'s emergency contact number.</Say>');
      return xml(`<Dial>${esc(phone)}</Dial>`);
    }),

    'POST /webhooks/twilio/voice-ack': traced('twilio.voice_ack', async (req, _p, cid) => {
      const params = await formParams(req);
      if (!twilioOk('/webhooks/twilio/voice-ack', req, params)) return error(403, 'bad_signature', cid);
      const r = params.CallSid ? await ackByVoice(deps, params.CallSid, params.Digits ?? '') : null;
      if (r && 'engaged' in r) return xml('<Say>Recorded: operator engaged. The escalation continues until a person of the account acknowledges.</Say>');
      if (r?.ok) return xml('<Say>Acknowledged. Please record the outcome within 30 minutes.</Say>');
      if (r && !r.ok) return xml('<Say>This report was already acknowledged.</Say>');
      return xml('<Say>Not acknowledged.</Say>');
    }),

    'POST /webhooks/postmark/inbound': traced('postmark.inbound', async (req, _p, cid) => {
      if (!secretEquals(deps.postmarkSecret, req.headers.get('x-webhook-secret'))) return error(403, 'bad_secret', cid);
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const id = typeof b?.MessageID === 'string' ? b.MessageID : null;
      const from = typeof b?.From === 'string' ? b.From : null;
      const to = typeof b?.OriginalRecipient === 'string' ? b.OriginalRecipient : typeof b?.To === 'string' ? b.To : null;
      if (!id || !from || !to) return error(400, 'invalid_payload', cid);
      const atts = Array.isArray(b?.Attachments) ? b!.Attachments.length : 0;
      const r = await ingestInbound(deps, { provider: 'postmark', kind: 'email', providerMessageId: id, to, from, body: typeof b?.TextBody === 'string' ? b.TextBody : null, mediaCount: Math.min(atts, 10), receivedAt: deps.clock.now(), correlationId: cid });
      // B1-004: Postmark retries an inbound webhook that does not answer 200 (and stops on 403), so an unrouted message
      // is answered 503 after it was recorded: the message stays retrievable while the operator fixes the routing.
      if (r.status === 'unrouted') return error(503, 'unrouted_destination', cid);
      return json(200, { status: r.status });
    }),

    'GET /api/requests/:id': staff('requests.get', false, async (p, _req, params) => {
      const id = idParam(params);
      return withAccount(deps.database, p.accountId, async (tx) => {
        const [r] = await tx.select().from(tables.requests).where(eq(tables.requests.id, id));
        if (!r) throw new NotFoundError('request');
        return json(200, { id: r.id, tier: r.tier, tier_source: r.tierSource, state: r.state, incident_id: r.incidentId, cannot_text: r.cannotText, version: r.version });
      });
    }),

    'GET /api/incidents/:id': staff('incidents.get', false, async (p, _req, params) => {
      const id = idParam(params);
      return withAccount(deps.database, p.accountId, async (tx) => {
        const [i] = await tx.select().from(tables.incidents).where(eq(tables.incidents.id, id));
        if (!i) throw new NotFoundError('incident');
        return json(200, { id: i.id, tier: i.tier, state: i.state, hazard_class: i.hazardClass, outcome: i.outcome, version: i.version });
      });
    }),

    'POST /api/incidents/:id/ack': staff('incidents.ack', true, async (p, req, params) => {
      const id = idParam(params);
      const body = (await req.json().catch(() => ({}))) as { version?: number };
      return withAccount(deps.database, p.accountId, async (tx) => {
        const r = await withIdempotency(tx, p.accountId, req.headers.get('idempotency-key'), 'incidents.ack', async () => {
          const a = await ackIncidentFromApp(tx, deps, p, id, typeof body.version === 'number' ? body.version : undefined);
          return a.ok ? { status: 200, body: { acknowledged: true } } : { status: 409, body: { error: { code: a.reason } } };
        });
        return json(r.status, r.body);
      });
    }),

    'POST /api/incidents/:id/outcome': staff('incidents.outcome', true, async (p, req, params) => {
      const id = idParam(params);
      const body = (await req.json().catch(() => ({}))) as { outcome?: string; version?: number };
      if (!['vendor_dispatched', 'handled_by_phone', 'attending'].includes(body.outcome ?? '')) throw new ConflictError('invalid_outcome');
      return withAccount(deps.database, p.accountId, async (tx) => {
        const r = await withIdempotency(tx, p.accountId, req.headers.get('idempotency-key'), 'incidents.outcome', async () => {
          const v = await recordOutcome(tx, deps, p.accountId, { incidentId: id, userId: p.userId, outcome: body.outcome as 'attending', ...(typeof body.version === 'number' ? { expectedVersion: body.version } : {}) });
          return { status: 200, body: v };
        });
        return json(r.status, r.body);
      });
    }),

    'POST /api/incidents/:id/downgrade': staff('incidents.downgrade', true, async (p, req, params) => {
      const id = idParam(params);
      const body = (await req.json().catch(() => ({}))) as { tier?: string; reason?: string; version?: number };
      if (!isTier(body.tier) || typeof body.reason !== 'string' || typeof body.version !== 'number') throw new ConflictError('invalid_body');
      return withAccount(deps.database, p.accountId, async (tx) => {
        const r = await withIdempotency(tx, p.accountId, req.headers.get('idempotency-key'), 'incidents.downgrade', async () => ({ status: 200, body: await downgradeIncident(tx, deps, p, { incidentId: id, tier: body.tier as 'routine', reason: body.reason!, expectedVersion: body.version! }) }));
        return json(r.status, r.body);
      });
    }),

    'POST /api/work-orders/:id/approve-dispatch': staff('work_orders.approve', true, async (p, req, params) => {
      const id = idParam(params);
      const body = (await req.json().catch(() => ({}))) as { vendor_id?: string; body?: string; body_sha256?: string; version?: number };
      if (!body.vendor_id || !UUID.test(body.vendor_id) || typeof body.body !== 'string' || typeof body.body_sha256 !== 'string' || typeof body.version !== 'number') throw new ConflictError('invalid_body');
      return withAccount(deps.database, p.accountId, async (tx) => {
        const r = await withIdempotency(tx, p.accountId, req.headers.get('idempotency-key'), 'work_orders.approve', async () => ({
          status: 200,
          body: await approveDispatch(tx, deps, p.accountId, { workOrderId: id, vendorId: body.vendor_id!, body: body.body!, bodySha256: body.body_sha256!, userId: p.userId, expectedVersion: body.version! }),
        }));
        return json(r.status, r.body);
      });
    }),

    // Operator console (TRD 5.1 `/ops/*`): dead jobs keep /readyz red until an operator retries or clears them.
    'GET /ops/jobs/dead': traced('ops.jobs.dead', async (req) => {
      await authenticateOperator(deps, cookie(req, SESSION_COOKIE), null, false);
      return json(200, { jobs: await listDeadJobs(deps) });
    }),

    'POST /ops/jobs/:id/requeue': traced('ops.jobs.requeue', async (req, params) => {
      const op = await authenticateOperator(deps, cookie(req, SESSION_COOKIE), req.headers.get(CSRF_HEADER), true);
      const body = (await req.json().catch(() => ({}))) as { reason?: string };
      return json(200, await actOnDeadJob(deps, op, { jobId: idParam(params), action: 'requeue', reason: body.reason ?? '' }));
    }),

    'POST /ops/jobs/:id/dismiss': traced('ops.jobs.dismiss', async (req, params) => {
      const op = await authenticateOperator(deps, cookie(req, SESSION_COOKIE), req.headers.get(CSRF_HEADER), true);
      const body = (await req.json().catch(() => ({}))) as { reason?: string };
      return json(200, await actOnDeadJob(deps, op, { jobId: idParam(params), action: 'dismiss', reason: body.reason ?? '' }));
    }),

    'GET /a/:token': traced('ack_link.get', async (_req, params, cid) => {
      const d = await describeAckToken(deps, params.token ?? '');
      return d ? json(200, d) : error(404, 'not_found', cid);
    }),

    'POST /a/:token': traced('ack_link.post', async (_req, params, cid) => {
      const r = await ackByToken(deps, params.token ?? '');
      if (!r) return error(404, 'not_found', cid);
      return r.ok ? json(200, { acknowledged: true }) : json(409, { error: { code: r.reason, correlation_id: cid } });
    }),
  };
}

/** Minimal router used by the Next.js catch-all route and by tests. */
export function route(handlers: Record<string, Handler>, method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  for (const [key, handler] of Object.entries(handlers)) {
    const [m, pattern] = key.split(' ') as [string, string];
    if (m !== method) continue;
    const ps = pattern.split('/');
    const xs = path.split('?')[0]!.split('/');
    if (ps.length !== xs.length) continue;
    const params: Record<string, string> = {};
    if (ps.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(xs[i]!)), true) : p === xs[i]))) return { handler, params };
  }
  return null;
}
