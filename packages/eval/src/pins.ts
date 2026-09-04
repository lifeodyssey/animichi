import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * pydantic-evals (Python, writer) and logfire/evals (TS, reader) are one
 * coupled pin set — the same rule `packages/contract` applies to zod/oRPC.
 * `PINS.json` is where the pair is declared compatible; the manifests are
 * where each side is actually installed. Drift between them is a red gate,
 * not a silent upgrade.
 */
export interface EvalFrameworkPins {
  logfire: string;
  'pydantic-evals': string;
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
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
  const path = `${PACKAGE_DIR}package.json`;
  const raw = readJson(path);
  const dependencies = raw.dependencies;
  if (dependencies === null || typeof dependencies !== 'object') {
    throw new Error(`${path}: no dependencies block`);
  }
  return requireString(dependencies as Record<string, unknown>, 'logfire', path);
}

function lockedBlock(lock: string, name: string, path: string): string {
  const block = lock.split('[[package]]').find((entry) => entry.includes(`\nname = "${name}"\n`));
  if (block === undefined) {
    throw new Error(`${path}: no locked package named "${name}"`);
  }
  return block;
}

/** The pydantic-evals version uv resolved for `apps/agent` (a pydantic-ai extra). */
export function installedPydanticEvalsVersion(): string {
  const path = `${REPO_ROOT}apps/agent/uv.lock`;
  const block = lockedBlock(readFileSync(path, 'utf8'), 'pydantic-evals', path);
  const version = /\nversion = "([^"]+)"/.exec(block)?.[1];
  if (version === undefined) {
    throw new Error(`${path}: locked "pydantic-evals" block carries no version`);
  }
  return version;
}
