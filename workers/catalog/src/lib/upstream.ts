import { upstreamUnavailable, type UpstreamSource } from "./errors";

/** Map one upstream request's failures onto the shared typed retryable error. */
export async function withUpstreamUnavailable<T>(
  upstream: UpstreamSource,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw upstreamUnavailable(upstream, error);
  }
}
