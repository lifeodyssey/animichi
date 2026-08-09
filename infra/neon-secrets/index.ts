import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as neon from "@pulumi/neon";

// ─────────────────────────────────────────────────────────────────────────────
// animichi-neon-secrets — ADR 0003 / #912 PR1.
//
// Manages, for one branch (staging):
//   - Neon service roles. The pre-existing roles were created by the SQL
//     migrations (migrations/neon/20260806120000_role_matrix_n1.sql) as
//     NOLOGIN roles WITHOUT a control-plane-stored password:
//       * reveal_password returns an empty password for them (200, len 0),
//       * reset_password refuses them (422 ROLE_PASSWORD_NOT_AVAILABLE), and
//       * the bridged provider has no password input (password is computed).
//     So the password can only be provisioned by CREATING the role via the
//     Neon API (auto-generated + stored password, LOGIN) — i.e. this stack
//     creates the roles, it does not import them. One-time bootstrap:
//       1. DELETE the SQL-created role via the Neon API (per branch; the
//          staging roles have no live consumers — the deploy chain still
//          falls back to the owner DSN until the Secrets Store binding lands,
//          and the staging environment has no CATALOG/USERS/AGENT_DATABASE_URL
//          secrets provisioned).
//       2. `pulumi up` — the role is created here with a Neon-generated
//          password that the provider can always read back (reveal_password).
//       3. Re-run the idempotent grant migration against the branch
//          (migrations/neon/20260809000001_roles.sql is a no-op once the role
//          exists; 20260809000030_grants.sql restores the role's GRANTs,
//          which die with the role).
//     Rollback: re-run the migrations to recreate the NOLOGIN roles and point
//     the deploy chain back at the owner DSN; the store/secrets are additive.
//   - A Cloudflare Secrets Store holding one secret per component DSN,
//     composed from the role password + branch endpoint host. PR2 declares
//     the wrangler.toml Secrets Store bindings.
//
//     Store creation note: the account already has Cloudflare's built-in
//     `default_secrets_store`, and the account plan refuses a second store
//     (`maximum_stores_exceeded`, HTTP 400 code 1003). This stack therefore
//     IMPORTS the account's default store (`secretsStoreId` config) instead
//     of creating one; the store name is only the logical resource name here.
//
// The DSN host/db follow the staging NEON_DATABASE_URL: same branch endpoint,
// database `neondb`, sslmode=require.
// ─────────────────────────────────────────────────────────────────────────────

const config = new pulumi.Config();

const projectId = config.require("neonProjectId");
const branchId = config.require("neonBranchId");
const accountId = config.require("cloudflareAccountId");
const databaseName = config.get("databaseName") ?? "neondb";
const secretsStoreName = config.get("secretsStoreName") ?? "animichi-secrets";

const secretsStoreId = config.require("secretsStoreId");

const neonProvider = new neon.Provider("neon", {
  apiKey: config.getSecret("neonApiKey"),
});

// Role -> staging secret mapping (#832): the secrets carry the same names the
// deploy chain passes to `wrangler secret put` today, so PR2 only needs to
// swap the source of the value. agent_svc gets no DSN yet — the agent
// container still connects via SUPABASE_DB_URL (follow-up in #912).
const roleDefs: { name: string; secretName?: string; comment: string }[] = [
  {
    name: "catalog_svc",
    secretName: "CATALOG_DATABASE_URL",
    comment: "catalog Worker DATABASE_URL (staging)",
  },
  {
    name: "users_svc",
    secretName: "USERS_DATABASE_URL",
    comment: "users Worker DATABASE_URL (staging)",
  },
  {
    name: "jobs_svc",
    secretName: "AGENT_DATABASE_URL",
    comment: "maintenance/jobs Worker DATABASE_URL (staging; binding name AGENT_DATABASE_URL per the deploy chain)",
  },
  {
    name: "agent_svc",
    comment: "agent data-plane role; no DSN yet — agent connects via SUPABASE_DB_URL (#912 follow-up)",
  },
];

const roles = roleDefs.map(
  (def) =>
    new neon.Role(
      def.name,
      { projectId, branchId, name: def.name },
      { provider: neonProvider },
    ),
);

const host = neon
  .getBranchEndpointsOutput({ projectId, branchId }, { provider: neonProvider })
  .apply((result) => {
    const endpoints = result.endpoints ?? [];
    if (endpoints.length === 0) {
      throw new Error(`no endpoint found for branch ${branchId}`);
    }
    const rw = endpoints.find((e) => e.type === "read_write") ?? endpoints[0];
    return rw.host;
  });

const store = cloudflare.SecretsStore.get(
  secretsStoreName,
  `${accountId}/${secretsStoreId}`,
);

roles.forEach((role, i) => {
  const def = roleDefs[i];
  if (def.secretName === undefined) {
    return;
  }
  const dsn = pulumi.interpolate`postgresql://${def.name}:${role.password}@${host}:5432/${databaseName}?sslmode=require`;
  new cloudflare.SecretsStoreSecret(def.secretName, {
    accountId,
    storeId: secretsStoreId,
    name: def.secretName,
    value: dsn,
    scopes: ["workers"],
    comment: def.comment,
  });
});

// Exported for PR2 (wrangler.toml bindings) and operators.
export const secretsStoreNameOut = secretsStoreName;
export const secretNames = roleDefs
  .filter((def) => def.secretName !== undefined)
  .map((def) => def.secretName as string);
export const roleNames = roleDefs.map((def) => def.name);
