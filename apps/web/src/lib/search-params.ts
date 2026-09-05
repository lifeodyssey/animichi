/** A non-empty string search param, or `undefined` when absent or blank.
 * Shared by every route's `validateSearch` (chat's `?q=`/`?session=`/`?route=`,
 * settings' `?session=`), so no route parses the same shape twice. */
export function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
