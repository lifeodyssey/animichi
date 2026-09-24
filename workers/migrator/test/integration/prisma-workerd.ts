import { Miniflare, Response as WorkerResponse, type Request as WorkerRequest } from "miniflare";
import type { JWK } from "jose";
import { nativeModules } from "./prisma-bundle";
import { postgresHttp } from "./prisma-postgres";
import { GITHUB_OIDC_JWKS_URL } from "../../src/policy";
import { SERVICE_ROLE_PASSWORDS } from "../service-role-passwords";

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
  const jwksUrl = new URL(GITHUB_OIDC_JWKS_URL);
  // The Postgres adapter's answer is forwarded whole, status included. The fetch mock this
  // replaces answered every SQL request 200, so a 400 authentication failure reached the Neon
  // driver as a success and its HTTP-error branch was never exercised — a double looser than
  // the boundary it stands for. The connection string travels in the header and is honored as
  // sent, so the #1915 role probes authenticate as the runtime roles they claim to be.
  const outboundService = async (request: WorkerRequest): Promise<WorkerResponse> => {
    const url = new URL(request.url);
    if (url.origin === jwksUrl.origin && url.pathname === jwksUrl.pathname) {
      return WorkerResponse.json({ keys: [jwk] });
    }
    if (url.pathname !== "/sql" || request.method !== "POST") {
      throw new Error(`the workerd mock answers the JWKS and /sql alone, not ${request.method} ${request.url}`);
    }
    await spendLatency(latency);
    // Miniflare's request carries undici's `Headers`; the adapter speaks the platform's own.
    const headers = new Headers([...request.headers.entries()]);
    const response = await postgresHttp(headers.get("Neon-Connection-String") ?? dsn, headers, await request.text());
    return new WorkerResponse(await response.text(), { status: response.status, headers: [...response.headers.entries()] });
  };
  const worker = new Miniflare({ modules: await nativeModules(directory), modulesRoot: directory,
    compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"], port: 0, inspectorPort: 0,
    bindings: {
      ENVIRONMENT: "staging", MIGRATOR_DATABASE_URL: dsn,
      CATALOG_SVC_PASSWORD: SERVICE_ROLE_PASSWORDS.catalogSvc,
      USERS_SVC_PASSWORD: SERVICE_ROLE_PASSWORDS.usersSvc,
      AGENT_SVC_PASSWORD: SERVICE_ROLE_PASSWORDS.agentSvc,
    }, outboundService,
    durableObjects: { MIGRATOR_APPLY_LOCK: { className: "MigratorApplyLock", useSQLite: true } },
  });
  const close = async () => { await worker.dispose(); };
  try {
    await worker.ready;
    return { worker, close, latency };
  } catch (error) {
    await close();
    throw error;
  }
}
