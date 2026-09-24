/** The account's shared Cloudflare Secrets Store: the store this program
 * adopts, and the access secrets it publishes. The runtime Workers' vendor
 * keys are a separate provisioning concern — `runtime-secrets.ts`.
 *
 * Store creation note: the account already has Cloudflare's built-in
 * `default_secrets_store`, and the account plan refuses a second store
 * (`maximum_stores_exceeded`, HTTP 400 code 1003). This program therefore
 * IMPORTS the account's default store (`secretsStoreId` config) instead of
 * creating one; the store name is only the logical resource name here. Staging
 * and production SHARE this single store, which is exactly why the production
 * DSN secrets carry a "_PROD" suffix (`SecretsStorePlacement.nameSuffix`).
 */
import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

/** Where the store lives and what a DSN composed against it needs. */
export interface SecretsStorePlacement {
  /** Cloudflare account that owns the account's single default store. */
  accountId: string;
  /** The default store's id — the physical store every secret lands in. */
  storeId: string;
  /** "" on staging, "_PROD" on production: one store, two name spaces. */
  nameSuffix: string;
  /** The branch's read-write endpoint every DSN composes against. */
  host: pulumi.Input<string>;
  /** The database inside the branch. */
  databaseName: string;
}

/** A role whose DSN this program stores: the Postgres LOGIN the DSN
 * authenticates as, the base name of the DSN secret, and the comment the store
 * keeps beside it. */
export interface RoleDsnDefinition {
  name: string;
  secretName: string;
  comment: string;
}

/** A runtime role adds the base name of its generated password's secret. */
export interface RuntimeRoleDefinition extends RoleDsnDefinition {
  passwordSecretName: string;
}

/** The config-gated Neon Auth declarations; an unset one writes nothing. */
export interface NeonAuthDeclarations {
  /** Branch Better Auth base URL the edge's JWKS URL is derived from. */
  baseUrl?: string;
  /** QA login email (not a secret). */
  userEmail?: string;
  /** QA login password (a secret). */
  userPassword?: pulumi.Output<string>;
}

/** Adopt the account's default store into state. */
export function adoptSecretsStore(storeName: string, placement: SecretsStorePlacement): void {
  cloudflare.SecretsStore.get(storeName, `${placement.accountId}/${placement.storeId}`);
}

/** One secret in the account's shared Secrets Store, scoped to Workers.
 * `logicalName` is Pulumi's state identity, `realName` the name the store holds
 * and wrangler binds; four differ, and passing one string for both renames the
 * store secret — a delete-and-recreate, which is how #1940 lost CATALOG_ADMIN_TOKEN. */
function writeSecret(
  placement: SecretsStorePlacement,
  logicalName: string,
  realName: string,
  value: pulumi.Input<string>,
  comment: string,
): void {
  new cloudflare.SecretsStoreSecret(logicalName, {
    accountId: placement.accountId,
    storeId: placement.storeId,
    name: realName,
    value,
    scopes: ["workers"],
    comment,
  });
}

/** `role`'s DSN against the branch's read-write endpoint, sslmode=require. */
function dsnFor(
  placement: SecretsStorePlacement,
  role: string,
  password: pulumi.Output<string>,
): pulumi.Output<string> {
  return pulumi.interpolate`postgresql://${role}:${password.apply(encodeURIComponent)}@${placement.host}:5432/${placement.databaseName}?sslmode=require`;
}

/** The DSN secret of `def`'s role, under the stack-suffixed name. These names
 * are the contract the runtime and migrator Workers' wrangler.toml files bind
 * (#832, #1048); they are unchanged by #1915. */
export function storeRoleDsnSecret(
  placement: SecretsStorePlacement,
  def: RoleDsnDefinition,
  password: pulumi.Output<string>,
): void {
  const name = `${def.secretName}${placement.nameSuffix}`;
  writeSecret(placement, name, name, dsnFor(placement, def.name, password), def.comment);
}

/** Each runtime role's DSN and its generated password, under the
 * stack-suffixed names. The password secrets sit beside the DSNs for the
 * migrator alone. Both strings passed per role are equal — #1941 split the
 * factory's arguments because the four secrets further down (the admin token
 * and the config-gated Auth three) are the ones whose logical name is not their
 * real name. */
export function storeRuntimeRoleCredentials(
  placement: SecretsStorePlacement,
  defs: readonly RuntimeRoleDefinition[],
  passwords: readonly pulumi.Output<string>[],
): void {
  defs.forEach((def, i) => {
    const password = passwords[i];
    storeRoleDsnSecret(placement, def, password);
    storeRolePasswordSecret(placement, def, password);
  });
}

/** `def`'s password, which the migrator's SQL step applies to the role and no
 * runtime Worker binds. */
function storeRolePasswordSecret(
  placement: SecretsStorePlacement,
  def: RuntimeRoleDefinition,
  password: pulumi.Output<string>,
): void {
  const name = `${def.passwordSecretName}${placement.nameSuffix}`;
  writeSecret(
    placement,
    name,
    name,
    password,
    `${def.name} password, applied to the role by the migrator's SQL step (#1915); bound to no runtime Worker`,
  );
}

/** The catalog admin bearer token — one of the four pairs whose logical name is
 * not its store name (#1941). */
export function storeCatalogAdminToken(
  placement: SecretsStorePlacement,
  token: pulumi.Input<string>,
): void {
  writeSecret(
    placement,
    `catalog-admin-token${placement.nameSuffix}`,
    `CATALOG_ADMIN_TOKEN${placement.nameSuffix}`,
    token,
    "catalog admin command bearer token (system-health-audit 2026-08-26 §2.4, #1217)",
  );
}

/** The three config-gated Neon Auth declarations (AUTH-2 #950): a stack that
 * leaves a key unset writes none of them. */
export function storeNeonAuthDeclarations(
  placement: SecretsStorePlacement,
  auth: NeonAuthDeclarations,
): void {
  storeNeonAuthJwks(placement, auth.baseUrl);
  storeQaNeonUserEmail(placement, auth.userEmail);
  storeQaNeonUserPassword(placement, auth.userPassword);
}

function storeNeonAuthJwks(placement: SecretsStorePlacement, baseUrl: string | undefined): void {
  if (baseUrl === undefined) return;
  writeSecret(
    placement,
    "neon-auth-jwks-url",
    "NEON_AUTH_JWKS_URL",
    `${baseUrl.replace(/[/]+$/, "")}/.well-known/jwks.json`,
    "edge Neon Auth JWKS (derived from the branch auth base URL, AUTH-2 #950)",
  );
}

function storeQaNeonUserEmail(placement: SecretsStorePlacement, email: string | undefined): void {
  if (email === undefined) return;
  writeSecret(
    placement,
    "qa-neon-user-email",
    "QA_NEON_USER_EMAIL",
    email,
    "Neon Auth QA login email (Path A, AUTH-2 #950)",
  );
}

function storeQaNeonUserPassword(
  placement: SecretsStorePlacement,
  password: pulumi.Output<string> | undefined,
): void {
  if (password === undefined) return;
  writeSecret(
    placement,
    "qa-neon-user-password",
    "QA_NEON_USER_PASSWORD",
    password,
    "Neon Auth QA login password (secret; Path A, AUTH-2 #950)",
  );
}
