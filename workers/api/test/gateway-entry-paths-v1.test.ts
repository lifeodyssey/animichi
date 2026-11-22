/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins today's answer to the path neighbours of every `/v1` route — the
 * `/v1/users/` prefix, session adoption, Turnstile verification and the five
 * agent-tier routes: a trailing slash, an extra segment, a different case, a
 * percent-encoded slash and a percent-encoded ordinary letter.
 *
 * Every tier route matches the raw pathname exactly, so each of those
 * neighbours is the shared 404, reached before identity or the limiter is
 * consulted. Two places decode: the session id inside a conversation path
 * (`a%2Fb` reaches the tier as `a/b`), and the `/v1/users/` prefix, which
 * forwards whatever follows it still encoded.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { NOT_FOUND } from "./doubles/entry-envelopes.ts";

type Neighbour = readonly [method: string, path: string, status: number, body: string, log: readonly string[]];

function forwarded(path: string): readonly [string, readonly string[]] {
  return [`users GET ${path}`, ["auth u1", `users GET ${path} as u1/human`]];
}

function tier(handler: string, session: string): readonly [string, readonly string[]] {
  const body = JSON.stringify({ handler, user: "u1", type: "human", session });
  return [body, ["auth u1", `tier ${handler} u1 human ${session}`]];
}

const NEIGHBOURS: readonly Neighbour[] = [
  ["GET", "/v1/users", 404, NOT_FOUND, []],
  ["GET", "/v1/users/", 200, ...forwarded("/v1/users/")],
  ["GET", "/v1/users/saved-routes/", 200, ...forwarded("/v1/users/saved-routes/")],
  ["GET", "/v1/users/saved-routes/r-1/x", 200, ...forwarded("/v1/users/saved-routes/r-1/x")],
  ["GET", "/v1/Users/saved-routes", 404, NOT_FOUND, []],
  ["GET", "/V1/users/saved-routes", 404, NOT_FOUND, []],
  ["GET", "/v1/users%2Fsaved-routes", 404, NOT_FOUND, []],
  ["GET", "/v1/users/saved-routes%2Fx", 200, ...forwarded("/v1/users/saved-routes%2Fx")],
  ["GET", "/v1/%75sers/saved-routes", 404, NOT_FOUND, []],
  ["GET", "/v1/users/%73aved-routes", 200, ...forwarded("/v1/users/%73aved-routes")],
  ["POST", "/v1/sessions/adopt/", 404, NOT_FOUND, []],
  ["POST", "/v1/sessions/adopt/x", 404, NOT_FOUND, []],
  ["POST", "/v1/Sessions/adopt", 404, NOT_FOUND, []],
  ["POST", "/v1/sessions%2Fadopt", 404, NOT_FOUND, []],
  ["POST", "/v1/sessions/%61dopt", 404, NOT_FOUND, []],
  ["POST", "/v1/turnstile/verify/", 404, NOT_FOUND, []],
  ["POST", "/v1/turnstile/verify/x", 404, NOT_FOUND, []],
  ["POST", "/v1/Turnstile/verify", 404, NOT_FOUND, []],
  ["POST", "/v1/turnstile%2Fverify", 404, NOT_FOUND, []],
  ["POST", "/v1/turnstile/%76erify", 404, NOT_FOUND, []],
  ["POST", "/v1/chat/", 404, NOT_FOUND, []],
  ["POST", "/v1/chat/x", 404, NOT_FOUND, []],
  ["POST", "/v1/Chat", 404, NOT_FOUND, []],
  ["POST", "/v1%2Fchat", 404, NOT_FOUND, []],
  ["POST", "/v1/%63hat", 404, NOT_FOUND, []],
  ["POST", "/v1/byok/probe/", 404, NOT_FOUND, []],
  ["POST", "/v1/byok/probe/x", 404, NOT_FOUND, []],
  ["POST", "/v1/BYOK/probe", 404, NOT_FOUND, []],
  ["POST", "/v1/byok%2Fprobe", 404, NOT_FOUND, []],
  ["POST", "/v1/byok/%70robe", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42", 404, NOT_FOUND, []],
  ["GET", "/v1/Conversations", 404, NOT_FOUND, []],
  ["GET", "/v1%2Fconversations", 404, NOT_FOUND, []],
  ["GET", "/v1/%63onversations", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/messages/", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/messages/x", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/Messages", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/a%2Fb/messages", 200, ...tier("transcript", "a/b")],
  ["GET", "/v1/conversations/s-42/%6Dessages", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/%73-42/messages", 200, ...tier("transcript", "s-42")],
  ["GET", "/v1/conversations/%ZZ/messages", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/stream/", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/stream/x", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/s-42/Stream", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/a%2Fb/stream", 200, ...tier("stream", "a/b")],
  ["GET", "/v1/conversations/s-42/%73tream", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/%73-42/stream", 200, ...tier("stream", "s-42")],
  ["GET", "/v1/conversations/%ZZ/stream", 404, NOT_FOUND, []],
  ["GET", "/v1/conversations/%25ZZ/messages", 200, ...tier("transcript", "%ZZ")],
  ["GET", "/v1/conversations/%25ZZ/stream", 200, ...tier("stream", "%ZZ")],
  ["GET", "/v1/conversations/a%2Fb%ZZ/messages", 404, NOT_FOUND, []],
];

for (const [method, path, status, body, log] of NEIGHBOURS) {
  void test(`${method} ${path} answers a verified caller with ${String(status)}`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, path, HUMAN);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
  });
}
