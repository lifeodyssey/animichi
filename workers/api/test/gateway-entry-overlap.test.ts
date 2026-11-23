/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins, for every pair of path templates that can claim the same path,
 * which handler answers today and under which identity rule:
 *
 * - the private `/img/docs` namespace against the public Anitabi arm of `/img/`:
 *   the namespace, bare prefix included, never reaches the origin, but a case
 *   variant of it is not the namespace and does; neither arm consults identity;
 * - the conversation index against the transcript and stream templates, whose
 *   session id may itself read `messages` or `stream`; the index and the probe
 *   never admit an anonymous visitor, while the turn, transcript and stream do;
 * - the `/v1/users/` prefix against every other `/v1` name: the prefix wins, and
 *   it never admits a visitor however good their cookies;
 * - adoption against the retired migration path, Turnstile verification against
 *   the tier, and the public catalog against the rest of `/catalog/`.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, INVALID, VISITOR } from "./doubles/entry-seam.ts";
import { UNLIMITED } from "./doubles/entry-seam-limiters.ts";
import {
  IMAGE_PATH_INVALID, IMAGE_STORAGE_UNAVAILABLE, NOT_FOUND, UNAUTHORIZED,
} from "./doubles/entry-envelopes.ts";

interface Claim {
  readonly who: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly status: number;
  readonly body: string;
  readonly log: readonly string[];
}

const USER_CHARGE = ["auth u1", "coarse authed:u1", "rate:authed:u1 POST /rate-limit"];
const ORIGIN = "origin https://image.anitabi.cn";

function tier(handler: string, user: string, type: string, session: string): string {
  return JSON.stringify({ handler, user, type, session });
}

