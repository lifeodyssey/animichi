import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acVerdicts, catalogEntries } from '../../lib/release/post-deploy-acs.mjs';
import { credentialFindings, credentialValues } from '../../lib/release/evidence.mjs';
import { catalogDrift, outstanding, parseAcceptanceCriteria, summaryLine } from '../../lib/release/card-criteria.mjs';

// #1695: the seat-side half. A verification seat holds repository read access
// and nothing else — no Cloudflare Access token, no staging identity — and
// reads the transcript the deploy lane published. Everything here is a
// recomputation: the recorded verdict is never trusted, the receipt and the
// transcript must name the same deployed version, and nothing derived from the
// artifact is printed until the credential guard has cleared it.
//
// Exit 0 means every criterion asked about is `satisfied`. Anything else exits
// non-zero with its reason, because "unverifiable" and "verified" must not look
// the same in a CI log.
const REPO = process.env.GITHUB_REPOSITORY ?? 'lifeodyssey/animichi';
const FILES = ['evidence.json', 'receipt.json'];

function gh(...args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const reason = String(error.stderr ?? error.message).trim().split('\n').pop();
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${reason}`);
  }
}

function parseArgs(argv) {
  const options = { cards: [], acs: [], dir: '.', fetch: null, issue: true };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--card') options.cards.push(...argv[++index].split(',').map((card) => card.trim()));
    else if (argv[index] === '--ac') options.acs.push(...argv[++index].split(',').map((ac) => ac.trim()));
    else if (argv[index] === '--dir') options.dir = argv[++index];
    else if (argv[index] === '--fetch') options.fetch = argv[++index];
    else if (argv[index] === '--no-issue') options.issue = false;
    else throw new Error(`unknown argument "${argv[index]}"`);
  }
  return options;
}

/** `--card` narrows to a card, `--ac` to one criterion of it: a coordinator
 * asking about AC5 must not be shown AC6 as a second failure. */
function entriesFor(options) {
  const byCard = catalogEntries(options.cards.length === 0 ? undefined : options.cards);
  if (options.acs.length === 0) return byCard;
  return byCard.filter((entry) => options.acs.includes(entry.ac));
}

/** Artifacts per listing page: `gh api` caps `per_page` here, and a page
 * shorter than this is the end of a listing. */
const ARTIFACT_PAGE_SIZE = 100;

/** The repository-wide listing is walked, not read whole: this repository
 * carries thousands of artifacts (6174 at the time of writing) and the newest
 * staging receipt sits behind whatever the pull-request lanes uploaded since the
 * last deploy, so a seat that read a single page would report "no receipt
 * published" about a receipt that exists — the exact stalled-looking state this
 * card exists to remove. A named run is not walked at all: its artifacts live in
 * the run's OWN listing, which is scoped to what that run uploaded. */
const ARTIFACT_PAGE_LIMIT = 5;

function artifactPage(endpoint, page) {
  const { artifacts = [] } = JSON.parse(gh('api', `${endpoint}?per_page=${ARTIFACT_PAGE_SIZE}&page=${page}`));
  return artifacts;
}

/** Every page of a listing, stopping at the first short one. A limit is what
 * bounds a walk; `Infinity` is for the run-scoped listing, which the API bounds
 * to one run's uploads rather than to the repository's history. */
function readListing(endpoint, limit) {
  const found = [];
  for (let page = 1; page <= limit; page += 1) {
    const artifacts = artifactPage(endpoint, page);
    found.push(...artifacts);
    if (artifacts.length < ARTIFACT_PAGE_SIZE) break;
  }
  return found;
}

/** Where one `--fetch` form reads its artifacts: a named run is LISTED BY THAT
 * RUN, while `latest` has no run to name and walks the repository-wide listing. */
function artifactListing(fetch) {
  if (fetch === 'latest') return { endpoint: `repos/${REPO}/actions/artifacts`, runId: null, limit: ARTIFACT_PAGE_LIMIT };
  return { endpoint: `repos/${REPO}/actions/runs/${fetch}/artifacts`, runId: fetch, limit: Number.POSITIVE_INFINITY };
}

/** The receipt artifact `--fetch` asks for. BOTH doors resolve here, so a future
 * change to how a receipt is found cannot cover one and miss the other — two
 * call sites resolving "find the receipt" independently is how the false stall
 * `--fetch <run_id>` still carried came back. */
function receiptArtifact(fetch) {
  const { endpoint, runId, limit } = artifactListing(fetch);
  return newestReceipt(readListing(endpoint, limit), runId);
}

/** The newest published receipt artifact, which is where the evidence lives:
 * one artifact, one digest, so the receipt and the transcript are bound to the
 * same run by construction rather than by a comparison this tool could get
 * wrong. */
function newestReceipt(artifacts, runId) {
  const unexpired = artifacts.filter((artifact) => artifact.name.startsWith('staging-receipt-') && artifact.expired === false);
  const candidates = runId === null ? unexpired : unexpired.filter((artifact) => String(artifact.workflow_run?.id) === runId);
  if (candidates.length === 0) throw new Error(`no unexpired staging-receipt artifact is published${runId === null ? '' : ` for run ${runId}`}`);
  return candidates.sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
}

function download(runId, name) {
  const directory = mkdtempSync(join(tmpdir(), 'deploy-evidence-'));
  gh('run', 'download', String(runId), '--repo', REPO, '-n', name, '-D', directory);
  return { directory, artifact: name, run_id: String(runId) };
}

function locate(options) {
  if (options.fetch === null) return { directory: options.dir, artifact: null, run_id: null };
  const receipt = receiptArtifact(options.fetch);
  return download(receipt.workflow_run.id, receipt.name);
}

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(`${file} is not readable: a seat reads the artifact the deploy lane published, never a file it assumes exists`);
  }
}

function guard(raw, environment) {
  const credentials = credentialValues(environment);
  return FILES.flatMap((name) => credentialFindings(JSON.parse(raw[name]), credentials, { root: name }));
}

/** What must hold between the receipt and the transcript before either is
 * evidence about a release: one run, one selected snapshot, one live version,
 * and every probe taken after the platform read that named that version. */
function bindingFailures(evidence, receipt) {
  return [...identityFailures(evidence, receipt), ...releaseFailures(evidence, receipt), ...probeFailures(evidence, receipt)];
}

function identityFailures(evidence, receipt) {
  const edge = receipt.workers?.find((worker) => worker.unit === 'edge') ?? {};
  const observed = evidence.deployed?.edge ?? {};
  const version = `the receipt names edge version ${edge.version_id ?? 'nothing'}, this transcript names ${observed.version_id ?? 'nothing'}`;
  const deployment = `the receipt names edge deployment ${edge.deployment_id ?? 'nothing'}, this transcript names ${observed.deployment_id ?? 'nothing'}`;
  const mismatched = [
    [edge.version_id === observed.version_id, version],
    [edge.deployment_id === observed.deployment_id, deployment],
  ].filter(([equal]) => !equal).map(([, detail]) => `the receipt does not match what was deployed: ${detail}`);
  return mismatched;
}

function releaseFailures(evidence, receipt) {
  const checks = [
    [evidence.format === 1, `unknown evidence format ${evidence.format}`],
    [evidence.controller_run_id === receipt.controller_run_id, `the transcript is from run ${evidence.controller_run_id}, the receipt from run ${receipt.controller_run_id}`],
    [JSON.stringify(evidence.release) === JSON.stringify(receipt.selection), 'the transcript and the receipt name different selected snapshots'],
    [evidence.smoke?.verdict === receipt.smoke, `the transcript records smoke "${evidence.smoke?.verdict}", the receipt records smoke "${receipt.smoke}"`],
  ];
  return checks.filter(([holds]) => !holds).map(([, detail]) => detail);
}

function probeFailures(evidence, receipt) {
  const early = (evidence.probes ?? []).filter((probe) => typeof probe.observed?.at === 'string' && probe.observed.at < (receipt.observed_at ?? '')).map((probe) => probe.name);
  return early.length === 0 ? [] : [`these probes were taken before the platform read that names the deployed version: ${early.join(', ')}`];
}

/** The card's own checklist: the catalog must describe the card it claims to,
 * or its probe proves something else. */
function cardReport(card, entries, options) {
  if (!options.issue) return { drift: [], lines: [] };
  const body = JSON.parse(gh('issue', 'view', card, '--repo', REPO, '--json', 'body')).body;
  const criteria = parseAcceptanceCriteria(body);
  return { drift: catalogDrift(card, criteria, entries), lines: [summaryLine(card, outstanding(criteria, entries))] };
}

function verdictLine(verdict, bound) {
  if (!bound) return `${verdict.card} ${verdict.ac} ${verdict.testType} NOT SATISFIED — unbound: the receipt and this transcript do not name one deployment, so nothing in it is evidence about a release`;
  if (verdict.state === 'satisfied') return `${verdict.card} ${verdict.ac} ${verdict.testType} satisfied — ${verdict.criterion}`;
  const reasons = verdict.reasons.map((reason) => `${reason.kind} (${reason.detail})`).join('; ');
  return `${verdict.card} ${verdict.ac} ${verdict.testType} NOT SATISFIED — ${verdict.state}: ${reasons}`;
}

function report(source, evidence, receipt, verdicts, cardLines, failures) {
  // A transcript that does not bind to a deployment settles nothing, however
  // well its probes match: the criteria are reported unbound rather than
  // satisfied, so a stale or substituted artifact cannot read as a green check.
  const bound = failures.length === 0;
  console.log(`deploy evidence: ${source.artifact === null ? source.directory : `${source.artifact} (run ${source.run_id})`}`);
  console.log(`platform read-back: ${evidence.deployed?.edge?.script_name ?? 'nothing'} version ${evidence.deployed?.edge?.version_id ?? 'nothing'} tag ${evidence.deployed?.edge?.tag ?? 'nothing'}`);
  console.log(`receipt smoke: ${receipt.smoke} observed at ${receipt.observed_at}`);
  for (const line of failures) console.log(`FAIL ${line}`);
  for (const line of cardLines) console.log(line);
  for (const verdict of verdicts) console.log(verdictLine(verdict, bound));
  const satisfied = bound ? verdicts.filter((verdict) => verdict.state === 'satisfied').length : 0;
  console.log(`result: ${satisfied}/${verdicts.length} criteria satisfied, ${failures.length} binding failure(s)`);
}

/** The two documents, once the guard has cleared them. A finding names a path
 * and a rule and prints neither value, so a flagged document is never reported
 * on at all. */
function documents(source) {
  const raw = Object.fromEntries(FILES.map((name) => [name, read(join(source.directory, name))]));
  const findings = guard(raw, process.env);
  if (findings.length > 0) return { findings };
  return { findings: [], evidence: JSON.parse(raw['evidence.json']), receipt: JSON.parse(raw['receipt.json']) };
}

/** The card bodies the catalog is held against: what is left on each card, and
 * every place the catalog describes a criterion the card no longer carries. */
function cardCoverage(entries, options) {
  const reports = [...new Set(entries.map((entry) => entry.card))].map((card) => cardReport(card, catalogEntries([card]), options));
  return { lines: reports.flatMap((item) => item.lines), drift: reports.flatMap((item) => item.drift) };
}

/** 0 only when every criterion asked about is satisfied and the artifact binds
 * to one deployment. Anything else is non-zero: "unverifiable" and "verified"
 * must not look the same in a CI log. */
function unsettled(failures, verdicts) {
  const outstanding = verdicts.filter((verdict) => verdict.state !== 'satisfied').length;
  return failures.length + outstanding === 0 ? 0 : 1;
}

function guardFailure(findings) {
  for (const finding of findings) console.log(`FAIL ${finding.path} carries ${finding.rule}`);
  return 1;
}

function judge(options, source, loaded) {
  const entries = entriesFor(options);
  const cards = cardCoverage(entries, options);
  const drift = cards.drift.map((line) => `${line}: the catalog and the card disagree`);
  const verdicts = acVerdicts(loaded.evidence, entries);
  const failures = [...bindingFailures(loaded.evidence, loaded.receipt), ...drift];
  report(source, loaded.evidence, loaded.receipt, verdicts, cards.lines, failures);
  return unsettled(failures, verdicts);
}

function main(argv) {
  const options = parseArgs(argv);
  const source = locate(options);
  const loaded = documents(source);
  if (loaded.findings.length > 0) return guardFailure(loaded.findings);
  return judge(options, source, loaded);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  // A seat reads one line, not a stack trace: every failure this tool can name
  // is a failure it states.
  console.log(`FAIL ${error.message}`);
  process.exitCode = 1;
}
