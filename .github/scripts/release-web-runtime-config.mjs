const SITE_KEY_LENGTH = 24;
const SECRET_MIN_LENGTH = 28;
const SECRET_PREFIXES = ["sk-", "sk_", "pk_", "ghp_", "gho_", "ghu_", "AKIA", "xoxb-", "xoxp-", "AIza", "eyJ", "SG."];
const SECRET_ALPHABET = /^[A-Za-z0-9_+/=-]+$/;
const PRIVATE_KEY = /-----BEGIN|PRIVATE KEY/;
const URL_KEYS = ["VITE_SITE_ORIGIN", "VITE_CATALOG_URL", "VITE_USERS_URL", "VITE_AGENT_URL", "VITE_NEON_AUTH_BASE_URL"];
const PUBLIC_KEYS = [...URL_KEYS, "VITE_TURNSTILE_SITE_KEY", "VITE_CF_BEACON_TOKEN", "VITE_SHOWCASE_MODE"];
const API_FIELDS = [["VITE_SITE_ORIGIN", "siteOrigin"], ["VITE_CATALOG_URL", "catalogUrl"], ["VITE_USERS_URL", "usersUrl"], ["VITE_AGENT_URL", "agentUrl"]];

function valueOf(env, key) {
  return env[key] || undefined;
}

function fail(name, reason) {
  throw new Error(`${name} ${reason}; refusing to publish runtime config`);
}

function isSecretMaterial(value) {
  if (SECRET_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  return value.length >= SECRET_MIN_LENGTH && SECRET_ALPHABET.test(value);
}

function validateSecretShape(name, value) {
  if (PRIVATE_KEY.test(value)) fail(name, "has a private-key shape");
  if (name === "VITE_CF_BEACON_TOKEN" && value.length === 36) return;
  if (isSecretMaterial(value)) fail(name, "is secret-shaped");
}

function validateSiteKey(value) {
  if (value.length !== SITE_KEY_LENGTH || !/^[A-Za-z0-9-]+$/.test(value)) {
    fail("VITE_TURNSTILE_SITE_KEY", "must have the 24-character public site-key shape");
  }
}

function validateUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(name, "must be a valid URL");
  }
  if (url.protocol !== "https:") fail(name, "must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    fail(name, "must not contain credentials, query parameters, or fragments");
  }
}

export function validatePublicEnvironment(env) {
  const authUrl = valueOf(env, "VITE_NEON_AUTH_BASE_URL");
  const siteKey = valueOf(env, "VITE_TURNSTILE_SITE_KEY");
  if (!authUrl) fail("VITE_NEON_AUTH_BASE_URL", "is required");
  if (!siteKey) fail("VITE_TURNSTILE_SITE_KEY", "is required");
  if (!["true", "false"].includes(valueOf(env, "VITE_SHOWCASE_MODE") ?? "false")) fail("VITE_SHOWCASE_MODE", "must be true or false");
  validateSiteKey(siteKey);
  for (const name of PUBLIC_KEYS) if (valueOf(env, name)) validateSecretShape(name, valueOf(env, name));
  for (const name of URL_KEYS) if (valueOf(env, name)) validateUrl(name, valueOf(env, name));
}

function apiPayload(env) {
  const api = {};
  for (const [key, field] of API_FIELDS) if (valueOf(env, key)) api[field] = valueOf(env, key);
  return api;
}

export function buildRuntimePayload(env) {
  validatePublicEnvironment(env);
  const payload = { schemaVersion: 1, api: apiPayload(env), neonAuthBaseUrl: valueOf(env, "VITE_NEON_AUTH_BASE_URL"),
    turnstileSiteKey: valueOf(env, "VITE_TURNSTILE_SITE_KEY"), showcaseMode: valueOf(env, "VITE_SHOWCASE_MODE") ?? "false",
    cfBeaconToken: valueOf(env, "VITE_CF_BEACON_TOKEN"), featureFlags: {} };
  for (const key of ["turnstileSiteKey", "cfBeaconToken"]) if (payload[key] === undefined) delete payload[key];
  return payload;
}
