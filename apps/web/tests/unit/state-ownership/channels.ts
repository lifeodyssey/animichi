/**
 * Ownership-channel analysis for the state-ownership checker (issue #1009):
 * which channel hooks a file binds, which facts reach which channel, and where
 * local state is seeded from a URL/Query/Context value. All functions are
 * per-file; `checker.ts` turns them into whole-tree gates.
 *
 * Parsing is bounded and static: hook names are matched by membership in an
 * imported-name set, never by interpolating an identifier into a regex, so a
 * source binding can never grow the pattern.
 */

export type Channel = "url" | "query" | "context" | "local";

const URL_HOOKS = ["useSearch", "useParams", "useLocation", "useLoaderData"];
const QUERY_HOOKS = ["useQuery", "useSuspenseQuery", "useQueryClient"];
const CONTEXT_HOOKS = ["useContext"];
const LOCAL_HOOKS = ["useState", "useReducer"];

const CHANNEL_HOOKS: Readonly<Record<Channel, readonly string[]>> = {
  url: URL_HOOKS,
  query: QUERY_HOOKS,
  context: CONTEXT_HOOKS,
  local: LOCAL_HOOKS,
};

/** A channel hook counts only when the file imports it from its owning package. */
const CHANNEL_PACKAGES: Readonly<Record<Channel, string>> = {
  url: "@tanstack/react-router",
  query: "@tanstack/react-query",
  context: "react",
  local: "react",
};

export const CHANNELS = Object.keys(CHANNEL_HOOKS) as readonly Channel[];

function importsPackage(source: string, packageName: string): boolean {
  return source.includes(`from "${packageName}"`) || source.includes(`from '${packageName}'`);
}

/** `const [a, b]`, `const { a: b }`, or `const c`, immediately followed by
 * `= <prefix>name(` — the called hook name is the last capture. */
const BIND_HOOK_RE = /\bconst\s+(?:\[([^\]]*)\]|\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*=\s*(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*\(/gu;

/** The `import { ... } from` clauses that name a hook's owning package. */
const FROM_CLAUSE_RE = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']/gu;

/** Local binding of a named-import member, resolving `as` aliases and dropping
 * default values (`{ data: q = [] }` -> `q`). */
function localNameOf(member: string): string {
  const beforeDefault = member.split("=")[0] ?? "";
  const segments = beforeDefault.split(":");
  return (segments[segments.length - 1] ?? "").trim().replace(/^\?/u, "");
}

function bindDestructured(names: Set<string>, destructured: string): void {
  for (const raw of destructured.split(",")) {
    const member = raw.trim();
    if (member === "" || member.startsWith("...")) continue;
    const name = localNameOf(member).replace(/^_/u, "");
    if (name !== "") names.add(name);
  }
}

/** The local binding a named-import member aliases to, or nothing for empty,
 * `type`-marked, and non-canonical members. */
function importLocalName(member: string, canonical: readonly string[]): string | undefined {
  const trimmed = member.trim();
  if (trimmed === "" || trimmed.startsWith("type ")) return undefined;
  const [exported, local] = trimmed.split(/\s+as\s+/u);
  const exportedName = exported?.trim() ?? "";
  if (!canonical.includes(exportedName)) return undefined;
  return (local ?? exportedName).trim();
}

/** The locally bound names of a named-import clause that alias canonical hooks;
 * type-only clauses and `type`-marked members never bind runtime hooks. */
function namedImportLocals(clause: string, canonical: readonly string[]): readonly string[] {
  if (/^\s*type\b/u.test(clause)) return [];
  const body = /\{([\s\S]*)\}/u.exec(clause)?.[1];
  if (body === undefined) return [];
  const locals: string[] = [];
  for (const part of body.split(",")) {
    const local = importLocalName(part, canonical);
    if (local !== undefined) locals.push(local);
  }
  return locals;
}

/** The hook names actually available in `source`: the canonical names (so a
 * namespaced `router.useSearch(...)` still counts) plus any `as` aliases
 * imported from the channel's owning package. */
function hookNamesForPackage(source: string, packageName: string, canonical: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>(canonical);
  for (const match of source.matchAll(FROM_CLAUSE_RE)) {
    if (match[2] !== packageName) continue;
    for (const local of namedImportLocals(match[1] ?? "", canonical)) names.add(local);
  }
  return names;
}

function bindingsFor(source: string, hooks: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(BIND_HOOK_RE)) {
    if (!hooks.has(match[4] ?? "")) continue;
    const destructured = match[1] ?? match[2];
    const plain = match[3];
    if (destructured !== undefined) bindDestructured(names, destructured);
    if (plain !== undefined) names.add(plain);
  }
  return [...names];
}

/** Per channel: identifiers bound from channel hooks in this file — array
 * destructure, object destructure (aliases resolved), plain, and imported `as`
 * aliases all included. */
export function channelBindings(source: string): Readonly<Record<Channel, readonly string[]>> {
  const result: Record<Channel, string[]> = { url: [], query: [], context: [], local: [] };
  for (const channel of CHANNELS) {
    if (importsPackage(source, CHANNEL_PACKAGES[channel])) {
      const hooks = hookNamesForPackage(source, CHANNEL_PACKAGES[channel], CHANNEL_HOOKS[channel]);
      result[channel] = bindingsFor(source, hooks);
    }
  }
  return result;
}

/** A root identifier followed by ≥1 member segment (`url.selectedId`,
 * `query.data?.selectedId`, `client?.invalidateQueries`). */
const MEMBER_CHAIN_RE = /\b([A-Za-z_$][\w$]*)\s*(?:(?:\.|\?)(?:\.)?\s*[A-Za-z_$][\w$]*)+/gu;

/** Final property name accessed through a member chain (`url.selectedId`,
 * `query.data?.selectedId` -> `selectedId`). */
function factOfMatch(match: string): string | undefined {
  let last: string | undefined;
  for (const segment of match.matchAll(/[A-Za-z_$][\w$]*/gu)) last = segment[0];
  return last;
}

function collectFacts(source: string, names: ReadonlySet<string>, facts: Set<string>): void {
  for (const match of source.matchAll(MEMBER_CHAIN_RE)) {
    if (!names.has(match[1] ?? "")) continue;
    const fact = factOfMatch(match[0]);
    if (fact !== undefined) facts.add(fact);
  }
}

/** Final property names accessed through a set of bindings. */
export function memberFacts(source: string, bindings: readonly string[]): ReadonlySet<string> {
  const facts = new Set<string>();
  collectFacts(source, new Set(bindings), facts);
  return facts;
}

/** `const name = <root>…` where `root` is a sourced binding (`.`, `?.`, or end
 * of the initializer). */
const DERIVE_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\.|\?|\b)/gu;

