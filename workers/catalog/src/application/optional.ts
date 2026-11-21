/**
 * `optional` — keep only present (non-null/undefined) entries of an object.
 *
 * The shared row-mapping helper for the read API handlers: a DB row carries
 * `null` for absent columns, but the contract's optional fields must be *absent*
 * (omitted), not `null`. Spreading `optional({...})` into a result object drops
 * exactly the null/undefined columns, so handlers stop re-rolling the
 * `...(x != null ? { x } : {})` pattern per field.
 */

/** Strip `null`/`undefined` from each value type — present entries only. */
export type Defined<T> = { [K in keyof T]?: Exclude<T[K], null | undefined> };

/** Keep only present (non-null/undefined) entries — drops absent DB columns. */
export function optional<T extends Record<string, unknown>>(fields: T): Defined<T> {
  const out: Defined<T> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined) out[k as keyof T] = v as Defined<T>[keyof T];
  }
  return out;
}
