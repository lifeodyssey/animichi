/**
 * The documented in-process invocation, declared once.
 *
 * `NATIVE.md` quotes these lines verbatim and `test/native-documented-command.test.ts` executes
 * the offline one, so the prose and the check cannot drift into two different command strings.
 */

/** The argument vector every documented invocation forwards to pnpm. */
const EVAL_ARGV: readonly string[] = ['--filter', '@animichi/eval', 'eval:native'];

export interface DocumentedInvocation {
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

/** The three documented runs: the offline plan check, the smoke, and the complete set. */
export const DOCUMENTED_INVOCATIONS = {
  plan: { argv: EVAL_ARGV, environment: { EVAL_SMOKE: '1', EVAL_DRY_RUN: '1' } },
  smoke: { argv: EVAL_ARGV, environment: { EVAL_SMOKE: '1' } },
  full: { argv: EVAL_ARGV, environment: {} },
} as const satisfies Record<string, DocumentedInvocation>;

/** The shell line `NATIVE.md` must carry for this invocation. */
export function invocationLine(invocation: DocumentedInvocation): string {
  const environment = Object.entries(invocation.environment).map(([name, value]) => `${name}=${value}`);
  return [...environment, 'pnpm', ...invocation.argv].join(' ');
}

/**
 * Every documented control is an environment variable, so a command-line argument is an
 * unsupported form. It is refused loudly: `pnpm … eval:native -- --dataset <set>` used to exit 0
 * and silently run the default set, which looks like coverage and is not.
 */
export function rejectArguments(argv: readonly string[]): void {
  if (argv.length === 0) return;
  throw new Error(`the native eval takes no arguments (received "${argv.join(' ')}"); `
    + 'select the dataset with EVAL_DATASET — see NATIVE.md');
}
