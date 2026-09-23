import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as neon from "@pulumi/neon";
import * as random from "@pulumi/random";
export { edgeRuntimeSecretNames } from "./runtime-secrets.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Database access provisioning — ADR 0003 / #912 PR1, amended by #1915.
// Pulumi.yaml retains the original project name as a persisted state identity;
// changing it requires an explicit cross-project stack migration.
//
// Manages, for one Neon branch (the branch is stack config: staging =
// Pulumi.staging.yaml, production = Pulumi.prod.yaml):
//   - Credentials for the data-plane service roles. Since #1915 the three
//     runtime roles (`catalog_svc`, `users_svc`, `agent_svc`) are NOT
//     `neon.Role` resources: Neon grants `neon_superuser` to every role its
//     Console, CLI or API creates, and only Neon's own `cloud_admin` can revoke
//     that membership, so an API-created runtime DSN read and wrote every
//     table. This stack therefore provisions only what a credential needs —
//     each role's `random.RandomPassword`, the DSN composed from it, and the
//     password itself — and the migrator Worker creates the roles BY SQL on
//     every `/migrate`, before the chain
//     (`workers/migrator/src/service-roles.ts`; SQL-created roles receive no
//     membership). Staging note: its API-created roles die with the
//     `neon.Role` resources this stack used to hold — deleting the resource
//     deletes the role and the chain's grants die with it — and the first
//     post-merge `/migrate` recreates them SQL-side (rollout in the PR of
//     #1915). Production holds no roles yet and simply starts right.
//   - A Cloudflare Secrets Store holding one secret per component DSN,
//     composed from the role password + branch endpoint host, plus one secret
//     per runtime role password (bound to the migrator Worker alone; the
//     isolation is machine-asserted by `migrator-role-isolation.test.ts`).
//     PR2/PR3 declare the wrangler.toml Secrets Store bindings (staging base
//     names; prod "_PROD"-suffixed names, see secretNameSuffix below).
//
//     Store creation note: the account already has Cloudflare's built-in
//     `default_secrets_store`, and the account plan refuses a second store
//     (`maximum_stores_exceeded`, HTTP 400 code 1003). This stack therefore
//     IMPORTS the account's default store (`secretsStoreId` config) instead
//     of creating one; the store name is only the logical resource name here.
//     Staging and production SHARE this single store, which is exactly why the
//     production DSN secrets carry a "_PROD" suffix.
//
//     RETENTION-1 (#940): the staging retention role and its store secret are
//     retired from this stack — deleting the role resource removes the staging
//     retention grants with it (grants die with the role), while the immutable
//     role/grant migrations keep the SAFE-1-pinned production surface.
//
// The DSN host/db follow the environment's NEON_DATABASE_URL: branch endpoint,
// database `neondb`, sslmode=require.
// ─────────────────────────────────────────────────────────────────────────────

const config = new pulumi.Config();

const projectId = config.require("neonProjectId");
const branchId = config.require("neonBranchId");
const accountId = config.require("cloudflareAccountId");
const databaseName = config.get("databaseName") ?? "neondb";
const secretsStoreName = config.get("secretsStoreName") ?? "animichi-secrets";

const secretsStoreId = config.require("secretsStoreId");

// #1048 production runtime DSNs: staging and production share the account's
// single default Secrets Store, so the store-secret NAMES must not collide
// across stacks. Production appends a "_PROD" suffix to each role DSN secret;
// staging keeps the base names (#912) so the adopted staging resources and
// their wrangler.toml bindings are untouched. Derived from the Pulumi stack
// name ("prod"), so the staging stack is behaviorally byte-identical.
const secretNameSuffix = pulumi.getStack() === "prod" ? "_PROD" : "";

const neonProvider = new neon.Provider("neon", {
  apiKey: config.requireSecret("neonApiKey"),
});

// Role -> secret mapping (#832): these names are bound directly from the
// Cloudflare Secrets Store (plus the _PROD suffix for prod).
//
// agent_svc DSN (#912 follow-up): the edge Worker binds AGENT_SVC_DATABASE_URL
// from the Secrets Store and the native agent tier resolves it directly.
const roleDefs: {
  name: string;
  secretName: string;
  passwordSecretName: string;
  comment: string;
}[] = [
  {
    name: "catalog_svc",
    secretName: "CATALOG_DATABASE_URL",
    passwordSecretName: "CATALOG_SVC_PASSWORD",
    comment: "catalog Worker DATABASE_URL (runtime role DSN)",
  },
  {
    name: "users_svc",
    secretName: "USERS_DATABASE_URL",
    passwordSecretName: "USERS_SVC_PASSWORD",
    comment: "users Worker DATABASE_URL (runtime role DSN)",
  },
  {
    name: "agent_svc",
    secretName: "AGENT_SVC_DATABASE_URL",
    passwordSecretName: "AGENT_SVC_PASSWORD",
    comment:
      "agent data-plane role DSN (edge Worker Secrets Store binding, read by the native agent tier)",
  },
];

