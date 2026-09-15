import { createCatalogClient } from '@animichi/agent/tools';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Adapt the production internal catalog URL to a local or explicitly configured origin. */
export function configuredCatalog(baseValue: string, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const base = catalogBase(baseValue);
  return createCatalogClient(async (request) => fetch(await rewriteRequest(request, base)));
}

function catalogBase(value: string): URL {
  const base = new URL(value);
  const localHttp = base.protocol === 'http:' && LOCAL_HOSTS.has(base.hostname);
  if (base.protocol !== 'https:' && !localHttp) throw new Error('CATALOG_API_URL must be HTTPS or local HTTP');
  if (base.username || base.password || base.search || base.hash) throw new Error('CATALOG_API_URL cannot carry credentials or query state');
  return base;
}

/** The body is buffered: relaying a `ReadableStream` needs Node's `duplex` request flag. */
async function requestBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  return await request.arrayBuffer();
}

async function rewriteRequest(request: Request, base: URL): Promise<Request> {
  const source = new URL(request.url);
  const target = new URL(base.href);
  target.pathname = `${base.pathname.replace(/\/$/, '')}${source.pathname}`;
  target.search = source.search;
  return new Request(target, {
    method: request.method,
    headers: new Headers(request.headers),
    body: await requestBody(request),
    signal: request.signal,
    redirect: 'manual',
  });
}
