/**
 * The documented regeneration for the exported dataset fixtures (#1746):
 *
 *   pnpm --filter @animichi/eval eval:regenerate-fixtures             # report drift; exit 1 when stale
 *   pnpm --filter @animichi/eval eval:regenerate-fixtures -- --write  # re-emit fixtures/
 *
 * What it derives. `fixtures/<set>.json` for the six canonical sets is a pure
 * function of `datasets/canonical/<set>.json` plus the evaluator roster in
 * `src/evaluator-names.ts`; `src/dataset-export.ts` owns that function and
 * explains what it intentionally does not re-derive (`stats-oracle.json` and
 * `evaluator-oracle.json` are Python-written witnesses, not derivations).
 *
 * Why both modes exist. The check mode is what `test/dataset-export.test.ts`
 * runs on every `pnpm test`, so the committed fixtures cannot drift from their
 * inputs unnoticed. The `--write` mode is the regeneration itself: it re-emits
 * all six from the canonical corpus and says which bytes actually moved, so a
 * deliberate fixture change is made by editing the canonical copy and running
 * this, never by hand-editing `fixtures/`.
 */
import { fixtureDrifts, regenerateFixtures, type FixtureDrift } from '../src/dataset-export.ts';

const WRITE_FLAG = '--write';

/** Where a committed export first disagrees with its derivation. */
function firstDifference(drift: FixtureDrift): string {
  const committed = drift.committed.split('\n');
  const derived = drift.derived.split('\n');
  const index = committed.findIndex((line, at) => line !== derived[at]);
  if (index === -1) return `${String(committed.length)} vs ${String(derived.length)} lines`;
  const was = committed[index] ?? '<absent>';
  return `line ${String(index + 1)}: ${was} -> ${derived[index] ?? '<absent>'}`;
}

function reportDrifts(drifts: readonly FixtureDrift[]): void {
  for (const drift of drifts) console.log(`  ${drift.set}: ${firstDifference(drift)}`);
  console.log(drifts.length === 0
    ? 'every dataset fixture reproduces its derivation from datasets/canonical/'
    : `${String(drifts.length)} dataset fixtures drifted — run this with --write to re-emit them`);
}

function regenerate(): void {
  const { total, moved } = regenerateFixtures();
  console.log(`re-emitted ${String(total)} dataset fixtures from datasets/canonical/`);
  console.log(moved.length === 0
    ? 'every fixture already carried the derived bytes'
    : `bytes moved: ${moved.join(', ')}`);
}

function main(): void {
  if (process.argv.includes(WRITE_FLAG)) {
    regenerate();
    return;
  }
  const drifts = fixtureDrifts();
  reportDrifts(drifts);
  process.exitCode = drifts.length === 0 ? 0 : 1;
}

main();
