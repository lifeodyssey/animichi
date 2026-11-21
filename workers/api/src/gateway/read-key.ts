/** Coarse key for a credential-free public read: the connecting IP when the
 * platform supplies it (best-effort identity isolation on the native damper),
 * else a shared literal so the damper still counts per-request. */
export function publicReadKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP");
  return ip && ip.length > 0 ? `ip:${ip}` : "public-read";
}
