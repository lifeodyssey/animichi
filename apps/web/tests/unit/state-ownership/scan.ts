/**
 * File-walking + import-parsing plumbing for the state-ownership checker
 * (issue #1009). Static source analysis shared by `channels.ts` and
 * `checker.ts`; no rule decisions live here.
 *
 * Side-effect and clause imports are matched as static literals (String.raw
 * keeps the escaped braces readable) — specifiers are captured and matched,
 * never interpolated into a regex. Dynamic imports (`import("../x")`) are
 * parsed with the oxc TypeScript parser, so only real `import(...)` call
 * nodes with a string-literal argument count; text inside comments, strings,
 * or template literals never does. The parser dialect follows the source
 * file extension (`sourceLangOf`); a snippet API without a file defaults to
 * the TS dialect and retries the sibling dialect on a parse error so a
 * dialect mismatch never silently hides a dynamic import.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync, visitorKeys } from "oxc-parser";
import type { ImportExpression, Node, Program } from "oxc-parser";

export const HERE = dirname(fileURLToPath(import.meta.url));

export function srcRoot(): string {
  return resolve(HERE, "../../../src");
}

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const GENERATED_SUFFIX = ".gen.ts";

function isSourceFile(name: string): boolean {
  return (
    SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)) &&
    !name.endsWith(GENERATED_SUFFIX) &&
    !name.endsWith(".stories.ts") &&
    !name.endsWith(".stories.tsx")
  );
}

/** Relative (`dir/file.ts`) paths of every source file under `root`. */
export function walkSourceFiles(root: string, relativeDir = ""): readonly string[] {
  const absoluteDir = `${root}/${relativeDir}`;
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return walkSourceFiles(root, relativePath);
    return isSourceFile(entry.name) ? [relativePath] : [];
  });
}

export function readSource(root: string, relativePath: string): string {
  return readFileSync(`${root}/${relativePath}`, "utf8");
}

/** Strips block and line comments so doc prose never counts as usage. */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

export type Layer = "ui" | "feature" | "base";

/** UI owns routes + components; features own `features/*`; everything else
 * (api, lib, platform, i18n, server) is base. Root files are unclassified. */
export function layerOf(relativePath: string): Layer | undefined {
  if (relativePath.startsWith("routes/") || relativePath.startsWith("components/")) return "ui";
  if (relativePath.startsWith("features/")) return "feature";
  if (
    relativePath.startsWith("api/") ||
    relativePath.startsWith("lib/") ||
    relativePath.startsWith("platform/") ||
    relativePath.startsWith("i18n/") ||
    relativePath.startsWith("server/")
  ) {
    return "base";
  }
  return undefined;
}

export function featureNameOf(relativePath: string): string | undefined {
  return relativePath.startsWith("features/") ? relativePath.split("/")[1] : undefined;
}

