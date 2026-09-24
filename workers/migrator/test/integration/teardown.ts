/** Every teardown step runs even when an earlier one rejects, and the first failure is the one
 * that surfaces. Order is kept — a container stops after the database it holds was dropped —
 * because independence here means "no step skips another", not "all at once". */
export async function settleTeardown(steps: readonly (() => Promise<unknown>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) await step().catch((error: unknown) => failures.push(error));
  if (failures.length > 0) throw failures[0];
}
