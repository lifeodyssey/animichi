import { Miniflare, createFetchMock } from "miniflare";
import type { JWK } from "jose";
import { nativeModules } from "./prisma-bundle";
import { postgresHttp } from "./prisma-postgres";
import { GITHUB_OIDC_JWKS_URL } from "../../src/policy";

/**
 * How long the next Postgres round trip takes to answer (#1868). A migration is slow for one
 * reason on staging — round trips, at whatever latency separates the Worker from Neon; the
 * container pinning that cut a hop from 208 ms to 74 ms is the same fact from the other end.
 * Setting this models that cause faithfully while keeping the SQL, the graph and the database
 * real, and it is the only way to put an apply on the far side of the platform's 30-second
 * blocked-callback cap without a migration that genuinely takes half a minute.
 */
export interface UpstreamLatency {
  nextRoundTripMs: number;
}

/** Spends the owed latency once: what is set applies to the next round trip and no others. */
function spendLatency(latency: UpstreamLatency): Promise<void> {
  const owed = latency.nextRoundTripMs;
  latency.nextRoundTripMs = 0;
  return new Promise((answered) => setTimeout(answered, owed));
}

export async function startPrismaWorker(directory: string, dsn: string, jwk: JWK) {
  const latency: UpstreamLatency = { nextRoundTripMs: 0 };
  const mock = createFetchMock();
  mock.disableNetConnect();
  const jwksUrl = new URL(GITHUB_OIDC_JWKS_URL);
  mock.get(jwksUrl.origin).intercept({ path: jwksUrl.pathname }).reply(200, { keys: [jwk] }).persist();
  mock.get(/https:\/\//).intercept({ path: "/sql", method: "POST" }).reply(200, async (options) => {
    await spendLatency(latency);
    const headers = new Headers(options.headers as Record<string, string>);
    const body = await new Response(options.body as BodyInit).text();
    const response = await postgresHttp(dsn, headers, body);
    return response.text();
  }).persist();
  const worker = new Miniflare({ modules: await nativeModules(directory), modulesRoot: directory,
    compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"], port: 0, inspectorPort: 0,
    bindings: { ENVIRONMENT: "staging", MIGRATOR_DATABASE_URL: dsn }, fetchMock: mock,
    durableObjects: { MIGRATOR_APPLY_LOCK: { className: "MigratorApplyLock", useSQLite: true } },
  });
  const close = async () => { await worker.dispose(); await mock.close(); };
  try {
    await worker.ready;
    return { worker, close, latency };
  } catch (error) {
    await close();
    throw error;
  }
}
