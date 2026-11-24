/**
 * Miniflare's documented off value for its `cf` option. The workerd it starts gets Miniflare's placeholder
 * `Request.cf`, and nothing is fetched: unset, Miniflare requests `https://workers.cloudflare.com/cf.json` unless
 * `NODE_ENV` is "test", which vitest sets only when the environment has not set `NODE_ENV` already.
 */
export const placeholderRequestCf = { cf: false } as const;
