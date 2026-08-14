/**
 * Constant-time string comparison for bearer-token guards (timing-safe).
 *
 * Used by the operational admin/rollback surfaces so an attacker cannot
 * recover a guard token by measuring response timing.
 */
/** True when both strings are equal, compared in constant time. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
