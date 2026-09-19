import * as pulumi from "@pulumi/pulumi";
import type { Built } from "./harness.ts";

/** Every store secret the runtime provisions; the wrangler bindings contract
 * (`topology-runtime-secret-bindings.test.ts`) reads this same list. */
export const RUNTIME_KEYS = [
  "MIMO_API_KEY", "ZEN_GO_API_KEY",
  "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN", "TURNSTILE_SECRET", "ANON_ID_SECRET",
  "INGEST_SIGNING_KEY",
];

/** The runtime keys whose authority lives OUTSIDE this program, so they arrive
 * as secret stack config (ESC `fn::secret`) and are never generated here.
 *
 * "No provider can mint them" described the first four and got mistaken for the
 * category. `INGEST_SIGNING_KEY` (#1792) is a value this program could mint and
 * must not: the egress service in Fly holds the copy that counts — it verifies
 * what catalog signs, and Pulumi does not manage it. A generated second copy
 * would make Pulumi the authority for a value another system already holds, and
 * the two would drift a rotation apart; that surfaces at the consumer as a 401,
 * never as a failed deploy. What unites the category is where the authority is,
 * not who could compute the bytes. The remaining keys are generated (#1676) or
 * read from a provider. */
export const VENDOR_KEYS = [
  "MIMO_API_KEY", "ZEN_GO_API_KEY", "GOOGLE_MAPS_API_KEY", "LOGFIRE_TOKEN",
  "INGEST_SIGNING_KEY",
];

/** The account's single Turnstile widget, as the provider reports it. The site
 * key is pinned here because an adoption that changed it would silently break
 * every deployed challenge (AC6). */
export const TURNSTILE_WIDGET_SITEKEY = "0x4AAAAAAD-SYZJEDljOH-SB";
export const TURNSTILE_WIDGET_SECRET = "widget-secret-fixture";
export const GENERATED_IDENTITY_SEED = "generated-identity-seed-fixture";

const TURNSTILE_WIDGET_TYPE = "cloudflare:index/turnstileWidget:TurnstileWidget";
const RANDOM_PASSWORD_TYPE = "random:index/randomPassword:RandomPassword";
const TURNSTILE_DATA_SOURCE = "cloudflare:index/getTurnstileWidget:getTurnstileWidget";

/** Wrap a fixture the way the provider marks a sensitive output. */
function secret(value: string): Record<string, unknown> {
  return { [pulumi.runtime.specialSigKey]: pulumi.runtime.specialSecretSig, value };
}

/** What a mock resource returns: the constructed inputs plus the provider-read
 * outputs the real provider would add. */
function mockState(type: string, inputs: Record<string, unknown>): Record<string, unknown> {
  if (type === TURNSTILE_WIDGET_TYPE) {
    return { ...inputs, sitekey: TURNSTILE_WIDGET_SITEKEY, secret: secret(TURNSTILE_WIDGET_SECRET) };
  }
  if (type === RANDOM_PASSWORD_TYPE) return { ...inputs, result: secret(GENERATED_IDENTITY_SEED) };
  return inputs;
}

export function runtimeConfig(): Record<string, string> {
  return Object.fromEntries([
    ["animichi-neon-secrets:cloudflareAccountId", "account-fixture"],
    ["animichi-neon-secrets:secretsStoreId", "store-fixture"],
    ["animichi-neon-secrets:anonymousAccessEnabled", "true"],
    ...VENDOR_KEYS.map((name) => [`animichi-neon-secrets:${name}`, `fixture-${name}`]),
  ]);
}

function installMocks(stack: string, built: Built[]): void {
  pulumi.runtime.setMocks({
    newResource: (args: pulumi.runtime.MockResourceArgs) => {
      built.push({ type: args.type, name: args.name, inputs: args.inputs, id: args.id });
      return { id: `${args.name}-id`, state: mockState(args.type, args.inputs) };
    },
    call: (args: pulumi.runtime.MockCallArgs) => args.token.includes(TURNSTILE_DATA_SOURCE)
      ? { ...args.inputs, sitekey: TURNSTILE_WIDGET_SITEKEY, secret: TURNSTILE_WIDGET_SECRET }
      : args.inputs,
  }, "animichi-neon-secrets", stack, false);
}

export async function buildRuntimeSecrets(stack: string, config = runtimeConfig()): Promise<Built[]> {
  const resources: Built[] = [];
  installMocks(stack, resources);
  pulumi.runtime.setAllConfig(config);
  const program = await import("../database-access/runtime-secrets.ts");
  await new Promise((resolve) => program.edgeRuntimeSecretNames.apply(resolve));
  return resources;
}

/** The Secrets Store secrets among `resources`; the graph also holds the
 * adopted widget and the generated identity seed. */
export function storeSecrets(resources: Built[]): Built[] {
  return resources.filter((resource) => resource.type === "cloudflare:index/secretsStoreSecret:SecretsStoreSecret");
}

/** One provisioned store secret by its logical name, or a bare assertion error. */
export function storeSecret(resources: Built[], name: string): Built {
  const secret = storeSecrets(resources).find((resource) => resource.name === name);
  if (secret === undefined) throw new Error(`no runtime secret named ${name}`);
  return secret;
}
