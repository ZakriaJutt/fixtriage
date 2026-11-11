// Process-wide wiring for the Next.js deployable: configuration, database, providers (fakes in B1), check-in.
import { createDatabase } from '@fixtriage/db';
import { checkTimezoneData, createMailer, createStorage, FakeClassifier, FakeMessagingProvider, HttpMonitorClient, loadConfig, parseSecretKey, systemClock } from '@fixtriage/platform';
import { createHandlers, PEER_HEADER, route } from './handlers';

let handlers: ReturnType<typeof createHandlers> | null = null;

export function getHandlers(): ReturnType<typeof createHandlers> {
  if (handlers) return handlers;
  const c = loadConfig();
  const tz = checkTimezoneData(); // B1-008; /readyz also reports it
  if (!tz.ok) throw new Error(`tzdata check failed: ${tz.reason}`);
  handlers = createHandlers({
    database: createDatabase(c.DATABASE_URL),
    clock: systemClock,
    messaging: new FakeMessagingProvider(),
    classifier: new FakeClassifier(),
    // B2: object storage over the S3 API (MinIO locally) and staff mail over SMTP (Mailpit locally), by settings.
    storage: createStorage(c),
    mailer: createMailer(c),
    totpKey: parseSecretKey(c.TOTP_ENCRYPTION_KEY),
    publicBaseUrl: c.PUBLIC_BASE_URL,
    pagingFromNumber: c.PAGING_FROM_NUMBER,
    twilioAuthToken: c.TWILIO_AUTH_TOKEN,
    postmarkSecret: c.POSTMARK_INBOUND_SECRET,
    trustedProxies: c.TRUSTED_PROXIES,
  });
  return handlers;
}

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const r = route(getHandlers(), req.method, url.pathname);
  if (!r) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'not_found', correlation_id: null } }), { status: 404, headers: { 'content-type': 'application/json' } });
  // The peer address comes only from the entry point (src/serve.ts), which overwrites the header on every request.
  return r.handler(req, r.params, req.headers.get(PEER_HEADER) || undefined);
}

let checkInStarted = false;
/** web's check-in to the external monitor every 60 s (MH-16a). */
export function startWebCheckIn(): void {
  if (checkInStarted) return;
  checkInStarted = true;
  const c = loadConfig();
  if (!c.MONITOR_URL) return;
  const m = new HttpMonitorClient(c.MONITOR_URL);
  const beat = () => void m.checkIn('web').catch(() => undefined);
  beat();
  setInterval(beat, c.CHECKIN_INTERVAL_MS).unref();
}