// Since #1915, THIS stack decides the three runtime roles' passwords: generated
// here, never hand-typed, applied to the roles by the migrator's SQL step. Neon roles belong to a BRANCH (an earlier revision of
// this file and of docs/ops/prod-dsn-cutover.md said project-scoped), and the
// two stacks target different branches, so each stack provisions its own
// branch's credentials and no second stack can collide with it.
const runtimePasswords = roleDefs.map((def) =>
  new random.RandomPassword(def.name, {
    length: 40, special: false, minUpper: 1, minLower: 1, minNumeric: 1,
  }),
);

const host = neon
  .getBranchEndpointsOutput({ projectId, branchId }, { provider: neonProvider })
  .apply((result) => {
    const endpoints = result.endpoints ?? [];
    const rw = endpoints.find((e) => e.type === "read_write");
    if (rw === undefined) {
      throw new Error(`no read-write endpoint found for branch ${branchId}`);
    }
    return rw.host;
  });

const store = cloudflare.SecretsStore.get(
  secretsStoreName,
  `${accountId}/${secretsStoreId}`,
);

/** One secret in the account's shared Secrets Store, scoped to Workers.
 * `logicalName` is Pulumi's state identity, `realName` the name the store holds
 * and wrangler binds; four differ, and passing one string for both renames the
 * store secret — a delete-and-recreate, which is how #1940 lost CATALOG_ADMIN_TOKEN. */
function storeSecret(
  logicalName: string,
  realName: string,
  value: pulumi.Input<string>,
  comment: string,
): void {
  new cloudflare.SecretsStoreSecret(logicalName, {
    accountId,
    storeId: secretsStoreId,
    name: realName,
    value,
    scopes: ["workers"],
    comment,
  });
}

const dsnFor = (name: string, password: pulumi.Output<string>) =>
  pulumi.interpolate`postgresql://${name}:${password.apply(encodeURIComponent)}@${host}:5432/${databaseName}?sslmode=require`;

// The DSN secret names are the contract the runtime Workers' wrangler.toml
// binds (#832, #1048); they are unchanged by #1915. The password secrets sit
// beside them for the migrator alone. Every pair below passes the same string
// twice — #1941 split the factory's arguments because the four secrets further
// down (the admin token and the config-gated Auth three) are the ones whose
// logical name is not their real name.
roleDefs.forEach((def, i) => {
  storeSecret(
    `${def.secretName}${secretNameSuffix}`,
    `${def.secretName}${secretNameSuffix}`,
    dsnFor(def.name, runtimePasswords[i].result),
    def.comment,
  );
  storeSecret(
    `${def.passwordSecretName}${secretNameSuffix}`,
    `${def.passwordSecretName}${secretNameSuffix}`,
    runtimePasswords[i].result,
    `${def.name} password, applied to the role by the migrator's SQL step (#1915); bound to no runtime Worker`,
  );
});

// ── The migrator LOGIN (#1050) ──────────────────────────────────────────────
//
// #1050 — dedicated migrator role (Migration Executor, spec §"Database identity").
//
// `migrator` stays a Neon-API role — the one role left on this provider: the
// chain needs `neon_superuser`-grade power for `CREATE EXTENSION`
// (spec §4.8.5), and Neon grants that grade only through its API. The secret is
// deliberately NEVER bound by any runtime Worker or container env allowlist —
// it exists for the migration executor alone, and that isolation is
// machine-asserted (migrator-role-isolation contract test).
//
// Minimization is behavioral, three rules:
//  (1) single-purpose — it is never a runtime DSN for any service;
//  (2) non-resident — injected only into the migration container for the
//      seconds it runs, present in no Worker's standing environment;
//  (3) independently rotatable — a Neon role password unentangled from every
//      runtime credential (rotation path per ADR 0003).
//
// Roles are BRANCH-scoped in Neon (amended by #1915 — an earlier revision said
// project-scoped), so this stack provisions the `migrator` of THIS branch only;
// the staging and production stacks target different branches and each owns
// its own. GRANTs and ownership are branch-scoped too and shipped in the
// Prisma chain's baseline
// (packages/pi-session-neon/migrations/app/20260913T1711_data_plane_baseline/access.ts).
// The DSN here composes against THIS branch's
// read-write endpoint, so each stack writes its own: staging publishes
// MIGRATOR_DATABASE_URL against the staging branch and the prod stack
// (Pulumi.prod.yaml, #1048) publishes MIGRATOR_DATABASE_URL_PROD against the
// main-branch endpoint — the two names workers/migrator/wrangler.toml binds
// per environment (#1365). Both come from this one block; there is
// no production-only path that could drift from the staging one.
const migratorDef = {
  name: "migrator",
  secretName: "MIGRATOR_DATABASE_URL",
  comment: "dedicated migration-executor role DSN (#1050): single-purpose, non-resident, independently rotatable; bound to NO runtime worker or container (isolation asserted by contract test)",
} as const;

