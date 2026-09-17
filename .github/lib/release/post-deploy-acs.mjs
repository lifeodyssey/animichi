/**
 * The acceptance criteria whose only honest evidence is an observed deployed
 * outcome, and the probes that observe them (#1695).
 *
 * Four cards are held open by these and nothing else: their development halves
 * are merged, mutation-proven, and unobservable from any seat, because every
 * staging origin sits behind Cloudflare Access and no seat holds a token. The
 * catalog is the fixed half of the answer: it names, per AC, the requests that
 * settle it and the credential class those requests need. The deploy lane runs
 * whatever the catalog asks for and can afford; the seat-side verifier judges
 * the transcript it published.
 *
 * Three credential classes, and the difference between them is the whole
 * decision in #1695:
 *   - `access`   the Cloudflare Access service token CD already opens from ESC
 *                for the smoke. It gets a request past the front door and
 *                grants nothing at the application layer.
 *   - `platform` the Cloudflare API read the receipt already makes (a Worker
 *                version id, a container application). A read-back of what is
 *                deployed, never of what the repository says should be.
 *   - `identity` a signed-in staging account. NO SEAT MAY HOLD ONE: a Neon Auth
 *                bearer can open turns and adopt sessions, so handing it out
 *                would fail the "no credential grants write access" rule this
 *                card is bound by. Probes that need one are recorded as
 *                `unobserved` and named, never skipped silently.
 *
 * `ac` is the card's own AC number, which is the ordinal of the checklist line
 * in the card body; `testType` is that line's declared test type. Both are
 * checked against the card by the triage command, so a card whose acceptance
 * criteria are reordered turns the check red instead of quietly proving
 * something else.
 */

import { classifyResponse } from "./evidence.mjs";

/** The three retired catalog reads (#1597): absent from the inventory, the
 * route tables, the rate policy and the Python routers. */
const RETIRED_PATHS = ["/v1/search/preview?q=test", "/v1/bangumi/485/guide", "/v1/bangumi/nearby"];

/** `GET /healthz` is answered by this Worker itself (#1596), so a 200 here is
 * the probe a stopped container cannot turn red. */
function edgeHealthz() {
  return {
    name: "edgeHealthz",
    origin: "edge",
    method: "GET",
    path: "/healthz",
    credential: "access",
    expect: { status: 200, json: { status: "ok" } },
  };
}

