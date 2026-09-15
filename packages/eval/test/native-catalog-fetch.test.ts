import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredCatalog } from '../src/native/catalog-fetch.ts';

const POINT = { id: 'a', name: 'Station', bangumi_id: '123', screenshot_url: '', latitude: 35, longitude: 139 };
const ARGS = { lat: 35.8, lng: 139.2, radius_m: 500 };

type Transport = (request: Request) => Promise<Response>;

function jsonRows(rows: unknown[], status = 200) {
  return Promise.resolve(Response.json({ rows, synced_at: '2026-09-10' }, { status }));
}

/** The production ORPC client against an injected egress so no catalog is contacted. */
async function nearby(origin: string, transport: Transport) {
  const catalog = configuredCatalog(origin, (input) => transport(new Request(input)));
  return await catalog.nearby(ARGS, { signal: AbortSignal.timeout(5_000) });
}

/** The URL the production client requested from `origin`, with egress injected. */
async function requestedUrl(origin: string): Promise<string | undefined> {
  const requests: Request[] = [];
  await nearby(origin, (request) => {
    requests.push(request);
    return jsonRows([]);
  });
  return requests[0]?.url;
}

void test('the production catalog client reaches a configured origin with its POST body intact', async () => {
  const requests: Request[] = [];
  const rows = await nearby('https://catalog.example.com', (request) => {
    requests.push(request);
    return jsonRows([{ ...POINT, distance_m: 10 }]);
  });
  assert.deepEqual(rows.rows.map((row) => row.id), ['a']);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, 'https://catalog.example.com/catalog/nearby');
  assert.equal(request.method, 'POST');
  assert.deepEqual(await request.json(), ARGS);
});

void test('a configured origin path prefix is preserved', async () => {
  const requests: Request[] = [];
  await nearby('https://catalog.example.com/gateway/v2/', (request) => {
    requests.push(request);
    return jsonRows([]);
  });
  assert.equal(requests[0]?.url, 'https://catalog.example.com/gateway/v2/catalog/nearby');
});

void test('a localhost catalog origin is accepted over local HTTP', async () => {
  assert.equal(await requestedUrl('http://localhost:8787'), 'http://localhost:8787/catalog/nearby');
});

void test('a loopback IPv4 catalog origin is accepted over local HTTP', async () => {
  assert.equal(await requestedUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/catalog/nearby');
});

void test('a loopback IPv6 catalog origin is accepted over local HTTP', async () => {
  assert.equal(await requestedUrl('http://[::1]:8787'), 'http://[::1]:8787/catalog/nearby');
});

void test('a remote catalog origin is refused over HTTP', async () => {
  await assert.rejects(nearby('http://catalog.example.com', () => jsonRows([])),
    /CATALOG_API_URL must be HTTPS or local HTTP/);
});

void test('a configured origin cannot carry credentials or query state', async () => {
  await assert.rejects(nearby('https://user:secret@catalog.example.com', () => jsonRows([])),
    /CATALOG_API_URL cannot carry credentials or query state/);
  await assert.rejects(nearby('https://catalog.example.com?token=secret', () => jsonRows([])),
    /CATALOG_API_URL cannot carry credentials or query state/);
  await assert.rejects(nearby('https://catalog.example.com#fragment', () => jsonRows([])),
    /CATALOG_API_URL cannot carry credentials or query state/);
});

void test('a catalog redirect is refused instead of being followed off the configured origin', async () => {
  const seen: Request[] = [];
  await assert.rejects(nearby('https://catalog.example.com', (request) => {
    seen.push(request);
    return Promise.resolve(Response.json({ rows: [] }, { status: 302, headers: { location: 'https://evil.example.com/' } }));
  }), /Catalog redirects are not permitted/);
  assert.equal(seen[0]?.redirect, 'manual');
});