export interface ImportEdge {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/** Bare imports (`import "./styles.css"`). */
const SIDE_EFFECT_IMPORT_RE = /(^|\n)\s*(?:import|export)\s+["']([^"']+)["']/gmu;

/** Clause imports (`import type { T } from "./x"`, `export { x } from "./y"`). */
const NAMED_IMPORT_RE = new RegExp(
  String.raw`(^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']`,
  "gmu",
);

export type SourceLang = "ts" | "tsx";

/** The parse dialect for a file: TSX for `.tsx`, TS otherwise. */
export function sourceLangOf(file: string): SourceLang {
  return file.endsWith(".tsx") ? "tsx" : "ts";
}

/** The module argument of a dynamic import: a string literal's full specifier,
 * or a template literal's static head (the text before the first `${`). */
export interface DynamicImportArg {
  readonly head: string;
  readonly literal: boolean;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value;
}

function childNodesOf(value: unknown): readonly Node[] {
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function childNodes(node: Node): readonly Node[] {
  const children: Node[] = [];
  for (const key of visitorKeys[node.type] ?? []) {
    children.push(...childNodesOf((node as unknown as Readonly<Record<string, unknown>>)[key]));
  }
  return children;
}

/** The `DynamicImportArg` of an `import(...)` call, or nothing for a non-literal
 * argument (identifiers, member chains) that must never be guessed. */
function importArg(node: ImportExpression): DynamicImportArg | undefined {
  const source = node.source;
  if (source.type === "Literal" && typeof source.value === "string") {
    return { head: source.value, literal: true };
  }
  if (source.type === "TemplateLiteral") {
    return { head: source.quasis[0]?.value.cooked ?? "", literal: false };
  }
  return undefined;
}

function collectImportArgs(node: Node, args: DynamicImportArg[]): void {
  if (node.type === "ImportExpression") {
    const arg = importArg(node);
    if (arg !== undefined) args.push(arg);
    return;
  }
  for (const child of childNodes(node)) collectImportArgs(child, args);
}

/** Parse `source` as `lang`, then the sibling dialect, so a dialect mismatch
 * (a TS generic arrow under tsx) can never hide dynamic imports. */
function parseDynamicProgram(source: string, lang: SourceLang): Program {
  const candidates: readonly SourceLang[] = lang === "tsx" ? ["tsx", "ts"] : ["ts", "tsx"];
  for (const candidate of candidates) {
    const result = parseSync("snippet.ts", source, { lang: candidate, sourceType: "module" });
    if (result.errors.length === 0) return result.program;
  }
  throw new Error(`unparseable dynamic-import source (${lang})`);
}

/** AST-derived module arguments of every `import(...)` call in `source`, in
 * source order. Template arguments carry their static head; a string-literal
 * argument carries its full specifier. No argument is ever guessed. */
export function dynamicImportArgs(source: string, lang: SourceLang = "ts"): readonly DynamicImportArg[] {
  const args: DynamicImportArg[] = [];
  for (const statement of parseDynamicProgram(source, lang).body) {
    collectImportArgs(statement, args);
  }
  return args;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** A clause is type-only when it leads with `type` (`type { T }`, `type X`,
 * `type * as ns`) or every named member is inline-typed (`{ type A }`,
 * `{ type A as B }`). A mixed clause (`{ type A, B }`) is a runtime edge. */
function clauseIsTypeOnly(clause: string): boolean {
  if (/^\s*type\b/u.test(clause)) return true;
  const body = /\{\s*([\s\S]*?)\s*\}/u.exec(clause)?.[1];
  if (body === undefined) return false;
  const members = body
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member !== "");
  return members.length > 0 && members.every((member) => /^type\s+[A-Za-z_$]/u.test(member));
}

function namedEdge(clause: string, specifier: string): ImportEdge | undefined {
  if (!isRelativeSpecifier(specifier)) return undefined;
  return { specifier, typeOnly: clauseIsTypeOnly(clause) };
}

function sideEffectEdge(specifier: string): ImportEdge | undefined {
  return isRelativeSpecifier(specifier) ? { specifier, typeOnly: false } : undefined;
}

function sideEffectEdges(source: string): readonly ImportEdge[] {
  return [...source.matchAll(SIDE_EFFECT_IMPORT_RE)]
    .map((match) => sideEffectEdge(match[2] ?? ""))
    .filter((edge): edge is ImportEdge => edge !== undefined);
}

function namedEdges(source: string): readonly ImportEdge[] {
  return [...source.matchAll(NAMED_IMPORT_RE)]
    .map((match) => namedEdge(match[2] ?? "", match[3] ?? ""))
    .filter((edge): edge is ImportEdge => edge !== undefined);
}

function dynamicEdges(source: string, lang: SourceLang): readonly ImportEdge[] {
  return dynamicImportArgs(source, lang)
    .filter((arg) => arg.literal)
    .map((arg) => sideEffectEdge(arg.head))
    .filter((edge): edge is ImportEdge => edge !== undefined);
}

/** Relative import specifiers (`./x`, `../x`) with a type-only flag, including
 * side-effect imports (`import "./x"`) and string-literal dynamic imports
 * (`import("../x")`) so no form can smuggle a cross-layer edge past the gate. */
export function importEdges(source: string, lang: SourceLang = "ts"): readonly ImportEdge[] {
  return [...sideEffectEdges(source), ...namedEdges(source), ...dynamicEdges(source, lang)];
}

/** Resolve a relative specifier against a file's src-relative dir; strip the
 * source extension so allowlist entries are extension-insensitive. */
export function resolveImportTarget(fileRelative: string, specifier: string): string {
  const dir = dirname(fileRelative);
  const target = normalize(join(dir, specifier));
  return target.replace(/\.(ts|tsx)$/u, "");
}

export function withoutExtension(relativePath: string): string {
  return relativePath.replace(/\.(ts|tsx)$/u, "");
}
