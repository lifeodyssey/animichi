/**
 * A preflight of the sealed release, as far as a machine with no database lets it go. Identity,
 * the bundle handshake, the Atlas-ledger probe and Prisma control's first load all run in workerd;
 * Prisma's connection then fails on a loopback port nothing listens on, so no request or
 * connection leaves the machine.
 *
 * The Worker reaches outside workerd twice before Prisma connects: for GitHub's signing keys, and
 * for Neon's answer to the ledger probe. Both are answered here, the second as a database that
 * never carried the retired Atlas chain; any other request is refused, named.
 */
import type { JWK } from "jose";
import { Response as WorkerResponse, type Request as WorkerRequest } from "miniflare";
import { GITHUB_OIDC_JWKS_URL } from "../src/policy";
import { issuedToken } from "./migrate.worker.helpers";
import { bootSealedMigrator } from "./sealed-bundle";
import { requestMetadata } from "./sealed-migrations";

/** A direct DSN on a loopback port nothing listens on. The host is a name rather than an address
 * because the Neon driver swaps a host's first label for `api.` to find its HTTP endpoint, and
 * `api.0.0.1` is no URL; `localhost`, with no label to swap, reaches the ledger answer below. */
const UNREACHABLE_DSN = "postgresql://fixture:fixture@localhost:1/neondb";

/** Neon's answer to the ledger query of the leftovers check (`src/atlas-leftovers.ts`) on a database
 * with no ledger: one text column, one row, NULL. */
const NO_ATLAS_LEDGER = { results: [{ fields: [{ name: "ledger", dataTypeID: 25 }], rows: [[null]] }] };

function answersPreflight(jwk: JWK) {
  return (request: WorkerRequest): Promise<WorkerResponse> => {
    const url = new URL(request.url);
    if (url.href === GITHUB_OIDC_JWKS_URL) return Promise.resolve(WorkerResponse.json({ keys: [jwk] }));
    if (url.pathname === "/sql") return Promise.resolve(WorkerResponse.json(NO_ATLAS_LEDGER));
    throw new Error(`the sealed preflight made an unexpected request: ${request.method} ${request.url}`);
  };
}

/** Boots the shared release with what a preflight needs, sends one, and stops the runtime. */
export async function preflightSealedMigrator(): Promise<{ status: number; body: unknown }> {
  const { token, jwk } = await issuedToken();
  const sealed = await bootSealedMigrator({ bindings: { MIGRATOR_DATABASE_URL: UNREACHABLE_DSN }, outboundService: answersPreflight(jwk) });
  try {
    const response = await sealed.worker.dispatchFetch("https://migrator.test/preflight", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(requestMetadata) });
    return { status: response.status, body: await response.json() };
  } finally {
    await sealed.close();
  }
}
