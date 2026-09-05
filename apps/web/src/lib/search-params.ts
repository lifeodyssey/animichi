/** A non-empty string search param, trimmed, or `undefined` when absent or blank.
 * Shared by every route's `validateSearch` (chat's `?q=`/`?session=`/`?route=`,
 * settings' `?session=`), so no route parses the same shape twice. */
export function stringParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
