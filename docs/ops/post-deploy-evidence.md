# Post-deploy acceptance evidence (#1695)

Four cards are held open by one thing and nothing else: an acceptance criterion whose only honest
evidence is an **observed deployed outcome**, and no seat that can observe it. Every staging origin
sits behind a Cloudflare Access application, so an unauthenticated verification seat gets a 302 to a
login page, and no automated seat holds a service token. The cards are otherwise proven with
mutation evidence:

| Card | Stalled criterion | What it needs to observe |
|---|---|---|
| [#1596](https://github.com/lifeodyssey/animichi/issues/1596) | AC5, AC6 | the smoke passing with the container application stopped; a browser network log |
| [#1597](https://github.com/lifeodyssey/animichi/issues/1597) | AC3 | the three retired catalog paths answering 404 from the deployed gateway |
| [#1599](https://github.com/lifeodyssey/animichi/issues/1599) | AC4 | the deployed gateway serving the conversation index to a signed-in caller |
| [#1601](https://github.com/lifeodyssey/animichi/issues/1601) | AC4 | a real sign-in adopting the anonymous conversation |

## The decision: the deploy lane publishes the observation

**Chosen: the deploy lane records what it observed and publishes it beside the receipt.** No seat
holds a credential, and the observation travels in one artifact, under one digest, named for the run and
attempt that produced it.

The alternative — a read-only service token scoped to the staging origins — was rejected on three
concrete grounds, not on taste:

1. **A Cloudflare Access service token is not a read credential.** The application fronting
   staging is host-scoped, never path-scoped (`infra/topology-staging-access.test.ts` pins that no
   destination carries a `/`), and behind the door the anonymous tier admits writes with no identity
   at all: `ANONYMOUS_TIER_KINDS` in `workers/edge/src/gateway/agent-tier-route.ts` reaches `turn`,
   `transcript` and `stream`, and an anonymous turn is a high-cost write
   (`workers/edge/src/identity/anonymous-flow.ts`). The Turnstile gate, the limiter and the budget
   latch behind it are anti-abuse walls, not authorization. Handing a seat that token hands it the
   whole staging surface, which this card's own rule forbids; a read-scoped credential class does not
   exist in the edge today. The token stays where it already is — opened from ESC in the staging job
   alone, which `cd-credentials.test.rb` pins.
2. **No token can produce #1596 AC5.** That criterion asks about a *staging state* — the smoke passing
   with the container application stopped. A seat holding any credential still cannot stop a container
   application; only the lane that owns the environment can enter that state.
3. **The receipt already binds a release to a run.** #1683's receipt is an immutable artifact carrying
   the actual deployed version ids, container application ids and image digests. The evidence composes
   with it rather than inventing a second provenance story: the transcript travels in the same
   artifact, so the artifact's digest binds the two documents to each other, and the artifact's name
   (`staging-receipt-<run>-<attempt>`) is what the verifier holds both to one run and one attempt by.

What the choice costs: the observations happen once per deploy, in the deploy's own environment, and a
criterion can only be settled against the release that deploy published. That is the point of an
observation — it is a record of a particular deploy, not a claim about `main`.

**No criterion of the four defeats this shape.** The two that remain unobserved need a lane and a
credential class, not a different place to stand: #1596 AC6 needs a browser network log, which only a
browser lane in CD can produce, and the authenticated halves of #1597 AC3, #1599 AC4 and #1601 AC4
need an identity the edge can issue that cannot write. Both are this mechanism's `unobservable-here`
with the missing thing named, and both are carried here the day they exist — the catalog already
holds the slot and the recorder refuses to hold a write-capable identity.

## What the artifact contains, and what it deliberately omits

`evidence.json` travels in the `staging-receipt-<run>-<attempt>` artifact next to `receipt.json`:

- `release` — the selected snapshot's artifact id/digest and source SHA, as the controller received it.
- `deployed.edge` — a **platform read-back taken at probe time**: the live Worker script's deployment
  id, version id and `sha-<source>` tag, plus the container application names the selected release
  config declares for this environment. The recorder takes this read itself; it does not copy the
  receipt's.
- `platform.container_applications` — what `wrangler containers list` returned at probe time.
- `platform.before_smoke` — the same read, with its timestamp, taken by
  `record-containers-before-smoke.mjs` in the step immediately before the smoke, because the recorder
  runs after the smoke and its own read says nothing about the state the smoke passed in.
- `smoke` — the receipt's smoke verdict and when it was observed.
- `probes[]` — one entry per catalog probe: the request (method, path, origin, credential class), the
  expectation, and a transcript of the answer: HTTP status, content type, body length, body SHA-256,
  `cf-ray`, duration, and a timestamp. Rejection bodies are small constants from `workers/edge/src/`
  and are recorded; a probe left unrecorded under its credential class is recorded as `unobserved`
  with the class named.
- `observed_at`, `controller_run_id`, `controller_run_attempt`.

Deliberately omitted, in every case because a public repository's artifacts are public:

- **Credential values and request/response headers, as values or as object keys.** The recorder
  refuses to publish a document that carries one, and `verify-evidence.mjs` refuses to read one. A
  finding names the path and the rule and never the value, and a credential-shaped KEY is reported
  under `<key>` rather than quoted, so the guard cannot publish what it found a second time.
- **Response bodies that carry user data.** The conversation index is recorded as a shape (a
  top-level JSON array, at most 30 rows) rather than a body.
- **Anything the repository says should be deployed.** Only observations: HTTP answers and platform
  read-backs. A workflow file that says it deploys is not evidence that it did.

## How a seat uses it

The seat holds repository read access and nothing else, and judges from a checkout:

```sh
# The read-only procedure: a token that can read this repository's Actions artifacts and issues.
node .github/scripts/release/verify-evidence.mjs --card 1596 --ac AC5 --fetch latest
node .github/scripts/release/verify-evidence.mjs --card 1596 --fetch latest --no-issue
```

The same judgement runs as a dispatchable lane, but starting it is not a read. `gh workflow run` calls
the [create-workflow-dispatch endpoint](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
which needs the `repo` scope on a classic token or
[Actions **write**](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
on a fine-grained one. The workflow's `permissions:` bind only the run's own `GITHUB_TOKEN`, never the
caller, so the lane is started by a separately authorized dispatcher, and the run it starts judges with
`contents: read` and `actions: read`:

```sh
# A dispatcher holding Actions write starts the lane; the judging job it starts only reads.
gh workflow run verify-deploy-evidence.yml --ref main -f card=1596 -f ac=AC5
```

`--fetch` is how a seat finds the artifact instead of being handed one: `--fetch <run_id>` reads that
run's own artifact listing — scoped by the API to what the run uploaded, so a named receipt cannot be
missed because the other lanes uploaded past it — while `--fetch latest` names no run and walks the
repository-wide listing to its last page, because that listing carries thousands of artifacts and any
shorter walk reports a published receipt as missing. The seat workflow's ten-minute job timeout bounds
a pathologically long listing, and that reads as a failed run, never as "not published".

The verifier recomputes every probe verdict from the transcript, holds the receipt and the transcript
against each other (same controller run and attempt, same selected snapshot, same live version, probes
taken after the platform read), holds a fetched artifact's `staging-receipt-<run>-<attempt>` name to the
run it was fetched from and to the run and attempt both documents record, and refuses to report a
criterion as satisfied from an artifact whose binding failed.
It exits 0 only when every criterion asked about is satisfied.

## The stalled state, named

An acceptance criterion that cannot be verified used to look exactly like one nobody had verified.
Every criterion in the catalog now resolves to one of five states, and the verifier prints the card's
own checklist beside them:

| State | Meaning | Owner |
|---|---|---|
| `satisfied` | observed, and the observation matches | none |
| `refuted` | observed, and the deployed outcome contradicts the criterion | a bug |
| `inconclusive` | a probe or the container read before the smoke is absent from the artifact, or a probe could not complete | re-run the deploy |
| `not-yet` | a required staging state is not in place (the container application is still deployed) | a decision about staging state |
| `unobservable-here` | the criterion needs a credential class or a lane this mechanism does not have | the decision below |

The verifier also reads the card body and prints a coverage line per card, so a card whose only
unchecked criteria are post-deploy reads "the only thing missing is a deploy observation" while a card
whose remaining evidence is not a deployed observation names those criteria by number. That line counts
the whole card's catalog even when `--ac` narrows the run to one criterion — what is left on a card is
not a fact about the request — while the drift check stays scoped to the criteria the request judges,
so a request for AC5 never fails on AC6. It states coverage, never a development claim: these cards
record their verification in issue comments and leave the boxes unchecked, so an unchecked box is not
evidence that code is missing. The catalog is held against the card too — if the criterion at that
ordinal no longer has the declared test type, the run fails rather than proving something else. Every
checklist line holds its ordinal, so a line whose `**(type)**` declaration is missing or unrecognised is
reported as drift in its own right and never renumbers the criteria after it.

## Where each of the four cards stands

- **#1596 AC5** — carried. The probe is `GET /healthz` on the deployed edge, plus the receipt's smoke
  verdict and two `wrangler containers list` read-backs that bracket the smoke: one taken immediately
  before it and stamped before the receipt observed it, and the recorder's own after it. It resolves
  `not-yet` while either read lists a container application at all, and `inconclusive` when the read
  before the smoke is missing or stamped after it — conservative on purpose: an application retired
  between the smoke and the recorder cannot report the criterion satisfied, and the reason names the
  applications it saw, so a false `not-yet` is diagnosable rather than silent. Retiring or stopping the staging
  container application is the remaining work, and that is a staging-state decision, not an access one.
- **#1596 AC6** — not carried. A browser network log needs a browser lane in CD (the e2e suite already
  knows how to present the Access headers); until that lane exists the criterion is recorded
  `unobservable-here` rather than skipped.
- **#1597 AC3** — half carried. The 404 the criterion names requires an *authenticated* request: an
  unauthenticated one is answered 401 by the gateway before any container is reached, which the
  transcript records as a diagnostic. That diagnostic asserts only that the caller is REFUSED — 401
  while the path is still routed, 404 once it is gone — so it is context and never the criterion's
  evidence, and it can never turn the criterion `refuted`. The authenticated half needs the read-scoped
  identity below.
- **#1599 AC4** — half carried: the unauthenticated 401 is recorded; the signed-in body needs the same
  identity.
- **#1601 AC4** — not carried: a real sign-in is a browser journey with an identity.

**The remaining decision is a credential class, not access.** A signed-in staging identity is the only
credential that can settle #1597 AC3, #1599 AC4's authenticated half and #1601 AC4, and every identity
the edge can issue today is write-capable (it opens turns and adopts sessions). Closing those three
criteria needs a read-scoped token type in the edge, or an owner-run observation recorded against the
same artifact. The catalog already carries the slot (`credential: "identity"`), so the probes light up
the day that class exists; the recorder refuses outright to hold one, so no partially-built change can
hand one to the deploy lane.

## Where the code lives

| Path | What it owns |
|---|---|
| `.github/lib/release/post-deploy-acs.mjs` | the catalog: criterion, probe, credential class, requirement, and the state a verdict resolves to |
| `.github/lib/release/evidence.mjs` | the transcript shape, the response matcher, and the credential guard's two rules |
| `.github/lib/release/card-criteria.mjs` | the card's checklist, the catalog drift check, and the at-a-glance line |
| `.github/lib/release/container-applications.mjs` | the one `wrangler containers list` read both container reads use |
| `.github/scripts/release/record-containers-before-smoke.mjs` | the container read taken immediately before the smoke |
| `.github/scripts/release/record-evidence.mjs` | the deploy lane's recorder; refuses half a service token, a loopback origin, an identity, and any document carrying a credential |
| `.github/scripts/release/verify-evidence.mjs` | the seat's verifier: guard, binding checks, recomputed verdicts, triage |
| `.github/workflows/verify-deploy-evidence.yml` | the dispatchable lane: started by a dispatcher with Actions write, judged by a read-only job |
| `.github/test/post-deploy-evidence*.test.rb` | the end-to-end runs, the seat's lookups and scoping, the refusals, and the mutations |
