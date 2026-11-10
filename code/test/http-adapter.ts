// Serves the web handlers over real HTTP for tests that probe from outside (IT-16).
import { createServer, type Server } from 'node:http';
import { route } from '../apps/web/src/handlers';
import type { Harness } from './helpers';

export function serve(h: Harness): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = route(h.handlers, req.method ?? 'GET', req.url ?? '/');
    if (!r) return void res.writeHead(404).end();
    const out = await r.handler(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), r.params);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    }),
  );
}
