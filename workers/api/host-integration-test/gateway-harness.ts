import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { Miniflare } from "miniflare";
import { bundleLikeWrangler, deployedRuntime } from "../bundle-smoke/wrangler-bundle.ts";
import { TEST_ANON_SECRET } from "../test/doubles/signed-anonymous-cookie.ts";
import { dsn } from "./postgres.ts";

/** The deployed entry point itself (`wrangler.toml` `main`): the gateway that
 *  verifies identity, guards the route and adopts the sessions. The doubled
 *  `default-host.worker.ts` next door injects an already-verified identity for
 *  the chat lanes; this harness doubles nothing, so the browser meets the real
 *  `POST /v1/sessions/adopt` — cookie resolution, JWT verification, rate
 *  guard, ownership `UPDATE` and marker insert included. */
const ENTRY = new URL("../src/entry.ts", import.meta.url).pathname;

/** Neon Auth is an external identity provider, scripted like the model and
 *  catalog boundaries around it. The JWKS it publishes is a real EdDSA
 *  document and the JWT it hands the app is signed by the same key, so the
 *  edge's verification is exercised rather than bypassed. */
const NEON_AUTH_ORIGIN = "https://neon-auth.host-integration";
const JWKS_URL = `${NEON_AUTH_ORIGIN}/neondb/auth/.well-known/jwks.json`;

export interface GatewayHarness {
  readonly worker: Miniflare;
  /** The origin the app's Neon Auth SDK talks to (scripted IdP). */
  readonly neonAuthOrigin: string;
  /** The verified subject the minted JWT carries. */
  readonly accountId: string;
  /** Every outbound fetch the gateway made, in order. */
  readonly egress: Request[];
}

async function accountToken(accountId: string): Promise<{ jwk: JWK; token: string }> {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "host-integration-account" };
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
    .setIssuer(NEON_AUTH_ORIGIN).setAudience(NEON_AUTH_ORIGIN).setSubject(accountId)
    .setIssuedAt().setExpirationTime("15m").sign(pair.privateKey);
  return { jwk, token };
}

function sessionBody(accountId: string): string {
  return JSON.stringify({
    session: { id: "host-integration-session", userId: accountId, token: "" },
    user: { id: accountId, email: "fan@example.com" },
  });
}

function corsHeaders(origin: string | undefined, token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "set-auth-jwt": token,
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": "set-auth-jwt",
    vary: "origin",
  };
}

/** The one Neon Auth endpoint the SDK needs: `GET /api/auth/get-session`,
 *  answering with the `set-auth-jwt` header the SDK turns into `session.token`. */
async function neonAuthProvider(accountId: string, token: string) {
  const server = createServer((request, response) => {
    response.writeHead(200, corsHeaders(request.headers.origin, token));
    response.end(sessionBody(accountId));
  });
  await new Promise<void>((listening) => { server.listen(0, "127.0.0.1", listening); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the Neon Auth double bound no port");
  return { origin: `http://127.0.0.1:${String(address.port)}`, close: () => new Promise<void>((closed) => { server.close(() => { closed(); }); }) };
}

/** The external boundaries the production gateway reaches: the auth JWKS and
 *  Cloudflare's Turnstile siteverify. Anything else is an unscripted egress
 *  and answers 500 so the case names it instead of hanging. */
function externalBoundary(request: Request, jwk: JWK, egress: Request[]): Promise<Response> {
  egress.push(request.clone());
  if (request.url === JWKS_URL) return Promise.resolve(Response.json({ keys: [jwk] }));
  if (request.url.startsWith("https://challenges.cloudflare.com/")) return Promise.resolve(Response.json({ success: true }));
  return Promise.resolve(new Response("unscripted egress", { status: 500 }));
}

function bindings(): Record<string, string> {
  return {
    AGENT_SVC_DATABASE_URL: dsn,
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: TEST_ANON_SECRET,
    TURNSTILE_SECRET: "host-integration-turnstile",
    EDGE_SHOWCASE_MODE: "false",
    ANON_DAILY_MESSAGE_QUOTA: "2",
    MIMO_API_KEY: "host-integration-model",
    NEON_AUTH_JWKS_URL: JWKS_URL,
  };
}

/** Boot the real entry on this arm's disposable database. */
export async function gatewayWorker(context: TestContext, accountId: string): Promise<GatewayHarness> {
  const directory = await mkdtemp(join(tmpdir(), "gateway-host-"));
  const outfile = join(directory, "entry.js");
  await bundleLikeWrangler(ENTRY, outfile);
  const { jwk, token } = await accountToken(accountId);
  const provider = await neonAuthProvider(accountId, token);
  const egress: Request[] = [];
  const worker = new Miniflare({
    modulesRoot: directory, modules: [{ type: "ESModule", path: outfile }], ...deployedRuntime(),
    bindings: bindings(), durableObjectsPersist: join(directory, "state"),
    durableObjects: { EDGE_GUARD: { className: "EdgeGuard", useSQLite: true }, AGENT_SESSION: { className: "AgentSession", useSQLite: true } },
    outboundService: (request: Request) => externalBoundary(request, jwk, egress),
  });
  context.after(async () => {
    await worker.dispose();
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  });
  await worker.ready;
  return { worker, neonAuthOrigin: provider.origin, accountId, egress };
}
