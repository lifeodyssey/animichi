import worker from "../src/index";
import type { Env } from "../src/index";
import { stubEgressSigningKey } from "./egress-stub";

const CTX = {} as ExecutionContext;

/**
 * The env a full-app request runs with. Every deployed environment carries an
 * anitabi egress signing key (#1792) — the anitabi fetchers refuse without one —
 * so the suite supplies a freshly generated key unless the caller sets its own.
 * Generated per call: no key value lives in this tree.
 */
export function catalogRequest(path: string, init: RequestInit = {}, env: Env = {}): Promise<Response> {
  const configured: Env = { INGEST_SIGNING_KEY: stubEgressSigningKey(), ...env };
  return Promise.resolve(
    worker.fetch(new Request(new URL(path, "http://catalog.example"), init), configured, CTX),
  );
}
