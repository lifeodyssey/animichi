/**
 * The post-deploy evidence document: what a probe transcript is, what may
 * never appear in one, and how one recorded response is judged (#1695).
 *
 * One shape, one purpose. `record-evidence.mjs` writes it in the deploy lane
 * beside the receipt; `verify-evidence.mjs` reads it from a seat that holds
 * nothing but repository read access. Every judgement a seat makes is
 * recomputed here from the transcript, never taken on the recorder's word.
 *
 * What it deliberately does NOT carry, in all three cases because the artifact
 * of a public repository is itself public:
 *   - credential values or request headers, pinned by `credentialFindings`;
 *   - response bodies for any probe that returns user data, so the probe
 *     vocabulary records a length or a shape instead of a body;
 *   - anything the repository says should be deployed. The platform read-back
 *     (`wrangler deployments list`, `wrangler containers list`) is what CD
 *     observed, and the verifier holds it against the receipt's own read.
 */

/** One response, as a transcript can carry it. */
export function classifyResponse(expect, observed) {
  if (observed?.error !== undefined) return "error";
  if (observed.status !== expect.status) return "fail";
  if (!contentTypeMatches(expect, observed)) return "fail";
  if (!bodyMatches(expect, observed)) return "fail";
  return "pass";
}

function contentTypeMatches(expect, observed) {
  if (expect.contentType === undefined) return true;
  return typeof observed.content_type === "string" && observed.content_type.startsWith(expect.contentType);
}

function bodyMatches(expect, observed) {
  if (expect.jsonArrayMax !== undefined && !(Number.isInteger(observed.body_array_length) && observed.body_array_length <= expect.jsonArrayMax)) return false;
  if (expect.json === undefined) return true;
  return jsonSubset(expect.json, observed.body_json);
}

/** Every key of `expected` is present in `actual` and equal to it, recursively.
 * A subset rather than an equality: a rejection envelope may grow a field
 * without turning a recorded probe red, while a missing `error.code` may not. */
export function jsonSubset(expected, actual) {
  if (expected === null || typeof expected !== "object") return expected === actual;
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => jsonSubset(value, actual[key]));
}

/**
 * The credential-shaped values and the CREDENTIAL NAMED values this document
 * carries, reported by path and by rule, never by value.
 *
 * Two rules, because either alone has a hole. The shapes catch a credential
 * this process never held — a token in a response body, a value pasted into a
 * fixture. The named values catch the ones this process DID hold, whatever they
 * look like: a Cloudflare Access service token is a hex string that no shape
 * can tell from a digest, and the account id in `CLOUDFLARE_ACCOUNT_ID` is not
 * a secret by intent but is not ours to publish either.
 *
 * A value shorter than eight characters is not treated as a credential: it
 * would match too much of the document to mean anything.
 */
export function credentialFindings(document, credentials = [], options = {}) {
  const { root = "evidence", depthLimit = 24 } = options;
  return walkValue(document, root, 0, { credentials, depthLimit });
}

function walkValue(value, path, depth, scan) {
  if (depth > scan.depthLimit) return [{ path, rule: "unreadable-depth" }];
  if (typeof value === "string") return [...shapesIn(value, path), ...declaredIn(value, path, scan.credentials)];
  if (Array.isArray(value)) return value.flatMap((item, index) => walkValue(item, `${path}[${index}]`, depth + 1, scan));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => walkValue(item, `${path}.${key}`, depth + 1, scan));
}

/** The exact value of a credential this process held. Value-compared on
 * `includes`, so a credential embedded in a longer string is still one. */
function declaredIn(value, path, credentials) {
  return credentials
    .filter((credential) => value.includes(credential.value))
    .map((credential) => ({ path, rule: `declared-credential:${credential.name}` }));
}

/** Header names count as shapes: a transcript that carries a header carries
 * whatever that header authenticates, and the two Access headers are the ones
 * every staging caller holds. */
const SECRET_SHAPES = [
  { rule: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { rule: "aws-access-key-id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { rule: "model-provider-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { rule: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "private-key-block", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { rule: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { rule: "access-header", pattern: /CF-Access-Client-(?:Id|Secret)/i },
  { rule: "authorization-header", pattern: /\bAuthorization\s*:/i },
];

function shapesIn(value, path) {
  return SECRET_SHAPES.filter((shape) => shape.pattern.test(value)).map((shape) => ({ path, rule: shape.rule }));
}

/** The environment's credential values, by name. The values never leave this
 * module: every finding names the variable, never what was in it. */
export function credentialValues(environment) {
  const named = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|KEY|BEARER|CLIENT_ID)(?:_|$)/;
  return Object.entries(environment)
    .filter(([name, value]) => typeof value === "string" && value.length >= 8 && named.test(name))
    .map(([name, value]) => ({ name, value }));
}

/** The document the deploy lane publishes beside its receipt. */
export function buildEvidence(input) {
  return {
    format: EVIDENCE_FORMAT,
    environment: input.environment,
    controller_run_id: input.controller_run_id,
    controller_run_attempt: input.controller_run_attempt,
    release: input.release,
    deployed: input.deployed,
    platform: input.platform,
    smoke: input.smoke,
    probes: input.probes,
    observed_at: input.observed_at,
  };
}

/** The evidence format this build reads. Bumped when a reader would otherwise
 * read a field that no longer means what it meant. */
export const EVIDENCE_FORMAT = 1;

/** The environment variable a probe's origin URL arrives in, per origin name.
 * Only the edge origin is declared, because every probe the catalog can make
 * observes the edge Worker; a probe of an undeclared origin fails here rather
 * than observing nothing and reading as a pass. */
const ORIGIN_VARIABLES = { edge: "EVIDENCE_EDGE_URL" };

export function originUrl(environment, name) {
  const declared = ORIGIN_VARIABLES[name];
  if (declared === undefined) throw new Error(`the catalog probes the "${name}" origin, which declares no origin URL`);
  const url = environment[declared];
  if (url === undefined || url === "") throw new Error(`${declared} is not declared: the recorder cannot observe the ${name} origin`);
  return url.replace(/\/$/, "");
}
