import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { unstable_readConfig } from 'wrangler';
import { deploymentIdentity } from '../../lib/release/observations.mjs';
import { POST_DEPLOY_ACS, acProbes } from '../../lib/release/post-deploy-acs.mjs';
import { buildEvidence, classifyResponse, credentialFindings, credentialValues, originUrl } from '../../lib/release/evidence.mjs';

// #1695: the deploy lane records what it observed and publishes it beside the
// receipt, because no verification seat may hold a staging credential. The
// transcript is the point: a probe records the status, content type, body
// length and digest of the answer it got, so a seat reads an observation rather
// than a step's exit code.
//
// The recorder is deliberately forgiving about a FAILED probe and unforgiving
// about two things. A probe that answers the wrong status is a recorded `fail`,
// not a red deploy: the deploy is not where a card's acceptance criterion is
// enforced, and a red observation is exactly what makes the stalled state
// visible. A credential-shaped value in the document IS a red deploy, because
// the artifact of a public repository is itself public.
const environment = process.argv[2];
// The evidence lane observes staging and nothing else. The receipt it binds to
// is the contract's own staging receipt (`receipt.rb` accepts no other
// environment), and the catalog's probes name staging origins. Production is
// reached directly — Access fronts staging — so a seat needs no recorder there.
assert.equal(environment, 'staging', 'the deploy-evidence catalog observes staging; production needs no recorder');
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 15) * 1000;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function wrangler(...args) {
  return JSON.parse(execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
}

/** The platform's own read-back of what is live, taken NOW and not read from
 * the receipt: the verifier holds the two against each other, so a receipt that
 * names a version the platform no longer serves is a mismatch, not a copy. */
function deployedEdge(sourceSha, declared) {
  const config = unstable_readConfig({ config: 'release/edge/wrangler.json', env: environment });
  const deployments = wrangler('deployments', 'list', '--name', config.name, '--json').sort((a, b) => b.created_on.localeCompare(a.created_on));
  const version = wrangler('versions', 'view', deployments[0].versions[0].version_id, '--name', config.name, '--json');
  // `deploymentIdentity` is the receipt's own assertion (release serves all
  // traffic, and the live tag is the selected source), reused so both
  // documents are produced by one reading of what "deployed" means.
  return { script_name: config.name, ...deploymentIdentity(deployments[0], version, sourceSha), tag: version.annotations['workers/tag'], declared_containers: declared };
}

function declaredContainers() {
  const config = unstable_readConfig({ config: 'release/edge/wrangler.json', env: environment });
  return (config.containers ?? []).map((container) => container.name);
}

/** The host a request would reach, as `URL.hostname` renders it. */
function hostOf(url) {
  return new URL(url).hostname;
}

// MIRROR of `isLoopbackHostname` in packages/contract/src/access-service-token.ts,
// exactly as `.github/scripts/staging-smoke-check.sh` mirrors it: this script
// cannot import TypeScript. A gap here hands staging's real service token to
// whatever is listening on a laptop port, and `post-deploy-evidence.test.rb`
// greps both files for the same literals so the two spellings cannot drift.
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '[::1]' || hostname === '::1' || hostname === '[::]' || hostname === '::' || hostname === '0.0.0.0') return true;
  return hostname.startsWith('127.') && /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** Half a service token is refused BY NAME: Access answers it as a login page,
 * which reads as a broken deploy rather than as a missing export. */
