import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { parse } from 'yaml';

const [source, destination] = process.argv.slice(2);
assert.ok(source && destination && process.argv.length === 4, 'source SHA and destination required');
const manifest = parse(execFileSync('git', ['show', `${source}:pnpm-workspace.yaml`], { encoding: 'utf8' }));
const patches = Object.values(manifest.patchedDependencies ?? {});
assert.ok(patches.every((path) => typeof path === 'string'), 'pnpm patch paths must be strings');
if (patches.length > 0) {
  mkdirSync(destination, { recursive: true });
  const archive = execFileSync('git', ['archive', '--format=tar', source, '--', ...patches]);
  execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
}