const CLAIMS: readonly Claim[] = [
  { who: "the docs arm, which ignores the plan", method: "GET", path: "/img/docs/archive/a.png?plan=h160", headers: {}, vars: {},
    status: 200, body: "png-bytes", log: ["docs archive/a.png"] },
  { who: "the docs arm, whatever bearer is presented", method: "GET", path: "/img/docs/archive/a.png", headers: INVALID, vars: {},
    status: 200, body: "png-bytes", log: ["docs archive/a.png"] },
  { who: "the docs arm, refusing with its bucket unbound", method: "GET", path: "/img/docs/archive/a.png?plan=h160", headers: {},
    vars: { DOCS_ASSETS: undefined }, status: 503, body: IMAGE_STORAGE_UNAVAILABLE, log: [] },
  { who: "the docs namespace's bare prefix", method: "GET", path: "/img/docs?plan=h160", headers: {}, vars: {}, status: 400,
    body: IMAGE_PATH_INVALID, log: [] },
  { who: "the docs namespace's bare prefix with a slash", method: "GET", path: "/img/docs/?plan=h160", headers: {}, vars: {},
    status: 400, body: IMAGE_PATH_INVALID, log: [] },
  { who: "the docs namespace, outside its approved prefix", method: "GET", path: "/img/docs/notes/a.png?plan=h160", headers: {},
    vars: {}, status: 400, body: IMAGE_PATH_INVALID, log: [] },
  { who: "the docs namespace, for an unapproved extension", method: "GET", path: "/img/docs/archive/a.txt?plan=h160", headers: {},
    vars: {}, status: 400, body: IMAGE_PATH_INVALID, log: [] },
  { who: "the origin arm, for a sibling of the namespace", method: "GET", path: "/img/docsx/a.png?plan=h160", headers: {}, vars: {},
    status: 200, body: "jpeg-bytes", log: [`${ORIGIN}/docsx/a.png?plan=h160`] },
  { who: "the origin arm, for a case variant of the namespace", method: "GET", path: "/img/Docs/archive/a.png?plan=h160",
    headers: {}, vars: {}, status: 200, body: "jpeg-bytes", log: [`${ORIGIN}/Docs/archive/a.png?plan=h160`] },
  { who: "the origin arm, whatever bearer is presented", method: "GET", path: "/img/a.jpg?plan=h160", headers: INVALID, vars: {},
    status: 200, body: "jpeg-bytes", log: [`${ORIGIN}/a.jpg?plan=h160`] },
  { who: "the stream handler, for a session named messages", method: "GET", path: "/v1/conversations/messages/stream",
    headers: HUMAN, vars: {}, status: 200, body: tier("stream", "u1", "human", "messages"),
    log: ["auth u1", "tier stream u1 human messages"] },
  { who: "the transcript handler, for a session named stream", method: "GET", path: "/v1/conversations/stream/messages",
    headers: HUMAN, vars: {}, status: 200, body: tier("transcript", "u1", "human", "stream"),
    log: ["auth u1", "tier transcript u1 human stream"] },
  { who: "the stream handler, for a session named stream", method: "GET", path: "/v1/conversations/stream/stream",
    headers: HUMAN, vars: {}, status: 200, body: tier("stream", "u1", "human", "stream"),
    log: ["auth u1", "tier stream u1 human stream"] },
  { who: "the transcript handler, for a session named messages", method: "GET", path: "/v1/conversations/messages/messages",
    headers: HUMAN, vars: {}, status: 200, body: tier("transcript", "u1", "human", "messages"),
    log: ["auth u1", "tier transcript u1 human messages"] },
  { who: "the index, which never admits a visitor", method: "GET", path: "/v1/conversations", headers: ADMITTED, vars: {},
    status: 401, body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "the probe, which never admits a visitor", method: "POST", path: "/v1/byok/probe", headers: ADMITTED, vars: {},
    status: 401, body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "the transcript, which admits a visitor", method: "GET", path: "/v1/conversations/s-42/messages", headers: ADMITTED,
    vars: {}, status: 200, body: tier("transcript", VISITOR, "anonymous", "s-42"),
    log: ["auth absent", `tier transcript ${VISITOR} anonymous s-42`] },
  { who: "the users prefix, over a tier name", method: "GET", path: "/v1/users/conversations", headers: HUMAN, vars: {},
    status: 200, body: "users GET /v1/users/conversations", log: ["auth u1", "users GET /v1/users/conversations as u1/human"] },
  { who: "the users prefix, over the turn name", method: "POST", path: "/v1/users/chat", headers: HUMAN, vars: {}, status: 200,
    body: "users POST /v1/users/chat", log: [...USER_CHARGE, "users POST /v1/users/chat as u1/human"] },
  { who: "the users prefix, over the adoption path", method: "POST", path: "/v1/users/sessions/adopt", headers: HUMAN, vars: {},
    status: 200, body: "users POST /v1/users/sessions/adopt", log: [...USER_CHARGE, "users POST /v1/users/sessions/adopt as u1/human"] },
  { who: "the users prefix, which never admits a visitor", method: "GET", path: "/v1/users/saved-routes", headers: ADMITTED,
    vars: {}, status: 401, body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "the retired migration path, before any identity", method: "POST", path: "/v1/session/migrate", headers: HUMAN, vars: {},
    status: 404, body: NOT_FOUND, log: [] },
  { who: "adoption, which needs a verified caller", method: "POST", path: "/v1/sessions/adopt", headers: ADMITTED, vars: {},
    status: 401, body: UNAUTHORIZED, log: ["auth absent"] },
  { who: "verification, which admits a visitor holding a pass", method: "POST", path: "/v1/turnstile/verify",
    headers: ADMITTED, vars: {}, status: 204, body: "", log: ["auth absent"] },
  { who: "nothing, for an undeclared public catalog path", method: "GET", path: "/catalog/public/secret", headers: {}, vars: {},
    status: 404, body: NOT_FOUND, log: [] },
  { who: "nothing, for a private catalog endpoint", method: "POST", path: "/catalog/search", headers: {}, vars: {}, status: 404,
    body: NOT_FOUND, log: [] },
];

for (const claim of CLAIMS) {
  void test(`${claim.method} ${claim.path} is answered by ${claim.who}`, async (t) => {
    const seam = entrySeam(t, UNLIMITED, claim.vars);
    const response = await seam.send(claim.method, claim.path, claim.headers);
    assert.equal(response.status, claim.status);
    assert.equal(await response.text(), claim.body);
    assert.deepEqual(seam.log, claim.log);
  });
}