/** A CLI-safe name from a path: no `/`, `?` or `=` in a recorded probe name. */
function slug(path) {
  return path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The AC's own evidence: the 404 a signed-in caller sees once the container
 * no longer mounts the route. */
function retiredProbe(path) {
  return {
    name: `retired${slug(path)}`,
    origin: "edge",
    method: "GET",
    path,
    credential: "identity",
    expect: { status: 404, json: { error: { code: "not_found" } } },
  };
}

/** Not evidence for that 404 — evidence that no unauthenticated caller reaches
 * a 200 either, which is all a seat may observe today. The expectation is the
 * REFUSAL and never one status: while the retired path is still routed it
 * answers 401, once it is gone it answers 404, and both are that one fact. The
 * named `status` is the code a refusal answers with, for the summary line a
 * failure prints; it never narrows the match, because a diagnostic that
 * disagreed with the deployed reality would refute a criterion whose only
 * evidence was never taken. */
function retiredDiagnostic(path) {
  return {
    name: `retired${slug(path)}Unauthenticated`,
    origin: "edge",
    method: "GET",
    path,
    credential: "access",
    expect: { status: 401, refused: true },
  };
}

/** The index a signed-in caller receives. Asserted as the contract's own shape
 * (`ListConversationsResponse`: a top-level array, at most the 30 rows the cap
 * allows), never as a body — the probe must not depend on which conversations
 * the account happens to own. */
function conversationIndex() {
  return {
    name: "conversationsAuthenticated",
    origin: "edge",
    method: "GET",
    path: "/v1/conversations",
    credential: "identity",
    expect: { status: 200, contentType: "application/json", jsonArrayMax: 30 },
  };
}

/** The other half of the same criterion: the gateway refuses an unauthenticated
 * caller before either tier, which is a request a seat CAN observe. */
function conversationRefusal() {
  return {
    name: "conversationsUnauthenticated",
    origin: "edge",
    method: "GET",
    path: "/v1/conversations",
    credential: "access",
    expect: { status: 401, json: { error: { code: "unauthorized" } } },
  };
}

/** One recorded criterion. */
export const POST_DEPLOY_ACS = [
  {
    card: "1596",
    ac: "AC5",
    testType: "api",
    criterion: "the staging smoke passes with the container application stopped",
    probes: [edgeHealthz()],
    requirements: [{ kind: "receipt-smoke" }, { kind: "container-absent" }],
  },
  {
    card: "1596",
    ac: "AC6",
    testType: "browser",
    criterion: "the chat page reports backend health and renders no warm-up request",
    probes: [],
    requirements: [],
    blocked: "browser-lane",
  },
  {
    card: "1597",
    ac: "AC3",
    testType: "api",
    criterion: "the three retired paths answer 404 from the deployed staging gateway",
    probes: RETIRED_PATHS.map(retiredProbe),
    diagnostics: RETIRED_PATHS.map(retiredDiagnostic),
    requirements: [],
  },
  {
    card: "1599",
    ac: "AC4",
    testType: "api",
    criterion: "the deployed gateway answers the conversation index for a signed-in caller, and 401 without one",
    probes: [conversationIndex(), conversationRefusal()],
    requirements: [],
  },
  {
    card: "1601",
    ac: "AC4",
    testType: "api",
    criterion: "a real sign-in against deployed staging adopts the anonymous conversation",
    probes: [],
    requirements: [],
    blocked: "identity-credential",
  },
];

/** Every AC in the catalog, optionally narrowed to the cards asked about. */
export function catalogEntries(cards) {
  if (cards === undefined) return POST_DEPLOY_ACS;
  return POST_DEPLOY_ACS.filter((entry) => cards.includes(entry.card));
}

/** One AC's recorded probes plus the unauthenticated diagnostics that
 * accompany them; both are requests the recorder makes. */
export function acProbes(entry) {
  return [...(entry.probes ?? []), ...(entry.diagnostics ?? [])];
}

/** The five answers one criterion can get. Each has a different owner: a
 * refuted AC is a bug, an inconclusive one is a retry, a not-yet one is a
 * pending deploy state, and an unobservable one is a decision — which is the
 * whole point of naming them apart (#1695 requirement 3). */
export const AC_STATES = ["satisfied", "refuted", "inconclusive", "not-yet", "unobservable-here"];

const STATE_BY_KIND = {
  "probe-refuted": "refuted",
  "verdict-disagrees": "refuted",
  "probe-error": "inconclusive",
  "probe-absent": "inconclusive",
  "receipt-smoke": "not-yet",
  "container-absent": "not-yet",
  "container-read-absent": "inconclusive",
  "unreadable-requirement": "refuted",
  "probe-unobserved": "unobservable-here",
  blocked: "unobservable-here",
};

/** One verdict per criterion, in catalog order. */
export function acVerdicts(evidence, entries = POST_DEPLOY_ACS) {
  return entries.map((entry) => acVerdict(entry, evidence));
}

/** What the artifact says about one criterion, recomputed from its transcript.
 * The recorded `verdict` field is never trusted: a field that agrees with its
 * own transcript is fine, and one that disagrees is the finding. */
export function acVerdict(entry, evidence) {
  const recorded = new Map((evidence?.probes ?? []).map((probe) => [probe.name, probe]));
  const reasons = [...requirementReasons(entry, evidence), ...blockedReasons(entry), ...probeReasons(entry, recorded)];
  return { card: entry.card, ac: entry.ac, testType: entry.testType, criterion: entry.criterion, state: stateOf(reasons), reasons };
}

function stateOf(reasons) {
  return AC_STATES.find((state) => reasons.some((reason) => STATE_BY_KIND[reason.kind] === state)) ?? "satisfied";
}

function blockedReasons(entry) {
  return entry.blocked === undefined ? [] : [{ kind: "blocked", detail: entry.blocked }];
}

function requirementReasons(entry, evidence) {
  return (entry.requirements ?? []).flatMap((requirement) => requirementReason(requirement, evidence));
}

function requirementReason(requirement, evidence) {
  if (requirement.kind === "receipt-smoke") return smokeReason(evidence);
  if (requirement.kind === "container-absent") return containerReason(evidence);
  return [{ kind: "unreadable-requirement", detail: requirement.kind }];
}

function smokeReason(evidence) {
  const verdict = evidence?.smoke?.verdict;
  return verdict === "passed" ? [] : [{ kind: "receipt-smoke", detail: `the receipt records smoke "${verdict ?? "nothing"}"` }];
}

/** "Stopped" is a claim about the smoke INTERVAL, and the recorder reads the
 * platform after the smoke. So the criterion holds only when the read taken
 * before the smoke — stamped before the receipt observed the smoke — and the
 * recorder's read after it both list no application: an application retired
 * between the smoke and the recorder is not the state the smoke passed in. */
function containerReason(evidence) {
  const before = evidence?.platform?.before_smoke;
  if (!readBeforeSmoke(before, evidence?.smoke?.observed_at)) return [{ kind: "container-read-absent", detail: "no container read taken before the smoke is in the artifact" }];
  const after = evidence?.platform?.container_applications ?? [];
  if (after.length > 0) return [{ kind: "container-absent", detail: `${applicationNames(after)} still deployed` }];
  if (before.container_applications.length > 0) return [{ kind: "container-absent", detail: `${applicationNames(before.container_applications)} deployed when the smoke started` }];
  return [];
}

function readBeforeSmoke(before, smokeObservedAt) {
  return Array.isArray(before?.container_applications) && typeof before.observed_at === "string" && typeof smokeObservedAt === "string" && before.observed_at < smokeObservedAt;
}

function applicationNames(applications) {
  return applications.map((application) => application.name).join(", ");
}

function probeReasons(entry, recorded) {
  return [...(entry.probes ?? []), ...(entry.diagnostics ?? [])].flatMap((probe) => probeReason(probe, recorded.get(probe.name)));
}

function probeReason(probe, observation) {
  if (observation === undefined) return [{ kind: "probe-absent", detail: `${probe.name} is not in the artifact` }];
  if (observation.verdict === "unobserved") return [{ kind: "probe-unobserved", detail: `${probe.name} needs a credential of class "${probe.credential}"` }];
  return disagreement(probe, observation, classifyResponse(probe.expect, observation.observed));
}

function disagreement(probe, observation, recomputed) {
  const refuted = recomputed === "pass" ? [] : [{ kind: `probe-${recomputed === "error" ? "error" : "refuted"}`, detail: `${probe.name}: ${observedSummary(probe, observation)}` }];
  if (observation.verdict === recomputed) return refuted;
  return [...refuted, { kind: "verdict-disagrees", detail: `${probe.name}: recorded ${observation.verdict}, transcript says ${recomputed}` }];
}

function observedSummary(probe, observation) {
  const observed = observation.observed ?? {};
  return `expected ${probe.expect.status}, observed ${observed.status ?? observed.error?.name ?? "nothing"}`;
}