function deriveRound(source: string, known: ReadonlySet<string>): readonly string[] {
  const derived: string[] = [];
  for (const match of source.matchAll(DERIVE_RE)) {
    const name = match[1];
    const root = match[2];
    if (name !== undefined && root !== undefined && known.has(root)) derived.push(name);
  }
  return derived;
}

function absorbDerived(known: Set<string>, derived: readonly string[]): string[] {
  const frontier: string[] = [];
  for (const name of derived) {
    if (known.has(name)) continue;
    known.add(name);
    frontier.push(name);
  }
  return frontier;
}

function sourcedNames(source: string, direct: readonly string[]): string[] {
  const known = new Set<string>(direct);
  let frontier = [...direct];
  for (let round = 0; round < 3 && frontier.length > 0; round += 1) {
    frontier = absorbDerived(known, deriveRound(source, known));
  }
  return [...known];
}

/** Identifiers bound from a channel binding (transitive): `const selectedId =
 * url.selectedId` counts as url-sourced. */
export function channelSourcedNames(source: string, bindings: Readonly<Record<Channel, readonly string[]>>): Readonly<Record<Channel, readonly string[]>> {
  const result: Record<Channel, string[]> = { url: [], query: [], context: [], local: [] };
  for (const channel of CHANNELS) {
    result[channel] = sourcedNames(source, bindings[channel]);
  }
  return result;
}

const COPY_HOOK_RE = new RegExp(
  String.raw`\b(?:useState|useReducer)\s*<[^>]*>\s*\(\s*([^)]*)\)|\b(?:useState|useReducer)\s*\(\s*([^)]*)\)`,
  "gu",
);

/** The identifier tokens of an initializer (for the seeded-name search). */
const IDENTIFIER_RE = /\b[A-Za-z_$][\w$]*\b/gu;

function referencedName(initializer: string, names: ReadonlySet<string>): string | undefined {
  for (const match of initializer.matchAll(IDENTIFIER_RE)) {
    if (names.has(match[0])) return match[0];
  }
  return undefined;
}

function seededFacts(source: string): readonly string[] {
  const bindings = channelBindings(source);
  const sourced = channelSourcedNames(source, bindings);
  const sourceNames = new Set([...sourced.url, ...sourced.query, ...sourced.context]);
  const facts: string[] = [];
  for (const match of source.matchAll(COPY_HOOK_RE)) {
    const initializer = match[1] ?? match[2] ?? "";
    const seeded = referencedName(initializer, sourceNames);
    if (seeded !== undefined) facts.push(seeded);
  }
  return facts;
}

/** AC4/AC6: local state (`useState`/`useReducer`) seeded from a URL/Query/
 * Context value bound in-file. */
export function localCopyViolationsInSource(source: string): readonly string[] {
  return seededFacts(source).map((fact) => `local state seeded from ${fact} (a URL/Query/Context value)`);
}

/** AC6 local-channel evidence: a fact name seeded into local state from a
 * URL/Query/Context-sourced binding in the same file. */
export function localStateFacts(source: string): ReadonlySet<string> {
  return new Set(seededFacts(source));
}

/** AC6: one fact name accessed through ≥2 ownership channels in one file. */
export function duplicateFactChannels(source: string): ReadonlyMap<string, readonly Channel[]> {
  const bindings = channelBindings(source);
  const byFact = new Map<string, Set<Channel>>();
  for (const channel of CHANNELS) {
    for (const fact of memberFacts(source, bindings[channel])) {
      const channels = byFact.get(fact) ?? new Set<Channel>();
      channels.add(channel);
      byFact.set(fact, channels);
    }
  }
  for (const fact of localStateFacts(source)) {
    const channels = byFact.get(fact) ?? new Set<Channel>();
    channels.add("local");
    byFact.set(fact, channels);
  }
  const result = new Map<string, readonly Channel[]>();
  for (const [fact, channels] of byFact) {
    result.set(fact, [...channels].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}
