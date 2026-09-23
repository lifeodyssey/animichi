import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// #1050 — migrator-role isolation contract (Migration Executor, spec
// §"Database identity"). The dedicated `migrator` Postgres role is
// necessarily neon_superuser-grade; minimization is behavioral, and this test
// is the machine-checked half of rule (1): the migrator DSN secret
// (MIGRATOR_DATABASE_URL) must never reach any runtime Worker's standing
// environment. Precedent: the GEMINI_API_KEY removal guard pins a removal by
// scanning config surfaces rather than only the code that reads them.
//
// #1915 adds the three runtime-role passwords to the same contract: the
// migrator binds them because its SQL step applies them to the roles, so a
// runtime Worker binding one would hold the full credential pair of a service
// role it must never have.
//
// Rules (1)+(2) used to be pinned against the container env allowlist
// (`CONTAINER_ENV_KEYS` / `CONTAINER_REQUIRED_KEYS`); that allowlist was deleted
// with the container in #1605, and the surviving surface is the one this file
// now owns alone: the three runtime Workers' wrangler.toml files.
//
// test-type: unit (reads checked-in files; no network, no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The migrator DSN secret name as declared in the database-access IaC and the
// token the runtime surfaces must never reference, plus the #1915 role
// passwords. Centralized so both sides of the contract stay in lockstep.
const MIGRATOR_SECRET = "MIGRATOR_DATABASE_URL";
const SERVICE_ROLE_PASSWORDS = ["CATALOG_SVC_PASSWORD", "USERS_SVC_PASSWORD", "AGENT_SVC_PASSWORD"];
const MIGRATOR_ONLY_SECRETS = [MIGRATOR_SECRET, ...SERVICE_ROLE_PASSWORDS];
const migratorSecretRegex = new RegExp(escapeRegExp(MIGRATOR_SECRET));

for (const worker of ["catalog", "users", "edge"] as const) {
  for (const secret of MIGRATOR_ONLY_SECRETS) {
    void test(`no ${worker} wrangler.toml binding references ${secret}`, () => {
      assert.doesNotMatch(read(`workers/${worker}/wrangler.toml`), new RegExp(escapeRegExp(secret)),
        `${worker} wrangler.toml must not reference ${secret}`);
    });
  }
  void test(`no ${worker} wrangler.toml binding references the migrator role`, () => {
    assert.doesNotMatch(read(`workers/${worker}/wrangler.toml`), /\bmigrator\b/,
      `${worker} wrangler.toml must not reference the migrator role`);
  });
}

// #1365 — the negative assertions above only mean something while the secrets
// actually arrive the other way. Every deployed migrator environment must bind
// the DSN and all three role passwords, and the two environments must bind
// DIFFERENT store secrets: staging and production share the account's single
// store, so one shared name would point the production Worker at the staging
// database. One case per environment, with the expected store secret names in
// the table: staging binds the base names, production the `_PROD` twins.
const ENVIRONMENTS = [
  {
    env: "staging",
    expected: {
      MIGRATOR_DATABASE_URL: "MIGRATOR_DATABASE_URL",
      CATALOG_SVC_PASSWORD: "CATALOG_SVC_PASSWORD",
      USERS_SVC_PASSWORD: "USERS_SVC_PASSWORD",
      AGENT_SVC_PASSWORD: "AGENT_SVC_PASSWORD",
    },
  },
  {
    env: "production",
    expected: {
      MIGRATOR_DATABASE_URL: "MIGRATOR_DATABASE_URL_PROD",
      CATALOG_SVC_PASSWORD: "CATALOG_SVC_PASSWORD_PROD",
      USERS_SVC_PASSWORD: "USERS_SVC_PASSWORD_PROD",
      AGENT_SVC_PASSWORD: "AGENT_SVC_PASSWORD_PROD",
    },
  },
] as const;

/** The env's `secrets_store_secrets` block bodies in a wrangler.toml. */
function envSecretBlocks(toml: string, env: string): string[] {
  return [...toml.matchAll(/\[\[env\.(\w+)\.secrets_store_secrets]]\n([^[]*)/g)]
    .filter((match) => match[1] === env)
    .map((match) => match[2] ?? "");
}

/** The store secret name the given blocks bind for `binding`. */
function boundSecretName(bodies: string[], binding: string): string {
  const body = bodies.find((candidate) => candidate.includes(`binding = "${binding}"`));
  const match = body === undefined ? null : /secret_name = "(\w+)"/.exec(body);
  return match === null ? "(missing)" : (match[1] ?? "(missing)");
}

/** The env blocks' environment names, for the whole-file declaration check. */
function declaredEnvs(toml: string): string[] {
  return [...toml.matchAll(/\[\[env\.(\w+)\.secrets_store_secrets]]/g)].map((match) => match[1] ?? "");
}

for (const { env, expected } of ENVIRONMENTS) {
  void test(`the ${env} migrator binds its own DSN and the three role passwords`, () => {
    const bodies = envSecretBlocks(read("workers/migrator/wrangler.toml"), env);
    assert.equal(boundSecretName(bodies, "MIGRATOR_DATABASE_URL"), expected.MIGRATOR_DATABASE_URL,
      `${env} must bind the store secret the ${env} stack writes`);
    assert.equal(boundSecretName(bodies, "CATALOG_SVC_PASSWORD"), expected.CATALOG_SVC_PASSWORD,
      `${env} must bind the store secret the ${env} stack writes`);
    assert.equal(boundSecretName(bodies, "USERS_SVC_PASSWORD"), expected.USERS_SVC_PASSWORD,
      `${env} must bind the store secret the ${env} stack writes`);
    assert.equal(boundSecretName(bodies, "AGENT_SVC_PASSWORD"), expected.AGENT_SVC_PASSWORD,
      `${env} must bind the store secret the ${env} stack writes`);
  });
}

void test("the migrator wrangler.toml declares exactly the staging and production environments", () => {
  const envs = declaredEnvs(read("workers/migrator/wrangler.toml"));
  assert.deepEqual([...new Set(envs)].sort(), ["production", "staging"]);
});

void test("database-access IaC DOES provision the migrator role + MIGRATOR_DATABASE_URL store secret", () => {
  // The isolation assertions above are only meaningful while the migrator is
  // actually provisioned through the same IaC path as the runtime roles —
  // otherwise deleting the role would silently "pass" the negative checks.
  const databaseAccess = read("infra/database-access/index.ts");
  assert.match(databaseAccess, /name: "migrator"/, "database-access index.ts must declare the migrator role");
  assert.match(databaseAccess, migratorSecretRegex, "database-access index.ts must declare the MIGRATOR_DATABASE_URL store secret");
});

for (const secret of SERVICE_ROLE_PASSWORDS) {
  void test(`database-access IaC declares the ${secret} store secret`, () => {
    assert.match(read("infra/database-access/index.ts"), new RegExp(escapeRegExp(secret)),
      `database-access index.ts must declare the ${secret} store secret`);
  });
}

void test("migrator wrangler.toml has no Builds token binding", () => {
  const toml = read("workers/migrator/wrangler.toml");
  assert.doesNotMatch(toml, /BUILDS_API_TOKEN/);
  assert.doesNotMatch(toml, /CLOUDFLARE_API_TOKEN/);
});
