/**
 * State-ownership + dependency-boundary gate for `apps/web/src` (issue
 * #1009). Whole-tree rules over the plumbing in `scan.ts`, the channel
 * analysis in `channels.ts` and the allowlists in `gate-policy.ts`:
 *
 *  - dependency direction: route/component (UI) → feature → API/platform
 *    (base), never reverse; no cross-feature deep runtime imports except the
 *    named #842 shared map-primitive family;
 *  - transport: UI never imports client factories or oRPC transport packages;
 *  - storage: `localStorage`/`sessionStorage` only inside named feature-owned
 *    adapters (plus the documented pre-hydration bootstrap exception);
 *  - channel copies: local state never seeded from a URL/Query/Context value
 *    bound in the same file (AC4 + AC6), and one fact never spanned across
 *    two channels (AC6).
 *
 * The checker lives under `tests/` (not `src/`) because it is repository gate
 * tooling: it is not bundled, not coverage-swept, and the architecture test
 * runs it over the whole tree.
 */

import {
  type DynamicImportArg,
  type ImportEdge,
  type Layer,
  type SourceLang,
  dynamicImportArgs,
  featureNameOf,
  importEdges,
  layerOf,
  readSource,
  resolveImportTarget,
  sourceLangOf,
  walkSourceFiles,
  withoutComments,
  withoutExtension,
} from "./scan";
import {
  type Channel,
  duplicateFactChannels,
  localCopyViolationsInSource,
} from "./channels";
import {
  MAP_PRIMITIVE_EDGES,
  RUNTIME_PACKAGE_IMPORTS,
  SHARED_UI_FEATURE,
  STORAGE_ADAPTERS,
} from "./gate-policy";

/** Static transport-package matchers: the root or any `/`-subpath, inside
 * quotes. A fixed allowlist — no specifier is ever interpolated into a regex. */
const ORPC_CLIENT_FROM_RE = /import\s+([^;]*?)\s+from\s+["']@orpc\/client(?:\/[^"']*)?["']/gu;
const ORPC_OPENAPI_FROM_RE = /import\s+([^;]*?)\s+from\s+["']@orpc\/openapi-client(?:\/[^"']*)?["']/gu;
const ORPC_CLIENT_SIDE_EFFECT_RE = /import\s+["']@orpc\/client(?:\/[^"']*)?["']/gu;
const ORPC_OPENAPI_SIDE_EFFECT_RE = /import\s+["']@orpc\/openapi-client(?:\/[^"']*)?["']/gu;
/** Clause of every static `import ... from "<specifier-or-subpath>"` statement
 * in `source`. */
