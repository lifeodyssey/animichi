/**
 * Validate a redirect path is safe (relative, no open redirect).
 * Returns the path if safe, or the fallback otherwise.
 */
export function safeRedirect(to: string | null, fallback = "/chat"): string {
  if (!to) return fallback;
  // Must start with / and must not start with // (protocol-relative URL)
  if (!to.startsWith("/") || to.startsWith("//")) return fallback;
  return to;
}
