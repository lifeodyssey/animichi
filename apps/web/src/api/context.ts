/**
 * Per-call oRPC client context.
 *
 * Carries request-scoped headers (forwarded cookie / auth `Authorization`) so
 * the SSR render can reuse the caller's identity. The client link reads this
 * off `ClientOptions.context` and merges it onto the outgoing request headers.
 */
export interface ApiClientContext {
  readonly headers?: Readonly<Record<string, string>>;
}
