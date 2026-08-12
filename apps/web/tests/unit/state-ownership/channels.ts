/**
 * Ownership-channel analysis for the state-ownership checker (issue #1009):
 * which channel hooks a file binds, which facts reach which channel, and where
 * local state is seeded from a URL/Query/Context value. All functions are
 * per-file; `checker.ts` turns them into whole-tree gates.
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

function hookPattern(hooks: readonly string[]): RegExp {
  return new RegExp(`\\bconst\\s+(?:\\[([^\\]]+)\\]|(\\w+))\\s*=\\s*(?:\\w+\\.)*(?:${hooks.join("|")})\\s*\\(`, "gu");
}

function bindDestructured(names: Set<string>, destructured: string): void {
  for (const raw of destructured.split(",")) {
    const name = raw.trim().replace(/^_/u, "");
    if (name !== "") names.add(name);
  }
}

function bindingsFor(source: string, hooks: readonly string[]): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(hookPattern(hooks))) {
    const destructured = match[1];
    const plain = match[2];
    if (destructured !== undefined) bindDestructured(names, destructured);
    if (plain !== undefined) names.add(plain);
  }
  return [...names];
}

/** Per channel: identifiers bound from channel hooks in this file (destructured
 * `const [a, b] = useState(...)` included). */
export function channelBindings(source: string): Readonly<Record<Channel, readonly string[]>> {
  const result: Record<Channel, string[]> = { url: [], query: [], context: [], local: [] };
  for (const channel of CHANNELS) {
    if (importsPackage(source, CHANNEL_PACKAGES[channel])) {
      result[channel] = bindingsFor(source, CHANNEL_HOOKS[channel]);
    }
  }
  return result;
}

export function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function memberPattern(name: string): RegExp {
  return new RegExp(`\\b${escapeName(name)}\\s*(?:(?:\\.|\\?)(?:\\.)?\\s*[A-Za-z_$][\\w$]*)+`, "gu");
}

/** Final property name accessed through a member chain (`url.selectedId`,
 * `query.data?.selectedId`, `client?.invalidateQueries` -> `invalidateQueries`). */
function factOfMatch(match: string): string | undefined {
  let last: string | undefined;
  for (const segment of match.matchAll(/[A-Za-z_$][\w$]*/gu)) last = segment[0];
  return last;
}

function collectFacts(source: string, name: string, facts: Set<string>): void {
  for (const match of source.matchAll(memberPattern(name))) {
    const fact = factOfMatch(match[0]);
    if (fact !== undefined) facts.add(fact);
  }
}

/** Final property names accessed through a binding. */
export function memberFacts(source: string, bindings: readonly string[]): ReadonlySet<string> {
  const facts = new Set<string>();
  for (const name of bindings) collectFacts(source, name, facts);
  return facts;
}

function deriveRound(source: string, known: readonly string[]): readonly string[] {
  const pattern = new RegExp(`\\bconst\\s+(\\w+)\\s*=\\s*(?:${known.map(escapeName).join("|")})\\s*(?:\\.|\\?|\\b)`, "gu");
  const derived: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) derived.push(name);
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
    frontier = absorbDerived(known, deriveRound(source, [...known]));
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

const COPY_HOOK_RE = /\b(?:useState|useReducer)\s*<[^>]*>\s*\(\s*([^)]*)\)|\b(?:useState|useReducer)\s*\(\s*([^)]*)\)/gu;

function referencedName(initializer: string, names: readonly string[]): string | undefined {
  return names.find((name) => new RegExp(`\\b${escapeName(name)}\\b`, "u").test(initializer));
}

function seededFacts(source: string): readonly string[] {
  const bindings = channelBindings(source);
  const sourced = channelSourcedNames(source, bindings);
  const sourceNames = [...sourced.url, ...sourced.query, ...sourced.context];
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
  for (const [fact, channels] of byFact) result.set(fact, [...channels].sort());
  return result;
}
