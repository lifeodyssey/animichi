/**
 * A staging-shaped origin for the deploy-evidence tests (#1695).
 *
 * It is not a mock of the gateway: it is the release's OWN gateway code
 * (`workers/edge/src/app.ts`, the same module `wrangler deploy` ships) served
 * over a real socket, so every transcript the recorder writes in these tests is
 * the answer the shipped code gives to a real HTTP request. The environment it
 * is served with declares NO container binding, which is exactly the state
 * #1596 AC5 asks about: a landing surface that reached for the container would
 * throw rather than answer.
 *
 * Modes exist only for the behaviours a broken deploy would show:
 *   gateway                 the shipped routes, unauthenticated
 *   container-serves-retired  `/v1/search/preview` answers 200, as the retired
 *                             container route did before #1666
 *   retired-absent          `/v1/search/preview` answers the gateway's own 404
 *                           envelope, which is the state #1597 AC3 asks for and
 *                           the one a retired path answers once the route is
 *                           removed before identity is read
 *   secret-header           `/healthz` answers 200 with a credential-shaped
 *                           `cf-ray` header, which is how a response field
 *                           could put a secret into a published artifact
 *   secret-key              `/healthz` answers 200 with a credential-shaped
 *                           body KEY, which is how an object key could put one
 *                           there instead
 *
 * `EVIDENCE_FIXTURE_LOG` appends one line per request — method, path, and
 * whether an Access header arrived — so a test can prove that a refused token
 * was never SENT.
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createWorkerApp } from '../../../../../../workers/edge/src/app.ts';

const mode = process.argv[2] ?? 'gateway';
const log = process.env.EVIDENCE_FIXTURE_LOG ?? '';
const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: 'absent' }) });
const env = { EDGE_SHOWCASE_MODE: 'false' };
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined };
const port = { value: 0 };

function note(request) {
  if (log === '') return;
  appendFileSync(log, `${request.method} ${request.url} access=${request.headers['cf-access-client-id'] !== undefined}\n`);
}

function retiredAnswer(response) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ results: [] }));
}

function absentAnswer(response) {
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { code: 'not_found', message: 'No route matches this request.' } }));
}

function secretKeyAnswer(response) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ [`ghp_${'A'.repeat(36)}`]: 'token-shaped-key' }));
}

function secretAnswer(response) {
  response.writeHead(200, { 'content-type': 'application/json', 'cf-ray': `8f2a1b3c4d5e6f70-AMS-ghp_${'A'.repeat(36)}` });
  response.end(JSON.stringify({ status: 'ok' }));
}

function requestHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (!['host', 'connection', 'accept-encoding'].includes(name) && typeof value === 'string') headers.set(name, value);
  }
  return headers;
}

async function respond(request, response) {
  note(request);
  if (mode === 'secret-header' && request.url === '/healthz') return secretAnswer(response);
  if (mode === 'secret-key' && request.url === '/healthz') return secretKeyAnswer(response);
  if (mode === 'container-serves-retired' && request.url.startsWith('/v1/search/preview')) return retiredAnswer(response);
  if (mode === 'retired-absent' && request.url.startsWith('/v1/search/preview')) return absentAnswer(response);
  const url = `http://127.0.0.1:${port.value}${request.url}`;
  const answer = await app.fetch(new Request(url, { method: request.method, headers: requestHeaders(request.headers) }), env, ctx);
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
}

const server = createServer((request, response) => {
  respond(request, response).catch((error) => {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end(String(error?.message ?? error));
  });
});

server.listen(0, '127.0.0.1', () => {
  port.value = server.address().port;
  console.log(`LISTENING ${port.value}`);
});
