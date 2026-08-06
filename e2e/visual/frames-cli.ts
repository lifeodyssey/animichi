/**
 * CLI entry for frame resolution (S0-v2 F2). Prints the frame keys a
 * visual-check invocation will run, one per line, resolved through the
 * registry (frames.ts) so the wrapper never duplicates the PAGE/MODE logic.
 *
 * Usage (repo root, Node >= 22.6):
 *   node --experimental-strip-types e2e/visual/frames-cli.ts [--page PAGE] [--mode MODE]
 *
 * With --page: prints the single resolved frame (a full key wins, else
 * PAGE-MODE is tried); an unknown page exits 1 with the registry's error.
 * Without --page: prints every registered frame (the all-frames sweep).
 */

import { VISUAL_FRAMES, resolveFrame } from "./frames.ts";

interface CliArgs {
  page: string;
  mode: string;
}

function parseArgs(argv: string[]): CliArgs {
  const valueOf = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };
  return { page: valueOf("--page", ""), mode: valueOf("--mode", "day") };
}

function main(): void {
  const { page, mode } = parseArgs(process.argv.slice(2));
  try {
    const keys = page ? [resolveFrame(page, mode).key] : Object.keys(VISUAL_FRAMES);
    for (const key of keys) process.stdout.write(`${key}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

main();