function accessHeaders(origin) {
  const id = process.env.CF_ACCESS_CLIENT_ID ?? '';
  const secret = process.env.CF_ACCESS_CLIENT_SECRET ?? '';
  if (id === '' && secret === '') return {};
  if (id === '' || secret === '') throw new Error('a Cloudflare Access service token is both headers or neither: CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be declared together');
  if (isLoopbackHostname(hostOf(origin))) throw new Error(`CF_ACCESS_CLIENT_ID is declared while probing ${origin}: staging's Access service token is never sent to a loopback origin`);
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

/** A signed-in staging identity is a WRITE-capable credential (it can open
 * turns and adopt sessions), so no seat may hold one and the deploy lane does
 * not either. The class is named and the probe is recorded as `unobserved`. */
function probeHeaders(probe, origin) {
  if (probe.credential === 'access') return accessHeaders(origin);
  if (probe.credential === 'identity') {
    const bearer = process.env.AGENT_TURN_BEARER ?? '';
    assert.equal(bearer, '', 'the evidence recorder must never carry a signed-in staging identity: a Neon Auth bearer can write');
    return null;
  }
  throw new Error(`unknown credential class "${probe.credential}"`);
}

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

function bodyFacts(probe, buffer) {
  const facts = { body_bytes: buffer.byteLength, body_sha256: `sha256:${createHash('sha256').update(buffer).digest('hex')}` };
  if (probe.expect.json !== undefined) facts.body_json = parseJson(buffer);
  if (probe.expect.jsonArrayMax !== undefined) facts.body_array_length = Array.isArray(parseJson(buffer)) ? parseJson(buffer).length : undefined;
  return facts;
}

async function observe(probe, origin, headers) {
  const started = Date.now();
  try {
    const response = await fetch(`${origin}${probe.path}`, { method: probe.method, headers, redirect: 'error', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const buffer = Buffer.from(await response.arrayBuffer());
    const observed = { status: response.status, content_type: response.headers.get('content-type') ?? undefined, cf_ray: response.headers.get('cf-ray') ?? undefined, duration_ms: Date.now() - started, at: new Date().toISOString(), ...bodyFacts(probe, buffer) };
    return { observed, verdict: classifyResponse(probe.expect, observed) };
  } catch (error) {
    return { observed: { error: { name: error?.name ?? 'Error' }, duration_ms: Date.now() - started, at: new Date().toISOString() }, verdict: 'error' };
  }
}

function unobserved(probe) {
  return { observed: null, verdict: 'unobserved', reason: `${probe.credential} credential is not available to the recorder` };
}

async function recordProbe(probe) {
  const origin = originUrl(process.env, probe.origin);
  const headers = probeHeaders(probe, origin);
  const { observed, verdict, reason } = headers === null ? unobserved(probe) : await observe(probe, origin, headers);
  return { card: probe.card, ac: probe.ac, name: probe.name, method: probe.method, path: probe.path, origin: probe.origin, credential: probe.credential, expected: probe.expect, observed, verdict, reason };
}

async function recordProbes() {
  const entries = POST_DEPLOY_ACS.filter((entry) => (entry.probes ?? []).length + (entry.diagnostics ?? []).length > 0);
  const probes = entries.flatMap((entry) => acProbes(entry).map((probe) => ({ ...probe, card: entry.card, ac: entry.ac })));
  return Promise.all(probes.map(recordProbe));
}

/** Nothing reaches the artifact until the guard has read it. Findings name a
 * path and a rule; the value never appears, in the log or in the report. */
function publish(evidence) {
  const findings = credentialFindings(evidence, credentialValues(process.env));
  if (findings.length > 0) {
    for (const finding of findings) console.error(`::error title=deploy evidence::${finding.path} carries ${finding.rule}`);
    throw new Error(`the evidence document carries ${findings.length} credential-shaped value(s); nothing was written`);
  }
  writeFileSync('evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
}

function summarize(probes) {
  for (const probe of probes.filter((item) => item.verdict !== 'pass')) console.log(`::warning title=deploy evidence::${probe.card} ${probe.ac} ${probe.name} ${probe.verdict}${probe.reason ? `: ${probe.reason}` : ''}`);
  console.log(`deploy evidence: ${probes.filter((probe) => probe.verdict === 'pass').length}/${probes.length} probes passed`);
}

const selection = readJson('selection.json');
const release = readJson('release/release.json');
const receipt = readJson('receipt.json');
const probes = await recordProbes();
publish(buildEvidence({
  environment,
  controller_run_id: process.env.GITHUB_RUN_ID,
  controller_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  release: selection,
  deployed: { edge: deployedEdge(release.source_sha, declaredContainers()) },
  platform: { container_applications: wrangler('containers', 'list', '--json').map((application) => ({ id: application.id, name: application.name })) },
  smoke: { verdict: receipt.smoke, observed_at: receipt.observed_at },
  probes,
  observed_at: new Date().toISOString(),
}));
summarize(probes);
