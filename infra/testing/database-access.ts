/** Loads the `database-access` Pulumi program so a test can read the resources
 * it constructs, instead of scraping its source text.
 *
 * `infra/database-access` is a SECOND Pulumi program, and its provider
 * dependency `@pulumi/neon` resolves from `file:sdks/neon` — a bridged SDK
 * `pulumi install` generates at release time and `.gitignore` keeps out of the
 * repo. So a test process has no `@pulumi/neon` to import, and every existing
 * test of that program pins its derivations by reading the declaration text
 * (`topology-prod-database-access.test.ts`).
 *
 * Declaration text cannot see what a CALL SITE passes, which is exactly how
 * #1940 shipped: it replaced four inline `new cloudflare.SecretsStoreSecret`
 * blocks with a factory that reused one string as both the Pulumi logical name
 * and the store's real `name`, and for those four the two were never equal.
 * Nothing in the text said so, and the next staging apply renamed
 * `CATALOG_ADMIN_TOKEN` — a delete-and-recreate — leaving the deploy to die on
 * a missing Secrets Store binding.
 *
 * This module doubles the three Neon SDK members the program uses and registers
 * a `node:module` resolve hook serving this same file in `@pulumi/neon`'s place.
 * The hook is scoped to that one specifier in this process, and the double only
 * feeds the program's provider handle: the store secrets' `name` inputs, which
 * the tests read, are composed by the program itself.
 */
import { registerHooks } from "node:module";
import * as pulumi from "@pulumi/pulumi";
import { drainRegistration, type Built } from "./harness.ts";
import { runtimeConfig } from "./runtime-secrets.ts";

/** `database-access/Pulumi.yaml`'s project name — the persisted state identity,
 * and the prefix `setMocks`/`setAllConfig` key the program's config by. */
const PROJECT = "animichi-neon-secrets";

const NEON_SPECIFIER = "@pulumi/neon";
const RANDOM_PASSWORD_TYPE = "random:index/randomPassword:RandomPassword";
const ROLE_TYPE = "neon:index/role:Role";

/** The read-write endpoint the DSNs compose against. The program requires
 * exactly one `read_write` entry and throws without it. */
const BRANCH_HOST = "branch-host-fixture";

/** The Neon provider, in the one member the program uses. */
export class Provider extends pulumi.ProviderResource {
  constructor(name: string, args: pulumi.Inputs, opts?: pulumi.ResourceOptions) {
    super("neon", name, args, opts);
  }
}

/** A Neon role. The real provider computes `password`; the program reads it to
 * compose each DSN, so the double seals a fixture there. */
export class Role extends pulumi.CustomResource {
  public readonly password: pulumi.Output<string>;

  constructor(name: string, args: pulumi.Inputs, opts?: pulumi.ResourceOptions) {
    super(ROLE_TYPE, name, args, opts);
    this.password = pulumi.secret("role-password-fixture");
  }
}

/** The branch endpoints the program reads through the provider. */
export function getBranchEndpointsOutput(
  _args: pulumi.Inputs,
  _opts?: pulumi.InvokeOptions,
): pulumi.Output<{ endpoints: { type: string; host: string }[] }> {
  return pulumi.output({ endpoints: [{ type: "read_write", host: BRANCH_HOST }] });
}

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === NEON_SPECIFIER
      ? { url: new URL("./database-access.ts", import.meta.url).href, shortCircuit: true }
      : nextResolve(specifier, context),
});

/** Every key the program requires, plus the three optional Auth keys that gate
 * `NEON_AUTH_JWKS_URL` / `QA_NEON_USER_EMAIL` / `QA_NEON_USER_PASSWORD` — set,
 * so the test pins the whole graph rather than the stacks' shared subset.
 *
 * `index.ts` also re-exports `runtime-secrets.ts`, whose keys and fixtures the
 * other testing harness owns; its config is merged in rather than repeated. */
function stackConfig(): Record<string, string> {
  const own = Object.fromEntries(
    Object.entries({
      neonProjectId: "project-fixture",
      neonBranchId: "branch-fixture",
      neonApiKey: "neon-api-key-fixture",
      neonAuthBaseUrl: "https://branch.neonauth.example.test/neondb/auth",
      qaNeonUserEmail: "qa-bot@animichi.test",
      qaNeonUserPassword: "qa-password-fixture",
    }).map(([key, value]) => [`${PROJECT}:${key}`, value]),
  );
  return { ...runtimeConfig(), ...own };
}

/** What a mock resource returns: the inputs it was constructed with, plus the
 * provider-read output the real `random` provider adds. */
function mockState(type: string, inputs: Record<string, unknown>): Record<string, unknown> {
  return type === RANDOM_PASSWORD_TYPE ? { ...inputs, result: "password-fixture" } : inputs;
}

/** Build the program for `stack` under Pulumi mocks; returns every resource it
 * declared, in construction order. The process can load the program once, so a
 * test file builds exactly one stack — see `harness.ts`. */
export async function buildDatabaseAccess(stack: string): Promise<Built[]> {
  const built: Built[] = [];
  pulumi.runtime.setMocks(
    {
      newResource: (args: pulumi.runtime.MockResourceArgs) => {
        built.push({ type: args.type, name: args.name, inputs: args.inputs });
        return { id: `${args.name}-id`, state: mockState(args.type, args.inputs) };
      },
      call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
    },
    PROJECT,
    stack,
    false,
  );
  pulumi.runtime.setAllConfig(stackConfig());
  // Non-literal on purpose: `@pulumi/neon` has no types on disk here, so a
  // static import would fail the test tsconfig's typecheck. The resolve hook
  // above is what makes this specifier loadable at all.
  const program = new URL("../database-access/index.ts", import.meta.url).href;
  await import(program);
  await drainRegistration(built);
  return built;
}
