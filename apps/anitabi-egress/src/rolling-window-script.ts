/**
 * The ceiling's window, as the one script the store runs for each request.
 *
 * THE WINDOW is the last 3600 seconds, rolling. An admission at second `s`
 * counts against every request up to second `s + 3600` and frees its slot at
 * `s + 3601`, so any 3600 seconds hold at most the limit, and a burst can no
 * longer spend the ceiling at the end of one clock hour and again at the start
 * of the next, which a fixed hour allowed. The window is a sorted set under one
 * key: a member per admission, scored by its second.
 *
 * ONE CALL. Trim, count, admit and expiry run inside one script, and the store
 * runs a script whole before it runs anything else, so concurrent requests are
 * taken one at a time and a batch is admitted exactly up to the limit. It
 * travels as a plain EVAL in the write that already carries the address's AUTH,
 * so there is no script cache to miss.
 *
 * ONLY ADMISSIONS ARE RECORDED. A refusal adds nothing: a window that counted
 * refusals would never drain while a caller kept retrying, and the limit is a
 * promise about requests that reach the upstream.
 *
 * THE CLOCK IS THE STORE'S. The body reads `now` from a prologue. In the
 * service the prologue is the store's own `TIME`, so every machine of this
 * service shares one clock, and a machine whose clock is wrong cannot move the
 * window. A test hands the store another prologue, one that reads `now` from an
 * argument: a different clock injected, not a branch in this one.
 *
 * The script formats every number it sends with `string.format('%d', …)`,
 * rather than leaning on Lua's implicit number-to-string conversion, which
 * script engines do not all implement alike.
 *
 * THE ANSWER is an integer: `1` admitted, `0` refused. A guard the script
 * cannot pass answers an error whose first word names it, `EXPIRY` or `MEMBER`.
 */
import type { AdmissionRequest } from "./upstream-ceiling.ts";

/** The window's length, in the unit the agreement with the upstream is written in. */
const WINDOW_SECONDS = 60 * 60;

/**
 * How long the window's key outlives its last admission: two windows, so the
 * key is never gone while one of its members can still count.
 */
const WINDOW_TTL_SECONDS = 2 * WINDOW_SECONDS;

/**
 * The sorted set holding the last hour's admissions. It names this service and
 * this window and nothing about a deployment: a second instance names the same
 * key, which is the whole mechanism.
 */
export const WINDOW_KEY = "anitabi-egress:upstream-requests:rolling";

/** Where the script's `now` comes from, and the arguments that carry it. */
export interface ScriptClock {
  /** Lua that defines `local now`, in whole seconds, ahead of the window's body. */
  readonly prologue: string;
  /** The arguments the prologue reads, sent after the body's own three. */
  argumentsAt(nowSeconds: number): readonly string[];
}

/** The service's clock: the store's own `TIME`, which no machine of this service can skew. */
export const STORE_CLOCK: ScriptClock = {
  prologue: "local now = tonumber(redis.call('TIME')[1])\n",
  argumentsAt: () => [],
};

/**
 * The window itself: drop what aged out, count what is left, and admit while
 * the count is under the limit. `KEYS[1]` is the window; `ARGV` is the limit,
 * the admission's member and the key's life.
 */
export const WINDOW_BODY = `local window, limit = KEYS[1], tonumber(ARGV[1])
local stamp = string.format('%d', now)
redis.call('ZREMRANGEBYSCORE', window, '-inf', '(' .. string.format('%d', now - ${String(WINDOW_SECONDS)}))
if redis.call('ZCARD', window) >= limit then return 0 end
if redis.call('ZADD', window, 'NX', stamp, ARGV[2]) ~= 1 then
  return redis.error_reply('MEMBER the admission was already counted')
end
if redis.call('EXPIRE', window, ARGV[3]) ~= 1 then
  return redis.error_reply('EXPIRY the window was left without an expiry')
end
return 1
`;

/** The EVAL that runs the window for one request: the script on `clock`, its key, and its arguments. */
export function windowCommand(clock: ScriptClock, request: AdmissionRequest, member: string): string[] {
  const keys = [WINDOW_KEY];
  const args = [String(request.limit), member, String(WINDOW_TTL_SECONDS), ...clock.argumentsAt(request.nowSeconds)];
  return ["EVAL", clock.prologue + WINDOW_BODY, String(keys.length), ...keys, ...args];
}
