import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * pydantic-evals (Python, writer) and logfire/evals (TS, reader) are one
 * coupled pin set — the same rule `packages/contract` applies to zod/oRPC.
 * `PINS.json` is the single declaration of the pair; the manifests are where
 * each side is actually installed, except pydantic-evals, which has no TS
 * manifest and whose version is the one the frozen oracle fixtures were
 * exported with. Since #1603 that declaration is the only copy in the tree:
 * the Python agent's `uv.lock` read is gone and no code holds a second string.
 * Drift between the declared pair and the frozen bytes is an Eval Story, not a
 * silent upgrade — see the `comment` in `PINS.json`.
 */
export interface EvalFrameworkPins {
  logfire: string;
  'pydantic-evals': string;
}

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));

/** The workspace manifest that declares the one catalog entry a shared dependency resolves through. */
const WORKSPACE_MANIFEST = fileURLToPath(new URL('../../../pnpm-workspace.yaml', import.meta.url));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function readYaml(path: string): Record<string, unknown> {
  return parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`${path}: expected a string at "${key}", got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The declared compatible pair. */
export function declaredPins(): EvalFrameworkPins {
  const path = `${PACKAGE_DIR}PINS.json`;
  const raw = readJson(path);
  return {
    logfire: requireString(raw, 'logfire', path),
    'pydantic-evals': requireString(raw, 'pydantic-evals', path),
  };
}

/** The logfire version this package's manifest installs — exact, never a range. */
export function installedLogfireVersion(): string {
  return declaredDependency('logfire');
}

/** The pinned Pi SDK version every native session and recorded prefix was written with. */
export function installedPiAgentVersion(): string {
  return declaredDependency('@earendil-works/pi-agent-core');
}

/**
 * The version this package's manifest installs. A `catalog:` specifier is not a
 * version, so it resolves through the workspace catalog — since #1672 that entry
 * is the one declaration of a dependency two or more importers share, and the
 * manifest reaches it by name. A recorded prefix has to name the installed
 * version itself, so an unresolved protocol would be stamped into the corpus.
 */
function declaredDependency(name: string): string {
  const path = `${PACKAGE_DIR}package.json`;
  const dependencies = readJson(path).dependencies;
  if (dependencies === null || typeof dependencies !== 'object') {
    throw new Error(`${path}: no dependencies block`);
  }
  const declared = requireString(dependencies as Record<string, unknown>, name, path);
  return declared === 'catalog:' ? cataloguedDependency(name) : declared;
}

function cataloguedDependency(name: string): string {
  const catalog = readYaml(WORKSPACE_MANIFEST).catalog;
  if (catalog === null || typeof catalog !== 'object') {
    throw new Error(`${WORKSPACE_MANIFEST}: no catalog block`);
  }
  return requireString(catalog as Record<string, unknown>, name, WORKSPACE_MANIFEST);
}
