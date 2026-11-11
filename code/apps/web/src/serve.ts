// Web entry point (security round, item 2): a Node HTTP server in front of Next.js that records the direct TCP peer
// address in PEER_HEADER, overwriting any value the client sent, so the per-client sign-in limit never trusts a
// client-supplied header. `npm run dev` starts web through this file; production must start it the same way.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { PEER_HEADER } from './handlers';

const port = Number(process.env.WEB_PORT ?? 8109);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, dir: fileURLToPath(new URL('..', import.meta.url)), port, hostname: '0.0.0.0' });
const handle = app.getRequestHandler();
await app.prepare();
createServer((req, res) => {
  req.headers[PEER_HEADER] = req.socket.remoteAddress ?? '';
  void handle(req, res);
}).listen(port, () => console.log(`web: listening on ${port}`));
