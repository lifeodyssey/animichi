/**
 * A route's path as the inventories write it (`AGENT_PATHS`, the public catalog's
 * routes): literal segments and `{name}` parameters, plus a trailing `/*` for a
 * namespace, meaning every path under that prefix. `route-table.ts` declares each
 * path once in this form; Hono receives it in its own syntax, and the one
 * parameter a route reads back is read from the path the template matched.
 *
 * Nothing here compiles a regular expression: Hono's router does the matching.
 */

/** The template in Hono's route syntax: each `{name}` segment becomes `:name`. */
export function honoPath(template: string): string {
  return template.split("/").map(honoSegment).join("/");
}

function honoSegment(segment: string): string {
  return isParameter(segment) ? `:${segment.slice(1, -1)}` : segment;
}

function isParameter(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

/** Whether a path Hono matched to the template lies inside it. Hono's `/x/*`
 * also matches the bare `/x`, which a namespace has never included. */
export function withinTemplate(template: string, path: string): boolean {
  return !template.endsWith("/*") || path.startsWith(template.slice(0, -1));
}

/** The still-encoded value of `{name}` in a path the template matched. Hono's own
 * `c.req.param()` decodes leniently (`tryDecodeURIComponent` hands a malformed
 * escape back as written), so a route that refuses one reads the raw value here. */
export function rawParameter(template: string, path: string, name: string): string | undefined {
  return path.split("/")[template.split("/").indexOf(`{${name}}`)];
}
