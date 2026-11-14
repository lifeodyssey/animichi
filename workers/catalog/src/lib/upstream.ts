import { upstreamUnavailable, type UpstreamSource } from "./errors";

/**
 * Map one upstream request's failures onto the shared typed retryable error. A
 * failure the caller's own cancel caused is rethrown as the caller's reason: the
 * upstream did not fail, the caller stopped waiting.
 */
export async function withUpstreamUnavailable<T>(
  upstream: UpstreamSource,
  request: () => Promise<T>,
  caller?: AbortSignal,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    caller?.throwIfAborted();
    throw upstreamUnavailable(upstream, error);
  }
}
