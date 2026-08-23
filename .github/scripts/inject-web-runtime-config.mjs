// Injects the versioned runtime config into the web Worker's wrangler vars at
// deploy time (#1013 merge-blocker). The ONE env-neutral bundle reads its
// environment-varying PUBLIC config at runtime from the RUNTIME_CONFIG binding;
// this converts the legacy VITE_* GitHub action vars into that JSON and writes
// it into apps/web/wrangler.jsonc [env.<TARGET_ENVIRONMENT>].vars, preserved
// comment-for-comment, so `wrangler deploy --env <target>` carries it.
//
// Only PUBLIC values move here (origins, site keys, flags); secrets stay in
// Cloudflare secret bindings / GitHub secrets, never in this payload.
//
// Usage:
//   TARGET_ENVIRONMENT=staging VITE_SITE_ORIGIN=... node inject-web-runtime-config.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyEdits, format, modify } from "jsonc-parser";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "../../apps/web/wrangler.jsonc");
const target = process.env.TARGET_ENVIRONMENT ?? "";
if (target !== "staging" && target !== "production") {
  console.error("TARGET_ENVIRONMENT must be staging or production");
  process.exit(1);
}

const optText = (key) => {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
};
const urlOf = (key) => optText(key);

const api = {};
const apiFields = [["VITE_SITE_ORIGIN", "siteOrigin"], ["VITE_CATALOG_URL", "catalogUrl"], ["VITE_USERS_URL", "usersUrl"], ["VITE_AGENT_URL", "agentUrl"]];
for (const [key, field] of apiFields) {
  const value = urlOf(key);
  if (value !== undefined) api[field] = value;
}

const payload = {
  schemaVersion: 1,
  api,
  neonAuthBaseUrl: optText("VITE_NEON_AUTH_BASE_URL"),
  turnstileSiteKey: optText("VITE_TURNSTILE_SITE_KEY"),
  showcaseMode: optText("VITE_SHOWCASE_MODE") ?? "false",
  cfBeaconToken: optText("VITE_CF_BEACON_TOKEN"),
  featureFlags: {},
};
for (const key of ["neonAuthBaseUrl", "turnstileSiteKey", "cfBeaconToken"]) {
  if (payload[key] === undefined) delete payload[key];
}
if (payload.neonAuthBaseUrl === undefined) {
  console.error("VITE_NEON_AUTH_BASE_URL is required; refusing to inject an empty RUNTIME_CONFIG");
  process.exit(1);
}

const source = readFileSync(configPath, "utf8");
const edits = modify(source, ["env", target, "vars", "RUNTIME_CONFIG"], JSON.stringify(payload), {});
const edited = applyEdits(source, edits);
// jsonc-parser 3.3.1: format(documentText, range, options) returns edits to apply.
const options = { tabSize: 2, insertSpaces: true };
writeFileSync(configPath, applyEdits(edited, format(edited, undefined, options)));
console.log("injected RUNTIME_CONFIG for " + target + ": " + JSON.stringify(payload));
