/**
 * File-walking + import-parsing plumbing for the state-ownership checker
 * (issue #1009). Pure, regex-level source analysis shared by `channels.ts`
 * and `checker.ts`; no rule decisions live here.
 *
 * The two import patterns are static literals (String.raw keeps the escaped
 * braces readable) — specifiers are captured and matched, never interpolated
 * into a regex.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/** Relative import specifiers (`./x`, `../x`) with a type-only flag, including
 * side-effect imports (`import "./x"`) so a bare import can never smuggle a
 * cross-layer edge past the gate. */
export function importEdges(source: string): readonly ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    const edge = sideEffectEdge(match[2] ?? "");
    if (edge !== undefined) edges.push(edge);
  }
  for (const match of source.matchAll(NAMED_IMPORT_RE)) {
    const edge = namedEdge(match[2] ?? "", match[3] ?? "");
    if (edge !== undefined) edges.push(edge);
  }
  return edges;
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
