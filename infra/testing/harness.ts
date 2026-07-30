/** Shared `setMocks` harness for the topology tests.
 *
 * `index.ts` creates its resources at module top level, so config and mocks
 * must be installed *before* it is imported, and a process can only load it
 * once. That is why each config permutation lives in its own test file rather
 * than in one file with several cases — see `topology-*.test.ts`.
 *
 * These tests never reach Cloudflare: `setMocks` intercepts every resource
 * construction and hands back the inputs, so what they assert on is exactly
 * what Pulumi would send.
 */

import * as pulumi from "@pulumi/pulumi";

/** One intercepted resource construction. */
export interface Built {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

/** Install mocks + stack config, then import `index.ts`. Returns every
 * resource the program declared, in construction order. */
export async function buildStack(
  stack: string,
  config: Record<string, string>,
): Promise<Built[]> {
  const built: Built[] = [];
  pulumi.runtime.setMocks(
    {
      newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}-id`, state: args.inputs };
      },
      call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
    },
    "seichijunrei-infra",
    stack,
    false,
  );
  // Pulumi reads config from a JSON blob keyed `<project>:<key>`.
  pulumi.runtime.setAllConfig(
    Object.fromEntries(
      Object.entries(config).map(([k, v]) => [`seichijunrei-infra:${k}`, v]),
    ),
  );
  await import("../index.ts");
  // Resource registration is async: `new cloudflare.X()` schedules an RPC that
  // reaches `newResource` on a later tick, so the array is still empty the
  // instant the import resolves. Drain until it stops growing.
  //
  // Three quiet ticks is a heuristic, and a slow enough registration could in
  // principle slip past it. What keeps that from becoming a silent pass is that
  // every test file asserts the PRESENCE of something before it asserts any
  // absence: `topology-disabled` requires the R2 bucket, and the other two
  // require the Custom Domain and three routes. A short read therefore fails
  // those first, loudly, rather than quietly satisfying "no www record here".
  // Do not add an absence-only test file without a presence anchor in it.
  for (let stable = 0; stable < 3; ) {
    const before = built.length;
    await new Promise((resolve) => setImmediate(resolve));
    stable = built.length === before ? stable + 1 : 0;
  }
  return built;
}

/** The single resource of `type`, or a failure naming what was actually built —
 * a bare "undefined is not an object" hides which resource went missing. */
export function only(built: Built[], type: string): Built {
  const hits = built.filter((r) => r.type === type);
  if (hits.length !== 1) {
    const seen = built.map((r) => `${r.type} ${r.name}`).join(", ") || "(nothing)";
    throw new Error(`expected exactly 1 ${type}, found ${hits.length}. Built: ${seen}`);
  }
  return hits[0];
}

export function ofType(built: Built[], type: string): Built[] {
  return built.filter((r) => r.type === type);
}

export interface Unsealed {
  isSecret: boolean;
  value: unknown;
}

/** Split a mock input into "was it marked secret" and the underlying value.
 *
 * Pulumi serializes a secret as `{[specialSigKey]: specialSecretSig, value}`.
 * Asserting on that wire shape is stronger than calling `isSecret()` on an
 * `Output`, because it is literally what the engine writes to state — which is
 * what ends up in the `pulumi stack export` that lands in R2.
 *
 * `isRpcSecret`/`unwrapRpcSecret` are Pulumi's own predicates for exactly this.
 * An earlier version inlined the two sentinel hashes as string literals, which
 * (a) duplicated protocol knowledge that upstream already exports and (b) made
 * gitleaks flag the file — reasonably, since a bare 32-hex constant is
 * indistinguishable from a key.
 */
export function unseal(input: unknown): Unsealed {
  const isSecret = pulumi.runtime.isRpcSecret(input);
  return { isSecret, value: isSecret ? pulumi.runtime.unwrapRpcSecret(input) : input };
}