function fromClauses(source: string, specifier: string): readonly string[] {
  const pattern = specifier === "@orpc/client" ? ORPC_CLIENT_FROM_RE : ORPC_OPENAPI_FROM_RE;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** Exported names in a named-import clause, skipping inline `type` members and
 * resolving `as` aliases back to the exported name. */
function runtimeNames(clause: string): readonly string[] {
  const body = /\{([\s\S]*)\}/u.exec(clause)?.[1] ?? "";
  const names: string[] = [];
  for (const part of body.split(",")) {
    const member = part.trim();
    if (member === "" || member.startsWith("type ")) continue;
    const exported = member.split(/\s+as\s+/u)[0]?.trim() ?? "";
    if (exported !== "") names.push(exported);
  }
  return names;
}

/** A type-only clause: `type` at a word boundary (`type { ... }`, `type Name`,
 * `type * as ns`) — never a default member merely starting with the letters
 * `type`, such as `typeClient`. */
function isTypeOnlyClause(clause: string): boolean {
  return /^type\b/u.test(clause);
}

/** The offending form of an import clause, or nothing for a type-only import
 * and a runtime named import of `ORPCError` alone. */
function clauseViolation(clause: string): string | undefined {
  const trimmed = clause.trim();
  if (isTypeOnlyClause(trimmed)) return undefined;
  if (trimmed.startsWith("*")) return "namespace";
  if (trimmed.startsWith("{")) {
    const names = runtimeNames(clause);
    if (names.length === 0 || (names.length === 1 && names[0] === "ORPCError")) return undefined;
    return `named:${names.join(",")}`;
  }
  return "default";
}

function hasImportForm(source: string, pattern: RegExp): boolean {
  return [...source.matchAll(pattern)].length > 0;
}

/** Violating forms from every static `from`-clause of a transport package. */
function fromClauseForms(source: string, specifier: string): readonly string[] {
  return fromClauses(source, specifier)
    .map((clause) => clauseViolation(clause))
    .filter((violation): violation is string => violation !== undefined);
}

/** A dynamic-import argument of the package (root or `/`-subpath), quoted or
 * template-literal; a fully dynamic argument is never guessed. */
function transportArgIsPackage(arg: DynamicImportArg, specifier: string): boolean {
  return arg.head === specifier || arg.head.startsWith(`${specifier}/`);
}

/** Any dynamic-import form of the package — quoted or template-literal. */
function hasDynamicTransportImport(source: string, specifier: string, lang: SourceLang): boolean {
  return dynamicImportArgs(source, lang).some((arg) => transportArgIsPackage(arg, specifier));
}

/** The violating runtime import forms of a transport package (exact or
 * subpath, static or dynamic) in `source`. */
function transportImportForms(source: string, specifier: string, lang: SourceLang): readonly string[] {
  const forms: string[] = [...fromClauseForms(source, specifier)];
  const sideEffect = specifier === "@orpc/client" ? ORPC_CLIENT_SIDE_EFFECT_RE : ORPC_OPENAPI_SIDE_EFFECT_RE;
  if (hasImportForm(source, sideEffect)) forms.push("side-effect");
  if (hasDynamicTransportImport(source, specifier, lang)) forms.push("dynamic");
  return forms;
}

/** AC2: a UI file may touch an oRPC transport package only through a type-only
 * import or a runtime named import whose sole member is `ORPCError`. */
export function transportViolations(file: string, source: string): readonly string[] {
  if (layerOf(file) !== "ui") return [];
  const lang = sourceLangOf(file);
  const violations: string[] = [];
  for (const specifier of RUNTIME_PACKAGE_IMPORTS) {
    if (transportImportForms(source, specifier, lang).length > 0) {
      violations.push(`${file}: ui imports transport package ${specifier}`);
    }
  }
  return violations;
}

function reverseViolation(file: string, from: Layer, to: Layer, specifier: string): string | undefined {
  if (from === "base" && (to === "feature" || to === "ui")) return `${file}: base must not import ${to} (${specifier})`;
  if (from === "feature" && to === "ui") return `${file}: feature must not import ui (${specifier})`;
  return undefined;
}

function apiTargetViolation(file: string, from: Layer, target: string, specifier: string): string | undefined {
  if (from !== "ui") return undefined;
  if (!target.startsWith("api/")) return undefined;
  if (target.startsWith("api/hooks/") || target.startsWith("api/config")) return undefined;
  return `${file}: ui may import api/hooks or api/config only (${specifier})`;
}

function crossFeatureViolation(file: string, from: Layer, to: Layer, target: string, specifier: string): string | undefined {
  if (from !== "feature" || to !== "feature") return undefined;
  if (featureNameOf(file) === featureNameOf(target)) return undefined;
  if (target.startsWith(`${SHARED_UI_FEATURE}/`)) return undefined;
  return `${file}: cross-feature import of ${target} (${specifier})`;
}

function directionViolation(file: string, from: Layer, to: Layer, target: string, specifier: string): string | undefined {
  const reverse = reverseViolation(file, from, to, specifier);
  if (reverse !== undefined) return reverse;
  const api = apiTargetViolation(file, from, target, specifier);
  if (api !== undefined) return api;
  return crossFeatureViolation(file, from, to, target, specifier);
}

function edgeViolation(file: string, from: Layer, edge: ImportEdge, allowlist: readonly string[]): string | undefined {
  if (edge.typeOnly) return undefined;
  const target = withoutExtension(resolveImportTarget(file, edge.specifier));
  const to = layerOf(target);
  if (to === undefined) return undefined;
  if (allowlist.includes(`${file} -> ${target}`)) return undefined;
  return directionViolation(file, from, to, target, edge.specifier);
}

function edgeViolations(file: string, source: string, allowlist: readonly string[]): readonly string[] {
  const from = layerOf(file);
  if (from === undefined) return [];
  const violations: string[] = [];
  for (const edge of importEdges(source, sourceLangOf(file))) {
    const message = edgeViolation(file, from, edge, allowlist);
    if (message !== undefined) violations.push(message);
  }
  return violations;
}

/** AC1: dependency-direction violations — reverse edges, cross-feature runtime
 * edges beyond the sanctioned map-primitive allowlist, UI reaching past hooks
 * into transport, and UI importing oRPC transport packages for anything but
 * `ORPCError`. */
export function dependencyViolations(root: string, edgeAllowlist: readonly string[] = MAP_PRIMITIVE_EDGES): readonly string[] {
  const violations: string[] = [];
  for (const file of walkSourceFiles(root)) {
    const source = readSource(root, file);
    for (const message of edgeViolations(file, source, edgeAllowlist)) violations.push(message);
    for (const message of transportViolations(file, source)) violations.push(message);
  }
  return violations;
}

function storageUsed(source: string): boolean {
  const clean = withoutComments(source);
  return clean.includes("localStorage") || clean.includes("sessionStorage");
}

/** AC2: direct storage usage outside the adapter allowlist. */
export function storageViolations(root: string, allowlist: readonly string[] = STORAGE_ADAPTERS): readonly string[] {
  const violations: string[] = [];
  for (const file of walkSourceFiles(root)) {
    if (storageUsed(readSource(root, file)) && !allowlist.includes(file)) {
      violations.push(`${file}: direct browser-storage access outside the adapter allowlist`);
    }
  }
  return violations;
}

/** AC4: `useState`/`useReducer` seeded from a URL/Query/Context value anywhere in `root`. */
export function localCopyViolations(root: string): readonly string[] {
  const violations: string[] = [];
  for (const file of walkSourceFiles(root)) {
    for (const message of localCopyViolationsInSource(readSource(root, file))) {
      violations.push(`${file}: ${message}`);
    }
  }
  return violations;
}

function spannedMessage(file: string, fact: string, channels: readonly Channel[]): string | undefined {
  if (channels.length < 2) return undefined;
  return `${file}: fact "${fact}" spans channels ${channels.join("+")}`;
}

function spannedMessages(file: string, byFact: ReadonlyMap<string, readonly Channel[]>): readonly string[] {
  const messages: string[] = [];
  for (const [fact, channels] of byFact) {
    const message = spannedMessage(file, fact, channels);
    if (message !== undefined) messages.push(message);
  }
  return messages;
}

/** AC6 whole-tree guard: facts living on ≥2 ownership channels in one file. */
export function duplicateFactViolations(root: string): readonly string[] {
  const violations: string[] = [];
  for (const file of walkSourceFiles(root)) {
    for (const message of spannedMessages(file, duplicateFactChannels(readSource(root, file)))) {
      violations.push(message);
    }
  }
  return violations;
}