const migratorRole = new neon.Role(
  migratorDef.name,
  { projectId, branchId, name: migratorDef.name },
  { provider: neonProvider },
);

storeSecret(
  `${migratorDef.secretName}${secretNameSuffix}`,
  `${migratorDef.secretName}${secretNameSuffix}`,
  dsnFor(migratorDef.name, migratorRole.password),
  migratorDef.comment,
);

// ── Catalog admin token (system-health-audit 2026-08-26 §2.4/§3, #1217) ────
// CATALOG_ADMIN_TOKEN guards POST /catalog/admin/* (full-ingest, canary) but
// had never been provisioned in any environment, so the admin surface was a
// functional dead end. Generated here — never hand-typed, logged, or
// committed — and stored in the same shared Secrets Store as the DSN secrets
// above, under the same staging/prod "_PROD" naming split (secretNameSuffix).
const catalogAdminToken = new random.RandomPassword("catalog-admin-token", {
  length: 48,
  special: false,
});

storeSecret(
  `catalog-admin-token${secretNameSuffix}`,
  `CATALOG_ADMIN_TOKEN${secretNameSuffix}`,
  catalogAdminToken.result,
  "catalog admin command bearer token (system-health-audit 2026-08-26 §2.4, #1217)",
);

// ── Neon Auth declarations (AUTH-2 #950) ────────────────────────────────────
// The edge verifies JWTs against the branch's JWKS URL (its ONLY identity
// source since the hard cut). Declaring it here lets the deploy chain source
// the edge binding from the Secrets Store instead of the checked-in literal in
// workers/edge/wrangler.toml; it is DERIVED from the branch's Better Auth base
// URL so the operator sets one value, never two.
//
// The QA login creds provision the password user the E2E suite + local-login
// script use (Path A of docs/ops/auth-migration-neon.md §4). The password is a
// secret; the email is not.
//
// All three are config-gated (optional getters): stacks without the keys apply
// unchanged — nothing here is created until an operator sets them, so this is
// declaration, not provisioning.
//   pulumi config set neonAuthBaseUrl https://<branch>.neonauth.c-2..../neondb/auth
//   pulumi config set qaNeonUserEmail qa-bot@animichi.test
//   pulumi config set --secret qaNeonUserPassword <password>
const authBaseUrl = config.get("neonAuthBaseUrl");
if (authBaseUrl !== undefined) {
  storeSecret(
    "neon-auth-jwks-url",
    "NEON_AUTH_JWKS_URL",
    `${authBaseUrl.replace(/[/]+$/, "")}/.well-known/jwks.json`,
    "edge Neon Auth JWKS (derived from the branch auth base URL, AUTH-2 #950)",
  );
}

const qaNeonUserEmail = config.get("qaNeonUserEmail");
if (qaNeonUserEmail !== undefined) {
  storeSecret(
    "qa-neon-user-email",
    "QA_NEON_USER_EMAIL",
    qaNeonUserEmail,
    "Neon Auth QA login email (Path A, AUTH-2 #950)",
  );
}

const qaNeonUserPassword = config.getSecret("qaNeonUserPassword");
if (qaNeonUserPassword !== undefined) {
  storeSecret(
    "qa-neon-user-password",
    "QA_NEON_USER_PASSWORD",
    qaNeonUserPassword,
    "Neon Auth QA login password (secret; Path A, AUTH-2 #950)",
  );
}

// Exported for the wrangler.toml bindings (PR2/PR3) and operators.
export const secretsStoreNameOut = secretsStoreName;
export const secretNames = [
  ...roleDefs.map((def) => def.secretName),
  "MIGRATOR_DATABASE_URL",
].map((name) => `${name}${secretNameSuffix}`);
export const runtimePasswordSecretNames = roleDefs.map(
  (def) => `${def.passwordSecretName}${secretNameSuffix}`,
);
export const roleNames = [...roleDefs.map((def) => def.name), "migrator"];
export const authSecretNames = [
  "NEON_AUTH_JWKS_URL", "QA_NEON_USER_EMAIL", "QA_NEON_USER_PASSWORD",
] as const;
export const catalogAdminTokenSecretName = `CATALOG_ADMIN_TOKEN${secretNameSuffix}`;
