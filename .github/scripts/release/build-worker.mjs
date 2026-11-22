import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ENTRIES, sourceConfig, sealedConfig } from '../../lib/release/config.mjs';

// The third argument moves the output root out of the checkout for a test that boots the
// sealed bundle; the release build writes `release/<unit>`.
const [unit, image = '', root = 'release'] = process.argv.slice(2);
if (!Object.hasOwn(ENTRIES, unit)) throw new Error('unknown release Worker');
const output = resolve(root, unit);
const scratch = mkdtempSync(`${tmpdir()}/release-worker-`);
const sealed = sealedConfig(unit, image);
mkdirSync(`${output}/bundle`, { recursive: true });
writeFileSync(`${output}/wrangler.json`, JSON.stringify(sealed, null, 2));
const original = sourceConfig(unit);
// Wrangler resolves `main` and an `[alias]` path from the directory of the config that declares
// them, and this build's config lives in a scratch directory, so both are made absolute here.
const unitPath = (path) => (path.startsWith('.') ? resolve('workers', unit, path) : path);
const alias = original.alias && Object.fromEntries(Object.entries(original.alias).map(([name, path]) => [name, unitPath(path)]));
const build = { ...sealed, main: resolve('workers', unit, original.main), rules: original.rules, alias };
if (unit === 'migrator') {
  delete build.no_bundle;
  delete build.find_additional_modules;
  delete build.preserve_file_names;
  delete build.base_dir;
}
writeFileSync(`${scratch}/wrangler.json`, JSON.stringify(build));
try {
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', `${scratch}/wrangler.json`, '--dry-run', '--env', 'production', '--outdir', `${output}/bundle`], { stdio: 'inherit' });
  if (!existsSync(`${output}/bundle/${ENTRIES[unit]}`)) throw new Error('release entrypoint is absent');
  if (unit === 'migrator') execFileSync('node', ['workers/migrator/scripts/prepare-migrations.ts', `${output}/bundle`], { stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
